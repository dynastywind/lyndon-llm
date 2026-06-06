from __future__ import annotations

import asyncio
from datetime import UTC, datetime
import json

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth_deps import get_current_user, get_optional_user
from api.deps import get_session
from chat.engine import ChatEngine
from chat.rag.ingestion.pipeline import ingest_pipeline
from core.permissions.gate import Mode
from core.session.manager import Session, session_manager
from db.base import get_db
from db.models.user import User
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
    skill_id: str | None = None  # slash-command: force routing to this skill's tools only
    skill_prefix: str | None = None  # "/skill-name" prefix to persist with user message
    effort_mode: str | None = None  # "low" | "medium" | "high" — controls response verbosity


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
    user: User | None = Depends(get_optional_user),
):
    from core.session.stream_registry import stream_registry

    attachments = [a.model_dump() for a in body.attachments] if body.attachments else None
    user_id = user.id if user else None

    # Create the in-memory event buffer and mark the session as streaming in DB
    buf = stream_registry.start(session.session_id)
    repo = ChatRepo(db)
    await repo.set_streaming(session.session_id, True)

    # Run the LLM as a background task so the stream survives client disconnects
    async def _run_llm() -> None:
        from db.base import AsyncSessionLocal

        try:
            async with AsyncSessionLocal() as task_db:
                engine = ChatEngine(session, db=task_db, user_id=user_id)
                async for event in engine.stream_response(
                    body.message,
                    attachments=attachments,
                    custom_system_prompt=body.system_prompt or None,
                    session_prompt=body.session_prompt or None,
                    model=body.model or None,
                    skill_id=body.skill_id or None,
                    skill_prefix=body.skill_prefix or None,
                    effort_mode=body.effort_mode or None,
                ):
                    await buf.push(event)
            await buf.finish()
        except Exception as exc:  # noqa: BLE001
            await buf.finish(error=str(exc))
        finally:
            from db.base import AsyncSessionLocal as _ASL  # noqa: PLC0415

            async with _ASL() as done_db:
                await ChatRepo(done_db).set_streaming(session.session_id, False)
            stream_registry.remove(session.session_id)

    asyncio.create_task(_run_llm())

    async def _generate():
        async for event in buf.subscribe(start_idx=0):
            evt_type = event["type"]
            payload = {k: v for k, v in event.items() if k != "type"}
            yield _sse(evt_type, payload)
        if buf.error:
            yield _sse("error", {"message": buf.error})
        yield _sse("done", {})

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable nginx buffering
        },
    )


# ── Chat planner Phase 2 ─────────────────────────────────────────────────────


class PlanConfirmRequest(BaseModel):
    plan_id: str


class PlanCancelRequest(BaseModel):
    plan_id: str


