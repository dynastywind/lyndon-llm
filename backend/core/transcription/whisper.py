"""
Local speech-to-text using faster-whisper.

The model is loaded lazily (and downloaded on first ever use) so it never adds
to server start-up time. Transcription itself is CPU-bound and blocking, so it
runs in a worker thread to avoid stalling the event loop.
"""

from __future__ import annotations

import asyncio
import io
import logging
from typing import TYPE_CHECKING

from config.settings import settings

if TYPE_CHECKING:
    from faster_whisper import WhisperModel

logger = logging.getLogger(__name__)


class Transcriber:
    """Lazily-loaded faster-whisper singleton."""

    def __init__(self) -> None:
        self._model: WhisperModel | None = None

    def _get_model(self) -> WhisperModel:
        if self._model is None:
            from faster_whisper import WhisperModel

            logger.info(
                "Loading Whisper model %r (device=%s, compute=%s)…",
                settings.whisper_model,
                settings.whisper_device,
                settings.whisper_compute_type,
            )
            self._model = WhisperModel(
                settings.whisper_model,
                device=settings.whisper_device,
                compute_type=settings.whisper_compute_type,
            )
        return self._model

    async def transcribe(self, audio: bytes, language: str | None = None) -> str:
        """Transcribe raw audio bytes (any container PyAV can decode) to text."""

        def _run() -> str:
            segments, _info = self._get_model().transcribe(
                io.BytesIO(audio),
                language=language,
                vad_filter=True,
            )
            return " ".join(segment.text.strip() for segment in segments).strip()

        return await asyncio.to_thread(_run)


transcriber = Transcriber()
