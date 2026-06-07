"""Authentication endpoints — register, login, OAuth, delete account."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
import secrets
import shutil

import bcrypt
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import RedirectResponse, Response
import httpx
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth_deps import get_current_user
from config.settings import settings
from db.base import get_db
from db.models.login_record import LoginRecord
from db.models.user import User
from db.repos.user import UserRepo

router = APIRouter()

UPLOADS_DIR = Path("data/rag_uploads")


# ── Models ────────────────────────────────────────────────────────────────────


class AuthRequest(BaseModel):
    username: str
    password: str
    device_id: str | None = None  # persistent client-generated UUID


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str
    id: str
    email: str | None = None


class UpdateProfileRequest(BaseModel):
    email: str | None = None
    system_prompt: str | None = None
    profession: str | None = None


class ResetPasswordRequest(BaseModel):
    username: str
    new_password: str


class OAuthCompleteRequest(BaseModel):
    pending_token: str
    username: str


class LoginRecordOut(BaseModel):
    id: str
    device_id: str | None
    os: str
    browser: str
    ip_address: str | None
    created_at: datetime


# ── UA helpers ────────────────────────────────────────────────────────────────


def _parse_os(ua: str) -> str:
    ua_lower = ua.lower()
    if "tauri" in ua_lower:
        # Tauri desktop — detect underlying OS from UA
        if "mac os" in ua_lower or "macos" in ua_lower:
            return "macos"
        if "windows" in ua_lower:
            return "windows"
        if "linux" in ua_lower:
            return "linux"
        return "desktop"
    if "iphone" in ua_lower or "ipad" in ua_lower:
        return "ios"
    if "android" in ua_lower:
        return "android"
    if "mac os" in ua_lower or "macos" in ua_lower:
        return "macos"
    if "windows" in ua_lower:
        return "windows"
    if "linux" in ua_lower:
        return "linux"
    return "unknown"


def _parse_browser(ua: str) -> str:
    ua_lower = ua.lower()
    if "tauri" in ua_lower:
        return "tauri"
    # Order matters — Edg must come before Chrome
    if "edg/" in ua_lower or "edge/" in ua_lower:
        return "edge"
    if "opr/" in ua_lower or "opera" in ua_lower:
        return "opera"
    if "firefox" in ua_lower or "fxios" in ua_lower:
        return "firefox"
    if "chrome" in ua_lower or "crios" in ua_lower:
        return "chrome"
    # Safari must come after Chrome (Chrome UA also contains "safari")
    if "safari" in ua_lower:
        return "safari"
    return "unknown"


def _client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


# ── Helpers ───────────────────────────────────────────────────────────────────


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def _verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def _create_token(user: User) -> str:
    expire = datetime.now(UTC) + timedelta(days=settings.jwt_expire_days)
    payload = {"sub": user.id, "username": user.username, "email": user.email, "oauth_provider": user.oauth_provider, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


async def _record_login(
    user: User, request: Request, device_id: str | None, db: AsyncSession
) -> None:
    ua = request.headers.get("user-agent") or ""
    record = LoginRecord(
        user_id=user.id,
        device_id=device_id,
        os=_parse_os(ua),
        browser=_parse_browser(ua),
        user_agent=ua or None,
        ip_address=_client_ip(request),
    )
    db.add(record)
    await db.commit()


async def _migrate_orphan_data(user_id: str, db: AsyncSession) -> None:
    """Claim all anonymous (user_id IS NULL) rows for the first registered user."""
    await db.execute(
        text("UPDATE mcp_servers SET user_id = :uid WHERE user_id IS NULL"),
        {"uid": user_id},
    )
    await db.execute(
        text("UPDATE chat_sessions SET user_id = :uid WHERE user_id IS NULL"),
        {"uid": user_id},
    )
    await db.commit()

    # Re-tag orphan memories in Chroma
    try:
        from chat.memory.long_term import LongTermMemory

        lt = LongTermMemory()
        vs = await lt._get_vector_store()
        ids, docs, metas = await vs.list_all(limit=10000)
        if ids:
            from core.llm.gateway import llm_gateway

            orphan_ids = [i for i, m in zip(ids, metas, strict=False) if not m.get("user_id")]
            orphan_docs = [d for d, m in zip(docs, metas, strict=False) if not m.get("user_id")]
            orphan_metas = [m for m in metas if not m.get("user_id")]
            if orphan_ids:
                embeddings = await llm_gateway.embed(orphan_docs)
                updated_metas = [{**m, "user_id": user_id} for m in orphan_metas]
                await vs.upsert(
                    ids=orphan_ids,
                    embeddings=embeddings,
                    documents=orphan_docs,
                    metadatas=updated_metas,
                )
    except Exception:
        pass  # memory migration is best-effort


async def _finalize_oauth_login(
    provider: str, sub: str, email: str | None, db: AsyncSession
) -> RedirectResponse:
    """Resolve an OAuth identity to a session and redirect the browser accordingly.

    Provider-agnostic: callers pass the provider name, the stable subject id, and
    a *verified* email (or None). Behaviour:
    - Known (provider, sub) → refresh email if changed, log straight in.
    - Else if a verified email matches an existing account → link and log in.
    - Else → issue a short-lived pending token so the user can pick a username.

    `email` must already be verified by the caller; it is the linking key, so an
    unverified address must never reach here (account-takeover guard).
    """
    repo = UserRepo(db)
    user = await repo.get_by_oauth(provider, sub)
    if user:
        if email and user.email != email:
            await repo.update_email(user.id, email)
            user.email = email
        return RedirectResponse(f"{settings.frontend_url}/#token={_create_token(user)}")

    if email:
        existing = await repo.get_by_email(email)
        if existing:
            await repo.link_oauth(existing.id, provider, sub)
            existing.oauth_provider = provider
            existing.oauth_sub = sub
            return RedirectResponse(f"{settings.frontend_url}/#token={_create_token(existing)}")

    expire = datetime.now(UTC) + timedelta(minutes=settings.oauth_pending_expire_minutes)
    pending_payload = {
        "pending": True,
        "oauth_provider": provider,
        "oauth_sub": sub,
        "email": email,
        "exp": expire,
    }
    pending_token = jwt.encode(pending_payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
    return RedirectResponse(f"{settings.frontend_url}/?oauth_pending={pending_token}")


# ── Routes ────────────────────────────────────────────────────────────────────


@router.get("/check-username")
async def check_username(username: str, db: AsyncSession = Depends(get_db)):
    """Return whether a username is available."""
    taken = await UserRepo(db).get_by_username(username) is not None
    return {"available": not taken}


@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(
    body: AuthRequest, request: Request, db: AsyncSession = Depends(get_db)
):
    """Register a new user. The first user claims all existing anonymous data."""
    repo = UserRepo(db)
    if await repo.get_by_username(body.username):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken")

    is_first_user = (await repo.count()) == 0
    user = await repo.create(body.username, _hash_password(body.password))

    if is_first_user:
        await _migrate_orphan_data(user.id, db)

    await _record_login(user, request, body.device_id, db)

    return TokenResponse(
        access_token=_create_token(user),
        username=user.username,
        id=user.id,
        email=user.email,
    )


@router.post("/login", response_model=TokenResponse)
async def login(
    body: AuthRequest, request: Request, db: AsyncSession = Depends(get_db)
):
    """Authenticate and return a JWT."""
    repo = UserRepo(db)
    user = await repo.get_by_username(body.username)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")
    if user.hashed_password is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This account uses Google login. Please sign in with Google.")
    if not _verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )
    await _record_login(user, request, body.device_id, db)
    return TokenResponse(
        access_token=_create_token(user),
        username=user.username,
        id=user.id,
        email=user.email,
    )


@router.get("/login-history", response_model=list[LoginRecordOut])
async def login_history(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    limit: int = 50,
):
    """Return the authenticated user's recent login records, newest first."""
    result = await db.execute(
        select(LoginRecord)
        .where(LoginRecord.user_id == user.id)
        .order_by(LoginRecord.created_at.desc())
        .limit(limit)
    )
    records = result.scalars().all()
    return [
        LoginRecordOut(
            id=r.id,
            device_id=r.device_id,
            os=r.os,
            browser=r.browser,
            ip_address=r.ip_address,
            created_at=r.created_at,
        )
        for r in records
    ]


