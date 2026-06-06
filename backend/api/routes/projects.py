"""
Project endpoints — group chat sessions under a shared brief and context.

Projects are scoped to a single mode (chat / cowork / code) and a single user.
Member sessions are hidden from Recents/Pinned (see ``ChatRepo.list_sessions``)
but remain searchable.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
import shutil

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth_deps import get_current_user, get_optional_user
from api.routes.rag import ALLOWED_EXTENSIONS, UPLOADS_DIR
from chat.rag.ingestion.pipeline import IngestPipeline, ingest_pipeline
from db.base import get_db
from db.models.user import User
from db.repos.project import ProjectRepo

router = APIRouter()


# ── Schemas ─────────────────────────────────────────────────────────────────


class FolderRef(BaseModel):
    path: str
    name: str


class CreateProjectRequest(BaseModel):
    mode: str = "chat"
    name: str
    instructions: str | None = None


class UpdateProjectRequest(BaseModel):
    name: str | None = None
    instructions: str | None = None
    folders: list[FolderRef] | None = None


# ── Helpers ─────────────────────────────────────────────────────────────────


def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.isoformat()


def _project_dict(row, chat_count: int = 0) -> dict:
    return {
        "id": row.id,
        "mode": row.mode,
        "name": row.name,
        "instructions": row.instructions,
        "folders": ProjectRepo.folders(row),
        "created_at": _iso(row.created_at),
        "updated_at": _iso(row.updated_at),
        "chat_count": chat_count,
    }


def _session_dict(row) -> dict:
    return {
        "session_id": row.id,
        "mode": row.mode,
        "title": row.title,
        "project_id": row.project_id,
        "created_at": _iso(row.created_at),
        "updated_at": _iso(row.updated_at),
        "streaming": getattr(row, "streaming", False),
    }


async def _owned_project(repo: ProjectRepo, project_id: str, user: User | None):
    """Fetch a project, 404 if missing and 403 if it belongs to another user."""
    row = await repo.get(project_id)
    if row is None:
        raise HTTPException(404, "Project not found")
    if user is not None and row.user_id is not None and row.user_id != user.id:
        raise HTTPException(403, "Access denied")
    return row


def _project_dir(user_id: str, project_id: str) -> Path:
    return UPLOADS_DIR / user_id / "projects" / project_id


# ── Project CRUD ─────────────────────────────────────────────────────────────


@router.post("/")
async def create_project(
    body: CreateProjectRequest,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    if not body.name.strip():
        raise HTTPException(422, "Project name is required")
    repo = ProjectRepo(db)
    row = await repo.create(
        mode=body.mode,
        name=body.name.strip(),
        user_id=user.id if user else None,
        instructions=(body.instructions or "").strip() or None,
    )
    return _project_dict(row, 0)


@router.get("/")
async def list_projects(
    mode: str = "chat",
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    if user is None:
        return {"projects": []}
    repo = ProjectRepo(db)
    rows = await repo.list(mode=mode, user_id=user.id)
    counts = await repo.count_sessions([r.id for r in rows])
    return {"projects": [_project_dict(r, counts.get(r.id, 0)) for r in rows]}


@router.get("/search")
async def search_projects(
    q: str = Query(..., min_length=1, description="Search query"),
    mode: str = "chat",
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    if user is None:
        return {"projects": []}
    repo = ProjectRepo(db)
    rows = await repo.search(query=q, mode=mode, user_id=user.id)
    counts = await repo.count_sessions([r.id for r in rows])
    return {"projects": [_project_dict(r, counts.get(r.id, 0)) for r in rows]}


@router.get("/{project_id}")
async def get_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    repo = ProjectRepo(db)
    row = await _owned_project(repo, project_id, user)
    counts = await repo.count_sessions([row.id])
    return _project_dict(row, counts.get(row.id, 0))


@router.patch("/{project_id}")
async def update_project(
    project_id: str,
    body: UpdateProjectRequest,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    repo = ProjectRepo(db)
    await _owned_project(repo, project_id, user)
    row = await repo.update(
        project_id,
        name=body.name,
        instructions=body.instructions,
        folders=[f.model_dump() for f in body.folders] if body.folders is not None else None,
    )
    counts = await repo.count_sessions([project_id])
    return _project_dict(row, counts.get(project_id, 0))


@router.delete("/{project_id}", status_code=204)
async def delete_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    repo = ProjectRepo(db)
    await _owned_project(repo, project_id, user)
    await repo.delete(project_id)


@router.get("/{project_id}/sessions")
async def list_project_sessions(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    repo = ProjectRepo(db)
    await _owned_project(repo, project_id, user)
    rows = await repo.list_sessions(project_id)
    return {"sessions": [_session_dict(r) for r in rows]}


# ── Project files (RAG, scoped by project_id) ────────────────────────────────


@router.post("/{project_id}/files")
async def upload_project_file(
    project_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    repo = ProjectRepo(db)
    await _owned_project(repo, project_id, user)

    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            415,
            f"Unsupported file type '{suffix}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    dest_dir = _project_dir(user.id, project_id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / (file.filename or "upload")
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    chunks = await ingest_pipeline.ingest(str(dest), user_id=user.id, project_id=project_id)
    await repo.touch(project_id)
    return {"filename": file.filename, "path": str(dest), "chunks_stored": chunks}


@router.get("/{project_id}/files")
async def list_project_files(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    repo = ProjectRepo(db)
    await _owned_project(repo, project_id, user)

    from db.vector.store import get_vector_store

    vs = await get_vector_store(IngestPipeline.COLLECTION_NAME)
    _ids, _docs, metas = await vs.list_all(limit=100_000)

    counts: dict[str, int] = {}
    for meta in metas:
        if meta.get("user_id") != user.id or meta.get("project_id") != project_id:
            continue
        src = meta.get("source", "")
        if src:
            counts[src] = counts.get(src, 0) + 1

    files = []
    for src, chunk_count in sorted(counts.items(), key=lambda kv: Path(kv[0]).name.lower()):
        files.append({"path": src, "name": Path(src).name, "chunks": chunk_count})
    return {"files": files}


@router.delete("/{project_id}/files")
async def delete_project_file(
    project_id: str,
    source: str = Query(..., description="Source path to remove"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    repo = ProjectRepo(db)
    await _owned_project(repo, project_id, user)

    # Only allow deleting files that live inside this project's upload dir.
    project_dir = _project_dir(user.id, project_id).resolve()
    try:
        Path(source).resolve().relative_to(project_dir)
    except ValueError as exc:
        raise HTTPException(403, "Access denied") from exc

    from db.vector.store import get_vector_store

    vs = await get_vector_store(IngestPipeline.COLLECTION_NAME)
    await vs.delete_by_source(source)

    p = Path(source)
    if p.exists():
        p.unlink()
    await repo.touch(project_id)
    return {"status": "ok", "deleted": source}
