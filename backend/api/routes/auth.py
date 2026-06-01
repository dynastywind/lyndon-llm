"""Authentication endpoints — register, login, delete account."""

from __future__ import annotations

import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path
import re

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from jose import jwt
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


class ResetPasswordRequest(BaseModel):
    username: str
    new_password: str


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
    payload = {"sub": user.id, "username": user.username, "exp": expire}
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

            orphan_ids = [i for i, m in zip(ids, metas) if not m.get("user_id")]
            orphan_docs = [d for d, m in zip(docs, metas) if not m.get("user_id")]
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
    )


@router.post("/login", response_model=TokenResponse)
async def login(
    body: AuthRequest, request: Request, db: AsyncSession = Depends(get_db)
):
    """Authenticate and return a JWT."""
    repo = UserRepo(db)
    user = await repo.get_by_username(body.username)
    if user is None or not _verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )
    await _record_login(user, request, body.device_id, db)
    return TokenResponse(
        access_token=_create_token(user),
        username=user.username,
        id=user.id,
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
        user_chunk_ids = [i for i, m in zip(ids, metas) if m.get("user_id") == user.id]
        if user_chunk_ids:
            await vs.delete(ids=user_chunk_ids)
    except Exception:
        pass

    # Delete user row (CASCADE removes mcp_servers and login_records)
    await UserRepo(db).delete(user.id)
