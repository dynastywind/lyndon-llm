"""
Session File Memory — per-session persistent memory stored as Markdown files.

Each session gets a single file at:
    {session_memory_dir}/{session_id}.md

The file contains two sections updated by an LLM after every assistant turn:
  1. Conversation Summary  — rolling 3-6 sentence summary of what was discussed
  2. User Profile          — personal details extracted from the conversation

The file is injected into the system prompt when the session resumes so the
model has full context even after a server restart.
"""

from __future__ import annotations

import contextlib
from datetime import UTC, datetime
import logging
import os
from pathlib import Path

from config.settings import settings
from core.security.crypto import memory_cipher

logger = logging.getLogger(__name__)

SUMMARISE_SYSTEM = """\
You are a personal memory assistant. Given an existing memory file (if any) and \
new conversation turns, update the memory file by:
1. Updating "Conversation Summary" to reflect what was discussed \
(3-6 sentences, third-person, e.g. "The user asked about...").
2. Updating "User Profile" with any personal information extracted from the \
conversation (age, gender, height, weight, preferences, hobbies, profession, \
education, work experience, family members, interests, relationship status, \
location, languages, etc.). Add new fields as discovered; update existing \
fields if new information supersedes old. Omit fields with no data.

Return ONLY the updated content for both sections, formatted exactly as:

## Conversation Summary
<summary here>

## User Profile
- Field: value
- Field: value
...

No extra commentary, no markdown fences, no headings other than the two above.\
"""


class SessionFileMemory:
    """Read/write per-session memory Markdown files."""

    def __init__(self) -> None:
        self._dir = Path(settings.session_memory_dir)

    def _path(self, session_id: str) -> Path:
        return self._dir / f"{session_id}.md"

    # ------------------------------------------------------------------ #
    #  Public API                                                          #
    # ------------------------------------------------------------------ #

    def load(self, session_id: str) -> str | None:
        """Return the decrypted file contents, or None if the file is missing."""
        path = self._path(session_id)
        try:
            raw = path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return None
        except Exception:
            logger.exception("Failed to load session memory file for %s", session_id)
            return None
        return memory_cipher.decrypt(raw, session_id)

    def save(self, session_id: str, sections_content: str) -> None:
        """
        Write the memory file atomically.

        `sections_content` should be the two-section block returned by the LLM
        (starting with "## Conversation Summary").  A header line with the
        session ID and a timestamp is prepended automatically.
        """
        self._dir.mkdir(parents=True, exist_ok=True)
        path = self._path(session_id)
        tmp = path.with_suffix(".tmp")

        timestamp = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        full_content = (
            f"# Session Memory: {session_id}\n"
            f"Updated: {timestamp}\n\n"
            f"{sections_content.strip()}\n"
        )
        # Encrypt the whole file at rest (scope = session_id).
        payload = memory_cipher.encrypt(full_content, session_id)

        try:
            tmp.write_text(payload, encoding="utf-8")
            os.replace(tmp, path)  # atomic on POSIX
        except Exception:
            logger.exception("Failed to save session memory file for %s", session_id)
            with contextlib.suppress(Exception):
                tmp.unlink(missing_ok=True)

    async def update(
        self,
        session_id: str,
        new_turns: list,  # list[ConversationTurn]
        llm_complete_fn,  # async (messages: list[LLMMessage]) -> str
    ) -> str:
        """
        Ask the LLM to produce an updated memory file for the session.

        Combines the existing file content (if any) with the new turns and
        calls `llm_complete_fn` with the summarisation prompt.  Saves the
        result and returns the new sections content.
        """
        from core.llm.gateway import LLMMessage

        existing = self.load(session_id) or "None"
        turns_text = "\n".join(
            f"{t.role}: {t.content}" for t in new_turns
        )

        user_message = (
            f"Existing memory file:\n{existing}\n\n"
            f"New conversation turns:\n{turns_text}"
        )

        try:
            raw = await llm_complete_fn(
                messages=[
                    LLMMessage("system", SUMMARISE_SYSTEM),
                    LLMMessage("user", user_message),
                ]
            )
            # llm_gateway.complete returns (text, usage) — unwrap if needed
            result = raw[0] if isinstance(raw, tuple) else raw
        except Exception:
            logger.exception(
                "LLM summarisation failed for session %s — skipping file update",
                session_id,
            )
            return existing

        self.save(session_id, result)
        return result
