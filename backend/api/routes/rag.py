"""
RAG management endpoints — file upload, source listing, source deletion.
"""
from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Query, UploadFile

from chat.rag.ingestion.pipeline import ingest_pipeline, IngestPipeline

router = APIRouter()

ALLOWED_EXTENSIONS = {
    ".pdf", ".md", ".mdx", ".txt",
    ".py", ".ts", ".tsx", ".js", ".jsx",
    ".go", ".rs", ".java", ".cpp", ".c",
}

# Stable upload directory — kept across restarts so the source path in
# ChromaDB metadata stays valid for future delete operations.
UPLOADS_DIR = Path("data/rag_uploads")


@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """Accept a file upload, persist it to disk, and ingest into the vector store."""
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail=(
                f"Unsupported file type '{suffix}'. "
                f"Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
            ),
        )

    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    dest = UPLOADS_DIR / (file.filename or "upload")

    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    chunks_stored = await ingest_pipeline.ingest(str(dest))
    return {
        "filename": file.filename,
        "path": str(dest),
        "chunks_stored": chunks_stored,
    }


@router.get("/sources")
async def list_sources():
    """Return all distinct source paths currently indexed in the vector store."""
    from db.vector.store import get_vector_store

    vs = await get_vector_store(IngestPipeline.COLLECTION_NAME)
    sources = await vs.list_sources()
    return {"sources": sources}


@router.delete("/sources")
async def delete_source(source: str = Query(..., description="Source path to remove")):
    """Remove all chunks for the given source from the vector store."""
    from db.vector.store import get_vector_store

    vs = await get_vector_store(IngestPipeline.COLLECTION_NAME)
    await vs.delete_by_source(source)
    return {"status": "ok", "deleted": source}
