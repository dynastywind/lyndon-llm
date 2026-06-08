"""GitHub integration — connect (OAuth, repo scope) and list repos for Code mode.

The login OAuth (``/api/auth/github/*``) only requests ``read:user user:email`` and
discards the token. This router adds a *connect* flow that requests ``repo`` scope and
stores the token (encrypted) against the logged-in user, plus an endpoint to list the
user's repos. Cloning itself lives in ``/api/code/clone``.

The OAuth callback is shared with login (``/api/auth/github/callback``) because GitHub
requires the ``redirect_uri`` path to be a subdirectory of the app's single registered
callback URL. The connect flow is distinguished by a signed ``state`` JWT carrying the
user id; ``auth.github_callback`` detects it and routes here via :func:`store_connect_token`.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
import logging
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, status
import httpx
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth_deps import get_current_user
from config.settings import settings
from core.security.crypto import memory_cipher
from db.base import get_db
from db.models.user import User
from db.repos.user import UserRepo

logger = logging.getLogger(__name__)

router = APIRouter()

_CONNECT_PURPOSE = "gh_connect"
_GITHUB_API = "https://api.github.com"


def _connect_state(user_id: str) -> str:
    """Signed, short-lived token proving the connect request belongs to *user_id*."""
    payload = {
        "purpose": _CONNECT_PURPOSE,
        "sub": user_id,
        "exp": datetime.now(UTC) + timedelta(minutes=15),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_connect_state(state: str | None) -> str | None:
    """Return the user id if *state* is a valid connect token, else None (login flow)."""
    if not state:
        return None
    try:
        payload = jwt.decode(state, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None
    if payload.get("purpose") != _CONNECT_PURPOSE:
        return None
    sub = payload.get("sub")
    return sub if isinstance(sub, str) else None


async def store_connect_token(user_id: str, access_token: str, db: AsyncSession) -> None:
    """Encrypt and persist the GitHub access token for *user_id*. Called from the callback."""
    encrypted = memory_cipher.encrypt(access_token, scope_id=user_id)
    await UserRepo(db).set_github_token(user_id, encrypted)


def _decrypt_token(user: User) -> str | None:
    if not user.github_token:
        return None
    return memory_cipher.decrypt(user.github_token, scope_id=user.id)


@router.get("/connect/authorize")
async def connect_authorize(user: User = Depends(get_current_user)):
    """Return the GitHub consent URL (repo scope) for the logged-in user to connect."""
    if not settings.github_client_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GitHub is not configured.",
        )
    params = {
        "client_id": settings.github_client_id,
        # Reuse the registered login callback (GitHub requires the redirect path to be a
        # subdirectory of the app's single callback URL); the connect state routes it.
        "redirect_uri": settings.github_redirect_uri,
        "scope": "repo read:user",
        "state": _connect_state(user.id),
        "allow_signup": "false",
    }
    return {"url": "https://github.com/login/oauth/authorize?" + urlencode(params)}


@router.get("/status")
async def connect_status(user: User = Depends(get_current_user)):
    """Whether the user has a stored GitHub token."""
    return {"connected": bool(user.github_token)}


@router.delete("/connect")
async def disconnect(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Remove the stored GitHub token."""
    await UserRepo(db).set_github_token(user.id, None)
    return {"connected": False}


@router.get("/repos")
async def list_repos(
    search: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List the user's GitHub repos (most recently updated first)."""
    token = _decrypt_token(user)
    if not token:
        return {"connected": False, "repos": []}

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "LyndonLLM",
    }
    repos: list[dict] = []
    async with httpx.AsyncClient(timeout=20) as client:
        for page in (1, 2):  # up to 200 most-recent repos
            resp = await client.get(
                f"{_GITHUB_API}/user/repos",
                headers=headers,
                params={
                    "per_page": 100,
                    "page": page,
                    "sort": "updated",
                    "affiliation": "owner,collaborator,organization_member",
                },
            )
            if resp.status_code == 401:
                # Token revoked/expired — clear it so the UI prompts to reconnect.
                await UserRepo(db).set_github_token(user.id, None)
                return {"connected": False, "repos": []}
            if resp.status_code != 200:
                raise HTTPException(status_code=502, detail="Failed to fetch GitHub repos.")
            batch = resp.json()
            repos.extend(batch)
            if len(batch) < 100:
                break

    items = [
        {
            "full_name": r["full_name"],
            "clone_url": r["clone_url"],
            "private": r.get("private", False),
            "default_branch": r.get("default_branch", "main"),
            "updated_at": r.get("updated_at"),
        }
        for r in repos
    ]
    if search:
        q = search.lower()
        items = [r for r in items if q in r["full_name"].lower()]
    return {"connected": True, "repos": items}


@router.get("/branches")
async def list_branches(
    repo: str,  # "owner/name"
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List branches for a repo (default branch first)."""
    token = _decrypt_token(user)
    if not token:
        return {"connected": False, "branches": []}
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "LyndonLLM",
    }
    async with httpx.AsyncClient(timeout=20) as client:
        meta = await client.get(f"{_GITHUB_API}/repos/{repo}", headers=headers)
        default_branch = meta.json().get("default_branch") if meta.status_code == 200 else None
        resp = await client.get(
            f"{_GITHUB_API}/repos/{repo}/branches",
            headers=headers,
            params={"per_page": 100},
        )
        if resp.status_code == 401:
            await UserRepo(db).set_github_token(user.id, None)
            return {"connected": False, "branches": []}
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail="Failed to fetch branches.")
        names = [b["name"] for b in resp.json()]
    branches = [{"name": n, "default": n == default_branch} for n in names]
    branches.sort(key=lambda b: (not b["default"], b["name"]))  # default first, then alpha
    return {"connected": True, "branches": branches}
