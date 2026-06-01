"""Authentication endpoints — register, login, delete account."""

from __future__ import annotations

import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, status
from jose import jwt
from pydantic import BaseModel
from sqlalchemy import text, update
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth_deps import get_current_user
from config.settings import settings
from db.base import get_db
from db.models.user import User
from db.repos.user import UserRepo

router = APIRouter()

UPLOADS_DIR = Path("data/rag_uploads")


# ── Models ────────────────────────────────────────────────────────────────────


class AuthRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str
    id: str


# ── Helpers ───────────────────────────────────────────────────────────────────


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def _verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def _create_token(user: User) -> str:
    expire = datetime.now(UTC) + timedelta(days=settings.jwt_expire_days)
    payload = {"sub": user.id, "username": user.username, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


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
                # Need embeddings — re-embed in batches
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
async def register(body: AuthRequest, db: AsyncSession = Depends(get_db)):
    """Register a new user. The first user claims all existing anonymous data."""
    repo = UserRepo(db)
    if await repo.get_by_username(body.username):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken")

    is_first_user = (await repo.count()) == 0
    user = await repo.create(body.username, _hash_password(body.password))

    if is_first_user:
        await _migrate_orphan_data(user.id, db)

    return TokenResponse(
        access_token=_create_token(user),
        username=user.username,
        id=user.id,
    )


@router.post("/login", response_model=TokenResponse)
async def login(body: AuthRequest, db: AsyncSession = Depends(get_db)):
    """Authenticate and return a JWT."""
    repo = UserRepo(db)
    user = await repo.get_by_username(body.username)
    if user is None or not _verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )
    return TokenResponse(
        access_token=_create_token(user),
        username=user.username,
        id=user.id,
    )


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

    # Remove user's memories from vector store
    try:
        from chat.memory.long_term import LongTermMemory

        lt = LongTermMemory()
        vs = await lt._get_vector_store()
        ids, _docs, metas = await vs.list_all(limit=10000)
        user_ids = [i for i, m in zip(ids, metas) if m.get("user_id") == user.id]
        if user_ids:
            await vs.delete(ids=user_ids)
    except Exception:
        pass

    # Delete user row (CASCADE removes mcp_servers; SET NULL preserves chat_sessions)
    await UserRepo(db).delete(user.id)
