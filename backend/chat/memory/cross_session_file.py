"""
Cross-Session File Memory — a per-user Markdown file that accumulates one user's
factual profile and key facts across ALL of that user's sessions.

File path: {session_memory_dir}/cross_session_{user_id}.md

The file is keyed by user_id so each user's profile is isolated — a single
shared file would leak one user's profile into every other user's prompt.
It spans that user's sessions (updated whenever the User Profile section of a
session file changes) and is injected into every new message so the model
always knows who the user is regardless of which session is active.

For anonymous requests (user_id=None) the store is disabled: loads return None
and writes are no-ops, so anonymous sessions neither read nor accumulate any
cross-session profile.

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

import contextlib
from datetime import UTC, datetime
import logging
import os
from pathlib import Path
import re

from config.settings import settings
from core.security.crypto import memory_cipher

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

# Per-user filename. The cross-session profile is private to one user, so the
# file MUST be keyed by user_id — a single shared file would leak one user's
# profile into every other user's prompt.
def _filename_for(user_id: str) -> str:
    return f"cross_session_{user_id}.md"


# Matches the first ## section heading (User Profile or Key Facts) and everything after
_SECTIONS_RE = re.compile(r"(## (?:User Profile|Key Facts).+)", re.DOTALL)


def _sections_only(content: str) -> str:
    """Strip the '# Cross-Session Memory / Updated:' file header.

    Returns only the '## User Profile' … '## Key Facts' sections so the LLM
    never sees (or echoes back) the header, preventing header accumulation.
    """
    m = _SECTIONS_RE.search(content)
    return m.group(1).strip() if m else content.strip()


class CrossSessionFileMemory:
    """Read/write the per-user cross-session memory Markdown file.

    The file is keyed by ``user_id`` so each user's persistent profile is
    isolated. When ``user_id`` is None (anonymous / not logged in) the store is
    *disabled*: loads return None and writes are no-ops, so anonymous sessions
    neither read nor accumulate any cross-session profile.
    """

    def __init__(self, user_id: str | None = None) -> None:
        self._dir = Path(settings.session_memory_dir)
        self._user_id = user_id
        self.enabled = user_id is not None
        self._path = self._dir / _filename_for(user_id) if self.enabled else None

    # ------------------------------------------------------------------ #
    #  Public API                                                          #
    # ------------------------------------------------------------------ #

    def load(self) -> str | None:
        """Return the decrypted file contents, or None if missing/disabled."""
        if not self.enabled:
            return None
        try:
            raw = self._path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return None
        except Exception:
            logger.exception("Failed to load cross-session memory file")
            return None
        return memory_cipher.decrypt(raw, self._user_id)

    def load_sections(self) -> str | None:
        """Return only the '## User Profile' / '## Key Facts' sections (no header).

        Use this for injection into the system prompt and for passing to the
        LLM — it prevents the file header from being echoed back and
        accumulating on every update.
        """
        raw = self.load()
        if raw is None:
            return None
        sections = _sections_only(raw)
        return sections or None

    def save(self, sections_content: str) -> None:
        """Write the cross-session memory file atomically (no-op when disabled)."""
        if not self.enabled:
            return
        self._dir.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_suffix(".tmp")

        timestamp = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        full_content = (
            f"# Cross-Session Memory\n"
            f"Updated: {timestamp}\n\n"
            f"{sections_content.strip()}\n"
        )
        # Encrypt the whole file at rest (scope = user_id). Decryption happens
        # transparently in load() for the local model.
        payload = memory_cipher.encrypt(full_content, self._user_id)

        try:
            tmp.write_text(payload, encoding="utf-8")
            os.replace(tmp, self._path)  # atomic on POSIX
        except Exception:
            logger.exception("Failed to save cross-session memory file")
            with contextlib.suppress(Exception):
                tmp.unlink(missing_ok=True)

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
        if not self.enabled:
            return ""

        from core.llm.gateway import LLMMessage

        # Use load_sections() so the file header is never fed back to the LLM,
        # preventing the header from being echoed into the output and saved.
        existing = self.load_sections() or "None"
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
