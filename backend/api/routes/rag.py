"""
RAG management endpoints — file upload, source listing, source deletion.
"""

from __future__ import annotations

from pathlib import Path
import shutil

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

from api.auth_deps import get_current_user
from chat.rag.ingestion.pipeline import IngestPipeline, ingest_pipeline
from db.models.user import User

router = APIRouter()

ALLOWED_EXTENSIONS = {
    ".pdf",
    ".md",
    ".mdx",
    ".txt",
    ".py",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".go",
    ".rs",
    ".java",
    ".cpp",
    ".c",
}

# Stable upload directory — kept across restarts so the source path in
# ChromaDB metadata stays valid for future delete operations.
UPLOADS_DIR = Path("data/rag_uploads")


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
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

    user_dir = UPLOADS_DIR / user.id
    user_dir.mkdir(parents=True, exist_ok=True)
    dest = user_dir / (file.filename or "upload")

    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    chunks_stored = await ingest_pipeline.ingest(str(dest), user_id=user.id)
    return {
        "filename": file.filename,
        "path": str(dest),
        "chunks_stored": chunks_stored,
    }


@router.get("/sources")
async def list_sources(user: User = Depends(get_current_user)):
    """Return all distinct source paths for the authenticated user."""
    from db.vector.store import get_vector_store

    vs = await get_vector_store(IngestPipeline.COLLECTION_NAME)
    sources = await vs.list_sources(user_id=user.id)
    return {"sources": sources}


@router.delete("/sources")
async def delete_source(
    source: str = Query(..., description="Source path to remove"),
    user: User = Depends(get_current_user),
):
    """Remove all chunks for the given source from the vector store."""
    from db.vector.store import get_vector_store

    vs = await get_vector_store(IngestPipeline.COLLECTION_NAME)
    await vs.delete_by_source(source)
    return {"status": "ok", "deleted": source}
