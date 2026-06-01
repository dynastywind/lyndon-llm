"""
Cross-Session File Memory — a single Markdown file that accumulates the user's
factual profile and key facts across ALL sessions.

File path: {session_memory_dir}/cross_session_memory.md

Unlike per-session memory files (one per session), this file is shared across
sessions and is updated whenever the User Profile section of a session file
changes.  It is injected into every new message so the model always knows who
the user is regardless of which session is active.

File format
-----------
# Cross-Session Memory
Updated: {iso_timestamp}

## User Profile
- Age: ...
- Profession: ...
...

## Key Facts
- Persistent fact observed across sessions
...
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from pathlib import Path

from config.settings import settings

logger = logging.getLogger(__name__)

CROSS_SESSION_SUMMARISE_SYSTEM = """\
You are a personal memory assistant maintaining a persistent cross-session profile.
Given the existing cross-session memory (if any) and a new User Profile extracted \
from the latest session, produce an updated cross-session memory by:
1. Merging the User Profile: keep all confirmed facts; add newly discovered fields; \
update a field ONLY when the new value is a real, specific value that explicitly \
contradicts or refines the existing one. NEVER replace a confirmed specific value \
(e.g. "Male", "Engineer", "30") with a placeholder such as "Unknown", "None", \
"N/A", or an empty value — if the new session simply didn't mention a field, \
leave the existing value unchanged.
2. Updating Key Facts: accumulate important recurring facts, preferences, or \
behaviours observed across sessions. Remove facts only when directly contradicted \
by a specific new value.

Return ONLY the updated content formatted exactly as:

## User Profile
- Field: value
- Field: value
...

## Key Facts
- fact
- fact
...

No extra commentary, no markdown fences, no headings other than the two above.\
"""

_FILENAME = "cross_session_memory.md"


class CrossSessionFileMemory:
    """Read/write the single cross-session memory Markdown file."""

    def __init__(self) -> None:
        self._dir = Path(settings.session_memory_dir)
        self._path = self._dir / _FILENAME

    # ------------------------------------------------------------------ #
    #  Public API                                                          #
    # ------------------------------------------------------------------ #

    def load(self) -> str | None:
        """Return the file contents, or None if the file does not exist."""
        try:
            return self._path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return None
        except Exception:
            logger.exception("Failed to load cross-session memory file")
            return None

    def save(self, sections_content: str) -> None:
        """Write the cross-session memory file atomically."""
        self._dir.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_suffix(".tmp")

        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        full_content = (
            f"# Cross-Session Memory\n"
            f"Updated: {timestamp}\n\n"
            f"{sections_content.strip()}\n"
        )

        try:
            tmp.write_text(full_content, encoding="utf-8")
            os.replace(tmp, self._path)  # atomic on POSIX
        except Exception:
            logger.exception("Failed to save cross-session memory file")
            try:
                tmp.unlink(missing_ok=True)
            except Exception:
                pass

    async def update(
        self,
        new_user_profile_section: str,
        llm_complete_fn,  # async (messages: list[LLMMessage]) -> str
    ) -> str:
        """
        Merge the updated User Profile from a session file into the
        cross-session memory file.

        `new_user_profile_section` should be the raw '## User Profile' block
        extracted from the triggering session's memory file.
        """
        from core.llm.gateway import LLMMessage

        existing = self.load() or "None"
        user_message = (
            f"Existing cross-session memory:\n{existing}\n\n"
            f"Updated User Profile from latest session:\n{new_user_profile_section}"
        )

        try:
            raw = await llm_complete_fn(
                messages=[
                    LLMMessage("system", CROSS_SESSION_SUMMARISE_SYSTEM),
                    LLMMessage("user", user_message),
                ]
            )
            # llm_gateway.complete returns (text, usage) — unwrap if needed
            result = raw[0] if isinstance(raw, tuple) else raw
        except Exception:
            logger.exception(
                "LLM call failed while updating cross-session memory — skipping"
            )
            return existing

        self.save(result)
        return result