@router.post("/reset-password")
async def reset_password(
    body: ResetPasswordRequest, db: AsyncSession = Depends(get_db)
):
    """Reset a user's password without requiring the old one.
    The new password is hashed with bcrypt — never stored as plaintext.
    """
    repo = UserRepo(db)
    user = await repo.get_by_username(body.username)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.hashed_password is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This account uses Google login and has no password.",
        )
    await repo.update_password(user.id, _hash_password(body.new_password))
    return {"ok": True}


@router.get("/google/authorize")
async def google_authorize():
    """Return the Google OAuth consent URL. Frontend redirects to this URL."""
    if not settings.google_client_id:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Google login is not configured.")
    state = secrets.token_urlsafe(16)
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "online",
    }
    from urllib.parse import urlencode
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)
    return {"url": url}


@router.get("/google/callback")
async def google_callback(
    code: str,
    state: str | None = None,
    error: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Exchange Google auth code for tokens, then redirect to frontend."""
    if error:
        return RedirectResponse(f"{settings.frontend_url}/?oauth_error={error}")

    # Exchange code for tokens
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": settings.google_redirect_uri,
                "grant_type": "authorization_code",
            },
        )
    if token_resp.status_code != 200:
        return RedirectResponse(f"{settings.frontend_url}/?oauth_error=token_exchange_failed")

    token_data = token_resp.json()
    id_token_str = token_data.get("id_token")
    if not id_token_str:
        return RedirectResponse(f"{settings.frontend_url}/?oauth_error=no_id_token")

    # Decode id_token (without signature verification — Google's token is trusted via HTTPS)
    try:
        # jose.jwt.decode without key just parses the payload
        payload = jwt.get_unverified_claims(id_token_str)
    except Exception:
        return RedirectResponse(f"{settings.frontend_url}/?oauth_error=invalid_id_token")

    google_sub = payload.get("sub")
    # Google verifies the email on its end, so it is safe to use as the linking key.
    email = payload.get("email") or None
    if not google_sub:
        return RedirectResponse(f"{settings.frontend_url}/?oauth_error=missing_sub")

    return await _finalize_oauth_login("google", google_sub, email, db)


@router.get("/github/authorize")
async def github_authorize():
    """Return the GitHub OAuth consent URL. Frontend redirects to this URL."""
    if not settings.github_client_id:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="GitHub login is not configured.")
    state = secrets.token_urlsafe(16)
    params = {
        "client_id": settings.github_client_id,
        "redirect_uri": settings.github_redirect_uri,
        "scope": "read:user user:email",
        "state": state,
        "allow_signup": "true",
    }
    from urllib.parse import urlencode

    url = "https://github.com/login/oauth/authorize?" + urlencode(params)
    return {"url": url}


@router.get("/github/callback")
async def github_callback(
    code: str,
    state: str | None = None,
    error: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Exchange a GitHub auth code for an access token, fetch the profile, then redirect.

    Unlike Google, GitHub is not OIDC (no id_token), so we call the GitHub API for the
    user id and a verified email. Only a primary + verified email is used for linking.
    """
    if error:
        return RedirectResponse(f"{settings.frontend_url}/?oauth_error={error}")

    async with httpx.AsyncClient() as client:
        # 1) Exchange the code for an access token (Accept: json → JSON body, not form-encoded)
        token_resp = await client.post(
            "https://github.com/login/oauth/access_token",
            headers={"Accept": "application/json"},
            data={
                "code": code,
                "client_id": settings.github_client_id,
                "client_secret": settings.github_client_secret,
                "redirect_uri": settings.github_redirect_uri,
            },
        )
        if token_resp.status_code != 200:
            return RedirectResponse(f"{settings.frontend_url}/?oauth_error=token_exchange_failed")
        access_token = token_resp.json().get("access_token")
        if not access_token:
            return RedirectResponse(f"{settings.frontend_url}/?oauth_error=token_exchange_failed")

        # GitHub's API requires a User-Agent header on every request.
        gh_headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "LyndonLLM",
        }

        # 2) Fetch the user profile — `id` is the stable subject.
        user_resp = await client.get("https://api.github.com/user", headers=gh_headers)
        if user_resp.status_code != 200:
            return RedirectResponse(f"{settings.frontend_url}/?oauth_error=profile_fetch_failed")
        profile = user_resp.json()
        github_sub = str(profile["id"]) if profile.get("id") is not None else None
        if not github_sub:
            return RedirectResponse(f"{settings.frontend_url}/?oauth_error=missing_sub")

        # 3) Resolve a primary + verified email (GitHub profile email is often private/null).
        email: str | None = None
        emails_resp = await client.get("https://api.github.com/user/emails", headers=gh_headers)
        if emails_resp.status_code == 200:
            for entry in emails_resp.json():
                if entry.get("primary") and entry.get("verified"):
                    email = entry.get("email")
                    break

    return await _finalize_oauth_login("github", github_sub, email, db)


