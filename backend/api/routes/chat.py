from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from api.deps import get_session
from chat.engine import ChatEngine
from chat.rag.ingestion.pipeline import ingest_pipeline
from core.session.manager import Session

router = APIRouter()


class ChatRequest(BaseModel):
    message: str


class IngestRequest(BaseModel):
    source: str   # file path or URL


@router.post("/")
async def chat(
    body: ChatRequest,
    session: Session = Depends(get_session),
):
    engine = ChatEngine(session)

    async def _generate():
        async for chunk in engine.stream_response(body.message):
            yield chunk

    return StreamingResponse(_generate(), media_type="text/plain")


@router.post("/ingest")
async def ingest(body: IngestRequest):
    count = await ingest_pipeline.ingest(body.source)
    return {"status": "ok", "chunks_stored": count}


@router.get("/memory")
async def get_memories(query: str, session: Session = Depends(get_session)):
    from chat.memory.manager import MemoryManager
    mgr = MemoryManager(session.session_id)
    memories = await mgr.retrieve_memories(query)
    return {"memories": [m.model_dump(exclude={"embedding"}) for m in memories]}
