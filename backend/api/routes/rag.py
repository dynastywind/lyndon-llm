"""
RAG management endpoints — file upload, source listing, source deletion, re-index.
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
    """Return all sources for the authenticated user with chunk counts and file size."""
    from db.vector.store import get_vector_store

    vs = await get_vector_store(IngestPipeline.COLLECTION_NAME)
    ids, _docs, metas = await vs.list_all(limit=100_000)

    # Count chunks per source for this user
    counts: dict[str, int] = {}
    for i, meta in zip(ids, metas):
        if meta.get("user_id") != user.id:
            continue
        src = meta.get("source", "")
        if src:
            counts[src] = counts.get(src, 0) + 1

    result = []
    for src, chunk_count in sorted(counts.items()):
        p = Path(src)
        size_bytes = p.stat().st_size if p.exists() else None
        result.append({
            "path": src,
            "name": p.name,
            "chunks": chunk_count,
            "size_bytes": size_bytes,
        })
    return {"sources": result}


@router.post("/reindex")
async def reindex_source(
    source: str = Query(..., description="Source path to re-ingest"),
    user: User = Depends(get_current_user),
):
    """Re-ingest an already-uploaded file from disk (replaces existing chunks)."""
    p = Path(source)
    # Security: ensure path is inside this user's upload directory
    user_dir = (UPLOADS_DIR / user.id).resolve()
    try:
        p.resolve().relative_to(user_dir)
    except ValueError:
        raise HTTPException(403, "Access denied")

    if not p.exists():
        raise HTTPException(404, "File not found on disk")

    chunks_stored = await ingest_pipeline.ingest(str(p), user_id=user.id)
    return {"path": source, "chunks_stored": chunks_stored}


@router.delete("/sources")
async def delete_source(
    source: str = Query(..., description="Source path to remove"),
    delete_file: bool = Query(False, description="Also delete the file from disk"),
    user: User = Depends(get_current_user),
):
    """Remove all chunks for the given source from the vector store."""
    from db.vector.store import get_vector_store

    vs = await get_vector_store(IngestPipeline.COLLECTION_NAME)
    await vs.delete_by_source(source)

    if delete_file:
        p = Path(source)
        user_dir = (UPLOADS_DIR / user.id).resolve()
        try:
            p.resolve().relative_to(user_dir)
            if p.exists():
                p.unlink()
        except ValueError:
            pass  # silently ignore paths outside user dir

    return {"status": "ok", "deleted": source}
