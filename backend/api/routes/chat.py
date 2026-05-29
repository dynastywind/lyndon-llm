from __future__ import annotations

import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_session
from chat.engine import ChatEngine
from chat.rag.ingestion.pipeline import ingest_pipeline
from core.permissions.gate import Mode
from core.session.manager import Session, session_manager
from db.base import get_db
from db.repos.chat import ChatRepo

router = APIRouter()


class AttachmentPayload(BaseModel):
    name: str
    type: str   # MIME type, e.g. "image/png"
    data: str   # raw base64 (no "data:...;base64," prefix)


class ChatRequest(BaseModel):
    message: str
    attachments: list[AttachmentPayload] = []


class IngestRequest(BaseModel):
    source: str   # file path or URL


# ── Chat stream ───────────────────────────────────────────────────────────────

def _sse(event_type: str, data: dict) -> str:
    """Format a single SSE frame."""
    return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"


@router.post("/")
async def chat(
    body: ChatRequest,
    session: Session = Depends(get_session),
    db: AsyncSession = Depends(get_db),
):
    engine = ChatEngine(session, db=db)
    attachments = [a.model_dump() for a in body.attachments] if body.attachments else None

    async def _generate():
        async for event in engine.stream_response(body.message, attachments=attachments):
            evt_type = event["type"]
            payload = {k: v for k, v in event.items() if k != "type"}
            yield _sse(evt_type, payload)
        yield _sse("done", {})

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # disable nginx buffering
        },
    )


# ── Session management ────────────────────────────────────────────────────────

@router.post("/sessions")
async def create_chat_session(db: AsyncSession = Depends(get_db)):
    """Create a new in-memory + DB session and return its ID."""
    session = session_manager.create(mode=Mode.CHAT)
    repo = ChatRepo(db)
    row = await repo.create_session(session.session_id, mode="chat")
    return _session_dict(row)


@router.get("/sessions")
async def list_chat_sessions(
    mode: str = "chat",
    limit: int = 20,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    """Paginated list of sessions ordered by most recently active."""
    repo = ChatRepo(db)
    rows, total = await repo.list_sessions(mode=mode, limit=limit, offset=offset)
    return {"sessions": [_session_dict(r) for r in rows], "total": total}


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_chat_session(session_id: str, db: AsyncSession = Depends(get_db)):
    """Permanently delete a session and all its messages."""
    repo = ChatRepo(db)
    deleted = await repo.delete_session(session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")
    # Also evict from the in-memory session store
    session_manager.destroy(session_id)


@router.get("/sessions/{session_id}/messages/all")
async def get_all_session_messages(
    session_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Return every message for a session in chronological order (no limit)."""
    repo = ChatRepo(db)
    messages = await repo.get_messages(session_id)
    return {
        "messages": [
            {
                "id": m.id,
                "role": m.role,
                "content": m.content,
                "tool_name": m.tool_name,
                "created_at": m.created_at.isoformat(),
                "attachments": repo._attachments(m),
            }
            for m in messages
        ]
    }


@router.get("/sessions/{session_id}/messages")
async def get_session_messages(
    session_id: str,
    limit: int = Query(default=5, ge=1, le=50),
    before: Optional[str] = Query(default=None, description="ISO-8601 cursor — return messages older than this timestamp"),
    db: AsyncSession = Depends(get_db),
):
    """
    Return up to `limit` messages before the cursor, newest-first then
    reversed to chronological order. Used for paginated history loading.
    """
    repo = ChatRepo(db)
    before_dt = datetime.fromisoformat(before) if before else None
    messages, has_more = await repo.get_messages_before(session_id, limit, before_dt)
    return {
        "messages": [
            {
                "id": m.id,
                "role": m.role,
                "content": m.content,
                "tool_name": m.tool_name,
                "created_at": m.created_at.isoformat(),
                "attachments": repo._attachments(m),
            }
            for m in messages
        ],
        "has_more": has_more,
    }


# ── RAG ingest ────────────────────────────────────────────────────────────────

@router.post("/ingest")
async def ingest(body: IngestRequest):
    count = await ingest_pipeline.ingest(body.source)
    return {"status": "ok", "chunks_stored": count}


# ── Memory ────────────────────────────────────────────────────────────────────

@router.get("/memory")
async def get_memories(query: str, session: Session = Depends(get_session)):
    from chat.memory.manager import MemoryManager
    mgr = MemoryManager(session.session_id)
    memories = await mgr.retrieve_memories(query)
    return {"memories": [m.model_dump(exclude={"embedding"}) for m in memories]}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _session_dict(row) -> dict:
    return {
        "session_id": row.id,
        "mode": row.mode,
        "title": row.title,
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
    }
