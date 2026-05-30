from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from sandbox.runner import run_code, available_languages
from config.settings import settings

router = APIRouter()


class RunRequest(BaseModel):
    language: str
    code: str
    timeout: int = Field(default=10, ge=1, le=60)


@router.post("/run")
async def sandbox_run(body: RunRequest):
    """Execute *code* in the requested language inside the sandbox."""
    timeout = min(body.timeout, settings.sandbox_timeout)
    result = await run_code(body.language, body.code, timeout)
    return result


@router.get("/languages")
async def sandbox_languages():
    """Return the list of supported languages and their availability."""
    return {"languages": available_languages()}