@router.post("/plan/confirm")
async def confirm_chat_plan(
    body: PlanConfirmRequest,
    session: Session = Depends(get_session),
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    """Phase 2: execute the pending plan and stream progress as SSE."""
    from cowork.planner import Plan

    pending: Plan | None = session.metadata.get("pending_plan")
    if not pending or pending.plan_id != body.plan_id:
        raise HTTPException(status_code=404, detail="No pending plan found for this session")

    pending.approved = True
    del session.metadata["pending_plan"]

    from chat.executor import ChatExecutor

    executor = ChatExecutor(session)
    full_response_parts: list[str] = []

    async def _generate():
        async for event in executor.run(pending):
            evt_type = event["type"]
            if evt_type == "token":
                full_response_parts.append(event.get("text", ""))
            payload = {k: v for k, v in event.items() if k != "type"}
            yield _sse(evt_type, payload)
        yield _sse("done", {})

        # Persist the synthesized assistant response
        if db and full_response_parts:
            full_text = "".join(full_response_parts)
            _repo = ChatRepo(db)
            await _repo.add_message(session.session_id, "assistant", full_text)
            await _repo.maybe_set_title(session.session_id, pending.goal)

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/plan/cancel")
async def cancel_chat_plan(
    body: PlanCancelRequest,
    session: Session = Depends(get_session),
):
    """Discard the pending plan without executing it."""
    pending = session.metadata.get("pending_plan")
    if pending and pending.plan_id == body.plan_id:
        del session.metadata["pending_plan"]
    return {"status": "cancelled"}


# ── Session management ────────────────────────────────────────────────────────


@router.post("/sessions")
async def create_chat_session(
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    """Create a new in-memory + DB session and return its ID."""
    session = session_manager.create(mode=Mode.CHAT)
    repo = ChatRepo(db)
    row = await repo.create_session(session.session_id, mode="chat", user_id=user.id if user else None)
    return _session_dict(row)


@router.get("/sessions")
async def list_chat_sessions(
    mode: str = "chat",
    limit: int = 20,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    """Paginated list of sessions ordered by most recently active."""
    if user is None:
        return {"sessions": [], "total": 0}
    repo = ChatRepo(db)
    rows, total = await repo.list_sessions(mode=mode, limit=limit, offset=offset, user_id=user.id)
    return {"sessions": [_session_dict(r) for r in rows], "total": total}


@router.get("/sessions/search")
async def search_chat_sessions(
    q: str = Query(..., min_length=1, description="Search query"),
    mode: str = "chat",
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    """Search sessions by title or message content (case-insensitive LIKE)."""
    if user is None:
        return {"sessions": [], "total": 0}
    repo = ChatRepo(db)
    rows, total, snippets = await repo.search_sessions(
        query=q, mode=mode, user_id=user.id, limit=limit, offset=offset
    )
    return {
        "sessions": [
            {**_session_dict(r), "snippet": snippets.get(r.id)}
            for r in rows
        ],
        "total": total,
    }


@router.get("/sessions/{session_id}/stream/status")
async def stream_status(session_id: str):
    """Return whether an LLM background task is currently active for this session."""
    from core.session.stream_registry import stream_registry

    return {"streaming": stream_registry.get(session_id) is not None}


@router.get("/sessions/{session_id}/stream/resume")
async def resume_stream(session_id: str):
    """
    Re-attach to an in-progress LLM stream.

    Replays all accumulated events from the beginning then continues with new
    ones until the task finishes.  Returns 404 when no active stream exists
    (server restarted, or stream already completed).
    """
    from core.session.stream_registry import stream_registry

    buf = stream_registry.get(session_id)
    if buf is None:
        raise HTTPException(404, "No active stream for this session")

    async def _generate():
        async for event in buf.subscribe(start_idx=0):
            evt_type = event["type"]
            payload = {k: v for k, v in event.items() if k != "type"}
            yield _sse(evt_type, payload)
        if buf.error:
            yield _sse("error", {"message": buf.error})
        yield _sse("done", {})

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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
                "tool_calls": repo._tool_calls(m),
                "skill_prefix": m.skill_prefix,
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
                "tool_calls": repo._tool_calls(m),
                "skill_prefix": m.skill_prefix,
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
async def get_memories(
    query: str,
    session: Session = Depends(get_session),
    user: User | None = Depends(get_optional_user),
):
    from chat.memory.manager import MemoryManager

    mgr = MemoryManager(session.session_id, user_id=user.id if user else None)
    memories = await mgr.retrieve_memories(query)
    return {"memories": [m.model_dump(exclude={"embedding"}) for m in memories]}


@router.get("/memories")
async def list_memories(user: User = Depends(get_current_user)):
    """Return all long-term memories for the authenticated user, newest-first."""
    from chat.memory.long_term import LongTermMemory

    lt = LongTermMemory()
    items = await lt.list_all(user_id=user.id)
    return {"memories": items, "total": len(items)}


@router.delete("/memories/{memory_id}", status_code=204)
async def delete_memory(memory_id: str, user: User = Depends(get_current_user)):
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
        "streaming": getattr(row, "streaming", False),
    }