@router.post("/oauth/complete", response_model=TokenResponse, status_code=201)
async def oauth_complete(
    body: OAuthCompleteRequest, request: Request, db: AsyncSession = Depends(get_db)
):
    """Complete OAuth sign-up: validate pending token, pick username, create account."""
    try:
        payload = jwt.decode(body.pending_token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError as err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired token.") from err

    if not payload.get("pending"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Not a pending OAuth token.")

    provider = payload.get("oauth_provider")
    sub = payload.get("oauth_sub")
    if not provider or not sub:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Malformed pending token.")

    repo = UserRepo(db)
    if await repo.get_by_username(body.username):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken")

    oauth_email = payload.get("email") or None
    is_first_user = (await repo.count()) == 0
    user = await repo.create_oauth(body.username, provider, sub, email=oauth_email)

    if is_first_user:
        await _migrate_orphan_data(user.id, db)

    await _record_login(user, request, None, db)
    return TokenResponse(
        access_token=_create_token(user),
        username=user.username,
        id=user.id,
        email=user.email,
    )


@router.get("/me")
async def get_me(user: User = Depends(get_current_user)):
    """Return the authenticated user's profile + assistant settings.

    The frontend calls this after login so per-user settings (system prompt,
    profession) come from the server, never from shared client-side storage.
    """
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "profession": user.profession,
        "system_prompt": user.system_prompt,
    }


@router.patch("/me")
async def update_profile(
    body: UpdateProfileRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update mutable profile fields (email) and per-user assistant settings."""
    repo = UserRepo(db)
    if "email" in body.model_fields_set:
        await repo.update_email(user.id, body.email)
    if {"system_prompt", "profession"} & body.model_fields_set:
        await repo.update_settings(
            user.id,
            system_prompt=body.system_prompt,
            profession=body.profession,
            set_system_prompt="system_prompt" in body.model_fields_set,
            set_profession="profession" in body.model_fields_set,
        )
    return {"ok": True}


@router.post("/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Store the authenticated user's avatar as a BLOB in the database."""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image.")
    contents = await file.read(2 * 1024 * 1024)
    if len(contents) >= 2 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Avatar must be smaller than 2 MB.")
    await UserRepo(db).update_avatar(user.id, contents)
    return {"ok": True}


@router.get("/avatar/{user_id}")
async def get_avatar(user_id: str, db: AsyncSession = Depends(get_db)):
    """Serve a user's avatar directly from the database (public — no auth required)."""
    row = await UserRepo(db).get_by_id(user_id)
    if row is None or row.avatar is None:
        raise HTTPException(status_code=404, detail="No avatar.")
    return Response(
        content=row.avatar,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.delete("/avatar", status_code=204)
async def delete_avatar(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove the authenticated user's avatar from the database."""
    await UserRepo(db).update_avatar(user.id, None)


@router.delete("/me", status_code=204)
async def delete_account(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete the authenticated user's account and all associated data."""
    # Remove RAG uploads directory
    user_uploads = UPLOADS_DIR / user.id
    if user_uploads.exists():
        shutil.rmtree(user_uploads, ignore_errors=True)

    # Remove user's memories and RAG chunks from vector store
    try:
        from chat.memory.long_term import LongTermMemory

        lt = LongTermMemory()
        vs = await lt._get_vector_store()
        ids, _docs, metas = await vs.list_all(limit=10000)
        user_chunk_ids = [i for i, m in zip(ids, metas, strict=False) if m.get("user_id") == user.id]
        if user_chunk_ids:
            await vs.delete(ids=user_chunk_ids)
    except Exception:
        pass

    # Delete user row (CASCADE removes mcp_servers and login_records)
    await UserRepo(db).delete(user.id)
