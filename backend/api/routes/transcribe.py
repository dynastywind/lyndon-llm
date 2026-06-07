"""
Speech-to-text endpoint — accepts a recorded audio clip and returns the
transcribed text (local Whisper via faster-whisper).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from api.auth_deps import get_optional_user
from config.settings import settings
from core.transcription.whisper import transcriber
from db.models.user import User

router = APIRouter()

# Hard cap on uploaded audio size (matches a few minutes of webm/opus).
MAX_AUDIO_BYTES = 25 * 1024 * 1024


@router.post("/")
async def transcribe(
    file: UploadFile = File(...),
    language: str | None = Form(None),
    user: User | None = Depends(get_optional_user),
) -> dict[str, str]:
    """Transcribe an uploaded audio clip to text."""
    if not settings.transcription_enabled:
        raise HTTPException(status_code=503, detail="Transcription is disabled")

    audio = await file.read()
    if not audio:
        raise HTTPException(status_code=400, detail="Empty audio upload")
    if len(audio) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio too large")

    text = await transcriber.transcribe(audio, language=language or None)
    return {"text": text}
