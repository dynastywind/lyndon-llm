from __future__ import annotations

from datetime import UTC, datetime
import json

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
    type: str  # MIME type, e.g. "image/png"
    data: str  # raw base64 (no "data:...;base64," prefix)


class ChatRequest(BaseModel):
    message: str
    attachments: list[AttachmentPayload] = []
    system_prompt: str | None = None  # global instruction injected into system prompt
    session_prompt: str | None = (
        None  # one-off per-session instruction; prepended to first LLM user turn only
    )
    model: str | None = None  # override the default LLM model for this request


class IngestRequest(BaseModel):
    source: str  # file path or URL


# ── Chat stream ───────────────────────────────────────────────────────────────


def _iso(dt: datetime) -> str:
    """
    Return an ISO-8601 string with an explicit UTC offset (+00:00).

    SQLite stores datetimes as naive strings, so SQLAlchemy returns naive
    datetime objects.  Without an explicit offset, JavaScript's ``new Date()``
    interprets the string as *local* time rather than UTC, shifting every
    timestamp by the user's UTC offset.  Tagging the value as UTC here lets
    the browser convert it correctly to the user's local time.
    """
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.isoformat()


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
        async for event in engine.stream_response(
            body.message,
            attachments=attachments,
            custom_system_prompt=body.system_prompt or None,
            session_prompt=body.session_prompt or None,
            model=body.model or None,
        ):
            evt_type = event["type"]
            payload = {k: v for k, v in event.items() if k != "type"}
            yield _sse(evt_type, payload)
        yield _sse("done", {})

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable nginx buffering
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


class RenameRequest(BaseModel):
    title: str


@router.patch("/sessions/{session_id}", status_code=200)
async def rename_chat_session(
    session_id: str,
    body: RenameRequest,
    db: AsyncSession = Depends(get_db),
):
    """Rename a session."""
    repo = ChatRepo(db)
    ok = await repo.rename_session(session_id, body.title)
    if not ok:
        raise HTTPException(status_code=404, detail="Session not found")
    row = await repo.get_session(session_id)
    return _session_dict(row)


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
                "created_at": _iso(m.created_at),
                "attachments": repo._attachments(m),
            }
            for m in messages
        ]
    }


@router.get("/sessions/{session_id}/messages")
async def get_session_messages(
    session_id: str,
    limit: int = Query(default=5, ge=1, le=50),
    before: str | None = Query(
        default=None, description="ISO-8601 cursor — return messages older than this timestamp"
    ),
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
                "created_at": _iso(m.created_at),
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


@router.get("/memories")
async def list_memories():
    """Return all long-term memories, newest-first."""
    from chat.memory.long_term import LongTermMemory

    lt = LongTermMemory()
    items = await lt.list_all()
    return {"memories": items, "total": len(items)}


@router.delete("/memories/{memory_id}", status_code=204)
async def delete_memory(memory_id: str):
    """Permanently delete a long-term memory by ID."""
    from chat.memory.long_term import LongTermMemory

    lt = LongTermMemory()
    await lt.delete(memory_id)


# ── Helpers ───────────────────────────────────────────────────────────────────


def _session_dict(row) -> dict:
    return {
        "session_id": row.id,
        "mode": row.mode,
        "title": row.title,
        "created_at": _iso(row.created_at),
        "updated_at": _iso(row.updated_at),
    }
