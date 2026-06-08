from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.auth_deps import get_current_user
from api.deps import get_session
from code.editor import CodeEditor
from code.repo import RepoManager, clone_repo
from code.reviewer import CodeReviewer
from code.test_runner import TestRunner
from config.settings import settings
from core.security.crypto import memory_cipher
from core.session.manager import Session
from core.tools.working_dir import is_directory_empty
from db.models.user import User

router = APIRouter()


class EditRequest(BaseModel):
    repo_path: str | None = None
    file_path: str
    instruction: str
    context_files: list[str] = []


class CommitRequest(BaseModel):
    repo_path: str | None = None
    files: list[str]
    message: str


class ReviewRequest(BaseModel):
    diff: str
    context: str = ""


class TestRequest(BaseModel):
    repo_path: str | None = None
    test_path: str | None = None


class CloneRequest(BaseModel):
    clone_url: str  # e.g. https://github.com/owner/repo.git
    target_dir: str  # must be an existing, empty directory


@router.post("/edit")
async def edit_file(body: EditRequest, session: Session = Depends(get_session)):
    repo = RepoManager(body.repo_path or settings.code_default_repo_path)
    editor = CodeEditor(repo)
    diff = await editor.edit_file(body.file_path, body.instruction, body.context_files)
    return {"file_path": diff.file_path, "diff": diff.diff_text, "is_new": diff.is_new}


@router.post("/commit")
async def commit(body: CommitRequest, session: Session = Depends(get_session)):
    repo = RepoManager(body.repo_path or settings.code_default_repo_path)
    repo.stage(body.files)
    sha = repo.commit(body.message)
    return {"sha": sha, "message": body.message}


@router.post("/review")
async def review_diff(body: ReviewRequest, session: Session = Depends(get_session)):
    reviewer = CodeReviewer()
    result = await reviewer.review(body.diff, body.context)
    return {
        "summary": result.summary,
        "approved": result.approved,
        "comments": [c.__dict__ for c in result.comments],
    }


@router.post("/test")
async def run_tests(body: TestRequest, session: Session = Depends(get_session)):
    runner = TestRunner(body.repo_path or settings.code_default_repo_path)
    result = await runner.run(body.test_path)
    return {
        "success": result.success,
        "passed": result.passed,
        "failed": result.failed,
        "errors": result.errors,
        "failures": result.failures,
        "output": result.output,
    }


@router.post("/clone")
async def clone(body: CloneRequest, user: User = Depends(get_current_user)):
    """Clone a GitHub repo into a selected directory (which must exist and be empty)."""
    target = Path(body.target_dir).expanduser()
    if not target.is_dir():
        raise HTTPException(status_code=400, detail="Selected directory does not exist.")
    if not is_directory_empty(str(target)):
        raise HTTPException(
            status_code=409,
            detail="Directory is not empty. Choose an empty directory.",
        )
    token = (
        memory_cipher.decrypt(user.github_token, scope_id=user.id) if user.github_token else None
    )
    try:
        branch = await clone_repo(body.clone_url, str(target.resolve()), token)
    except Exception as exc:  # noqa: BLE001 — surface git/clone failures to the client
        raise HTTPException(status_code=502, detail=f"Clone failed: {exc}") from exc
    return {"path": str(target.resolve()), "branch": branch}


@router.get("/status")
async def repo_status(repo_path: str | None = None, session: Session = Depends(get_session)):
    path = repo_path or settings.code_default_repo_path
    try:
        repo = RepoManager(str(Path(path).expanduser()))
        return {
            "is_repo": True,
            "branch": repo.current_branch(),
            "status": repo.status(),
            "log": repo.log(5),
        }
    except Exception:  # noqa: BLE001 — not a git repo / missing path → report cleanly
        return {"is_repo": False}
