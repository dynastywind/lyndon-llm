from __future__ import annotations

from fastapi import APIRouter, Depends
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


class ChatRequest(BaseModel):
    message: str


class IngestRequest(BaseModel):
    source: str   # file path or URL


# ── Chat stream ───────────────────────────────────────────────────────────────

@router.post("/")
async def chat(
    body: ChatRequest,
    session: Session = Depends(get_session),
    db: AsyncSession = Depends(get_db),
):
    engine = ChatEngine(session, db=db)

    async def _generate():
        async for chunk in engine.stream_response(body.message):
            yield chunk

    return StreamingResponse(_generate(), media_type="text/plain")


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


@router.get("/sessions/{session_id}/messages")
async def get_session_messages(session_id: str, db: AsyncSession = Depends(get_db)):
    """Return all messages for a session (for history display / resumption)."""
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
            }
            for m in messages
        ]
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
