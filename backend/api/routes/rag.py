"""
RAG management endpoints — file upload, source listing, source deletion, re-index.
"""

from __future__ import annotations

from pathlib import Path
import shutil

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

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


def _assert_upload_access(p: Path, user_id: str) -> None:
    """Raise 403 if *p* is not within the uploads area owned by *user_id*.

    Two layouts are accepted:
    - ``data/rag_uploads/<user_id>/<file>``  — current layout
    - ``data/rag_uploads/<file>``            — legacy layout (pre-user-subdirectory)

    A path that resolves under a *different* user's subdirectory is always blocked.
    """
    uploads_dir = UPLOADS_DIR.resolve()
    resolved = p.resolve()
    try:
        rel = resolved.relative_to(uploads_dir)
    except ValueError as exc:
        raise HTTPException(403, "Access denied") from exc

    # rel.parts[0] is either the user_id subdirectory or the bare filename
    if len(rel.parts) > 1 and rel.parts[0] != user_id:
        raise HTTPException(403, "Access denied")


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


@router.get("/sources/check")
async def check_source_name(
    name: str = Query(..., description="Filename to check for existence"),
    user: User = Depends(get_current_user),
):
    """Return whether a file with this name already exists for the user."""
    dest = UPLOADS_DIR / user.id / name
    exists = dest.exists()
    return {"exists": exists, "path": str(dest) if exists else None}


@router.get("/sources/content")
async def get_source_content(
    source: str = Query(..., description="Source path to read"),
    user: User = Depends(get_current_user),
):
    """Return file content for the viewer.

    PDFs are served as binary (FileResponse).
    All other file types are returned as JSON ``{"content": str, "ext": str}``.

    Ownership is verified via ChromaDB metadata rather than path inspection so
    that files ingested from outside the uploads directory (e.g. via the chat
    ingest tool) can still be viewed by the user who indexed them.
    """
    from db.vector.store import get_vector_store

    vs = await get_vector_store(IngestPipeline.COLLECTION_NAME)
    _ids, _docs, metas = await vs.list_all(limit=100_000)
    user_sources = {meta.get("source", "") for meta in metas if meta.get("user_id") == user.id}
    if source not in user_sources:
        raise HTTPException(403, "Access denied")

    p = Path(source)
    if not p.exists():
        raise HTTPException(404, "File not found on disk")

    if p.suffix.lower() == ".pdf":
        return FileResponse(path=str(p), media_type="application/pdf", filename=p.name)

    try:
        content = p.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(415, "File cannot be read as text") from exc

    return {"content": content, "ext": p.suffix.lower()}


@router.get("/sources")
async def list_sources(
    limit: int = Query(10, ge=1, le=200, description="Page size"),
    offset: int = Query(0, ge=0, description="Number of records to skip"),
    query: str = Query("", description="Filter sources by filename (case-insensitive)"),
    user: User = Depends(get_current_user),
):
    """
    Return paginated sources for the authenticated user with chunk counts and
    file size.  Supports optional name search and limit/offset pagination.
    """
    from db.vector.store import get_vector_store

    vs = await get_vector_store(IngestPipeline.COLLECTION_NAME)
    _ids, _docs, metas = await vs.list_all(limit=100_000)

    # Count chunks per source for this user
    counts: dict[str, int] = {}
    for meta in metas:
        if meta.get("user_id") != user.id:
            continue
        src = meta.get("source", "")
        if src:
            counts[src] = counts.get(src, 0) + 1

    # Build full result list (sorted by name for stable ordering)
    all_sources = []
    for src, chunk_count in sorted(counts.items(), key=lambda kv: Path(kv[0]).name.lower()):
        p = Path(src)
        size_bytes = p.stat().st_size if p.exists() else None
        all_sources.append({
            "path": src,
            "name": p.name,
            "chunks": chunk_count,
            "size_bytes": size_bytes,
        })

    # Server-side search filter
    if query:
        q = query.lower()
        all_sources = [s for s in all_sources if q in s["name"].lower()]

    total = len(all_sources)
    page_sources = all_sources[offset : offset + limit]

    return {"sources": page_sources, "total": total}


@router.post("/reindex")
async def reindex_source(
    source: str = Query(..., description="Source path to re-ingest"),
    user: User = Depends(get_current_user),
):
    """Re-ingest an already-uploaded file from disk (replaces existing chunks)."""
    p = Path(source)
    _assert_upload_access(p, user.id)

    if not p.exists():
        raise HTTPException(404, "File not found on disk")

    chunks_stored = await ingest_pipeline.ingest(str(p), user_id=user.id)
    return {"path": source, "chunks_stored": chunks_stored}


@router.delete("/sources")
async def delete_source(
    source: str = Query(..., description="Source path to remove"),
    delete_file: bool = Query(True, description="Also delete the file from disk"),
    user: User = Depends(get_current_user),
):
    """
    Remove all chunks for the given source from the vector store and
    (by default) delete the file from disk.
    """
    from db.vector.store import get_vector_store

    vs = await get_vector_store(IngestPipeline.COLLECTION_NAME)
    await vs.delete_by_source(source)

    if delete_file:
        p = Path(source)
        try:
            _assert_upload_access(p, user.id)
            if p.exists():
                p.unlink()
        except HTTPException:
            pass  # silently ignore paths outside allowed dirs

    return {"status": "ok", "deleted": source}
