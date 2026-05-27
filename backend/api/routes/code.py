from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from api.deps import get_session
from code.editor import CodeEditor
from code.repo import RepoManager
from code.reviewer import CodeReviewer
from code.test_runner import TestRunner
from config.settings import settings
from core.session.manager import Session

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


@router.get("/status")
async def repo_status(repo_path: str | None = None, session: Session = Depends(get_session)):
    repo = RepoManager(repo_path or settings.code_default_repo_path)
    return {
        "branch": repo.current_branch(),
        "status": repo.status(),
        "log": repo.log(5),
    }
