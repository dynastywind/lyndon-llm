"""
Memory Manager — unified interface over short-term and long-term memory.
Every Chat engine interaction goes through this class.
"""

from __future__ import annotations

import logging
import re
import uuid

from chat.memory.cross_session_file import CrossSessionFileMemory
from chat.memory.long_term import LongTermMemory
from chat.memory.session_file import SessionFileMemory
from chat.memory.short_term import ShortTermMemory
from chat.memory.types import Memory, MemoryType
from config.settings import settings
from core.llm.gateway import LLMMessage, llm_gateway

logger = logging.getLogger(__name__)


_EMPTY_VALUES = re.compile(r"^\s*(unknown|none|n/a|–|-|)\s*$", re.IGNORECASE)


def _extract_section(content: str, heading: str) -> str:
    """Return the named '## <heading>' block from a memory file, or '' if absent."""
    pattern = rf"(## {re.escape(heading)}\n.*?)(?=\n## |\Z)"
    match = re.search(pattern, content, re.DOTALL)
    return match.group(1).strip() if match else ""


def _extract_user_profile(content: str) -> str:
    """Return the '## User Profile' block from a memory file, or '' if absent."""
    return _extract_section(content, "User Profile")


def _parse_profile_items(profile_block: str) -> dict[str, str]:
    """Parse '- Key: Value' lines from a User Profile block into an ordered dict."""
    items: dict[str, str] = {}
    for line in profile_block.splitlines():
        line = line.strip().lstrip("- ")
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        key = key.strip()
        value = value.strip()
        if key:
            items[key] = value
    return items


def _merge_user_profiles(base_profile: str, override_profile: str) -> str:
    """Merge two '## User Profile' blocks, with *override* winning for the same key.

    - Keys present only in *base* are kept as-is.
    - Keys present only in *override* are added (unless the value is a placeholder).
    - Keys present in both: override's value is used ONLY when it is a real,
      non-placeholder value; otherwise the base value is preserved.

    Returns a formatted '## User Profile' block (or '' when both inputs are empty).
    """
    base_items = _parse_profile_items(base_profile)
    override_items = _parse_profile_items(override_profile)

    merged = dict(base_items)  # start from base
    for key, value in override_items.items():
        if _EMPTY_VALUES.match(value):
            # placeholder in override — keep existing base value if any
            continue
        merged[key] = value  # real value: update or add

    if not merged:
        return ""
    lines = "\n".join(f"- {k}: {v}" for k, v in merged.items())
    return f"## User Profile\n{lines}"


# Keys that carry no substantive personal information — a session that only
# knows the user's name hasn't actually learned anything new.
_TRIVIAL_KEYS = re.compile(r"^\s*(name|first.?name|last.?name)\s*$", re.IGNORECASE)


def _has_meaningful_profile(profile: str) -> bool:
    """Return True only when the profile contains at least one substantive,
    non-trivial, non-placeholder value.

    Prevents sessions that never discussed personal info (and whose profile
    is filled with blank/Unknown values or only a bare name) from triggering a
    cross-session update that would overwrite previously confirmed facts.
    """
    for line in profile.splitlines():
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        key = key.strip().lstrip("- ")
        value = value.strip()
        if _TRIVIAL_KEYS.match(key):
            continue  # name alone is not substantive
        if not _EMPTY_VALUES.match(value):
            return True
    return False

SUMMARISE_SYSTEM = (
    "You are a concise summariser. Given a conversation excerpt, produce a "
    "2-4 sentence summary that captures the key facts, decisions, and outcomes. "
    "Write in third-person (e.g. 'The user asked about...'). Be factual."
)


class MemoryManager:
    def __init__(self, session_id: str, user_id: str | None = None) -> None:
        self.session_id = session_id
        self.user_id = user_id
        self.short_term = ShortTermMemory(session_id)
        self.long_term = LongTermMemory()
        self.session_file = SessionFileMemory()
        self.cross_session_file = CrossSessionFileMemory(user_id)

    # ------------------------------------------------------------------ #
    #  Session start — inject relevant memories into system prompt         #
    # ------------------------------------------------------------------ #

    async def build_system_prompt(self, base_prompt: str, user_message: str) -> str:
        """
        Retrieve relevant long-term memories and session file memory, then
        prepend them to the system prompt so the LLM has full context.

        Injection strategy
        ------------------
        The cross-session file and the per-session file both contain a
        '## User Profile' section.  Injecting both separately would give the
        model two User Profile blocks with potentially conflicting values.
        Instead we merge them into a SINGLE unified profile (session values
        override cross-session values for the same key, because they are more
        recent), and emit it once.  The per-session Conversation Summary and
        the cross-session Key Facts are kept as separate supporting sections.

        Final prompt structure:
          <base_prompt>

          ## About the User          ← single merged profile
          ...

          ## Key Facts               ← from cross-session file (if any)
          ...

          ## This Session's Summary  ← conversation summary from session file
          ...

          ## Relevant memories from past sessions  ← Chroma (if any)
          ...
        """
        enriched = base_prompt

        # Load both memory sources (neither may exist yet).
        cross_sections = self.cross_session_file.load_sections() or ""
        session_content = self.session_file.load(self.session_id) or ""

        # --- 1. Single merged User Profile (session values override cross-session) -
        # Both files contain a ## User Profile section.  We merge them in Python
        # so the model sees exactly ONE authoritative profile, never two.
        cross_profile = _extract_user_profile(cross_sections)
        session_profile = _extract_user_profile(session_content)
        merged_profile = _merge_user_profiles(cross_profile, session_profile)
        if merged_profile:
            # Strip the "## User Profile" heading line; the outer heading acts as label.
            profile_body = merged_profile.split("\n", 1)[1] if "\n" in merged_profile else ""
            enriched = f"{enriched}\n\n## User Profile\n{profile_body}"

        # --- 2. Key Facts from cross-session file (accumulates across sessions) -
        key_facts = _extract_section(cross_sections, "Key Facts")
        if key_facts:
            enriched = f"{enriched}\n\n{key_facts}"

        # --- 3. Conversation summary from this session's file ------------------
        conv_summary = _extract_section(session_content, "Conversation Summary")
        if conv_summary:
            # Strip inner heading; re-label so it's distinct from the profile block.
            summary_body = conv_summary.split("\n", 1)[1] if "\n" in conv_summary else ""
            enriched = f"{enriched}\n\n## This Session's Summary\n{summary_body}"

        # --- 4. Relevant long-term memories from Chroma -----------------------
        # Always scope the query. Logged-in users filter by user_id (proven to
        # isolate cross-user). Anonymous users (no user_id) fall back to their
        # own session so they can never pull the global cross-user pool.
        memories = await self.long_term.retrieve(
            query=user_message,
            top_k=settings.long_term_top_k,
            user_id=self.user_id,
            session_id=None if self.user_id else self.session_id,
        )
        if memories:
            mem_block = "\n".join(
                f"- [{m.memory_type.value}] {m.content}" for m in memories
            )
            enriched = f"{enriched}\n\n## Relevant memories from past sessions\n{mem_block}"

        self.short_term.set_system_prompt(enriched)
        return enriched

    # ------------------------------------------------------------------ #
    #  Turn management                                                     #
    # ------------------------------------------------------------------ #

    def add_user_turn(self, content: str) -> None:
        self.short_term.add("user", content)

    def add_assistant_turn(self, content: str) -> None:
        self.short_term.add("assistant", content)

    def add_tool_turn(self, tool_name: str, content: str) -> None:
        self.short_term.add("tool", content, tool_name=tool_name)

    def get_messages(self) -> list[dict]:
        return self.short_term.get_messages()

    # ------------------------------------------------------------------ #
    #  Compression & persistence                                           #
    # ------------------------------------------------------------------ #

    async def maybe_compress(self) -> None:
        """Auto-compress short-term memory if near the token limit."""
        if not self.short_term.needs_compression():
            return

        async def _summarise(turns):
            text = "\n".join(f"{t.role}: {t.content}" for t in turns)
            result = await llm_gateway.complete(
                messages=[
                    LLMMessage("system", SUMMARISE_SYSTEM),
                    LLMMessage("user", text),
                ]
            )
            return result[0] if isinstance(result, tuple) else result

        summary = await self.short_term.compress(_summarise)
        if summary:
            await self.long_term.store(
                Memory(
                    session_id=self.session_id,
                    memory_type=MemoryType.EPISODIC,
                    content=summary,
                    importance=0.6,
                ),
                user_id=self.user_id,
            )

    async def update_session_file(self, turns) -> None:
        """Update the session memory file and sync the result to Chroma.

        Also triggers a cross-session memory update when the User Profile
        section changes — ensuring factual personal info is propagated to
        the persistent cross-session file.

        Uses a deterministic UUID derived from the session_id so that every
        Chroma upsert overwrites the same document (no duplicates).
        """
        if not turns:
            return

        # Capture the User Profile before the update so we can detect changes.
        old_content = self.session_file.load(self.session_id) or ""
        old_profile = _extract_user_profile(old_content)

        content = await self.session_file.update(
            self.session_id,
            turns,
            llm_gateway.complete,
        )
        if not content:
            return

        # Sync updated session summary to Chroma (best-effort — never blocks
        # the cross-session update below even if Chroma is unavailable).
        try:
            stable_id = str(
                uuid.uuid5(uuid.NAMESPACE_DNS, f"session-summary:{self.session_id}")
            )
            await self.long_term.store(
                Memory(
                    id=stable_id,
                    session_id=self.session_id,
                    memory_type=MemoryType.EPISODIC,
                    content=content,
                    importance=0.8,
                ),
                user_id=self.user_id,
            )
        except Exception:
            logger.warning(
                "Chroma store failed for session %s — cross-session update will still run",
                self.session_id,
                exc_info=True,
            )

        # Read back what was actually saved so both profile comparisons use the
        # same source (the full file with header), avoiding inconsistencies if
        # the LLM omits the '## User Profile' heading in its raw output.
        saved_content = self.session_file.load(self.session_id) or content
        new_profile = _extract_user_profile(saved_content)
        # Only propagate to cross-session memory when this session actually
        # learned something substantive about the user.
        if new_profile and new_profile != old_profile and _has_meaningful_profile(new_profile):
            await self._update_cross_session(new_profile)

    async def _update_cross_session(self, new_session_profile: str) -> None:
        """Merge the session's User Profile into the cross-session file.

        Profile fields are merged in Python code (reliable, no LLM hallucination
        risk).  Key Facts are updated via a focused LLM call so noteworthy
        observations can be accumulated in natural language.
        """
        # Anonymous sessions have no persistent cross-session profile — skip
        # (also avoids a pointless LLM Key-Facts call).
        if not self.cross_session_file.enabled:
            return

        existing_sections = self.cross_session_file.load_sections() or ""
        existing_profile = _extract_user_profile(existing_sections)
        existing_key_facts = _extract_section(existing_sections, "Key Facts")

        # --- 1. Code-based profile merge (session overrides cross-session) ------
        merged_profile = _merge_user_profiles(existing_profile, new_session_profile)
        if not merged_profile:
            return  # nothing to write

        # --- 2. LLM updates Key Facts only (accumulate noteworthy facts) --------
        KEY_FACTS_SYSTEM = (
            "You are a personal memory assistant. "
            "Given existing Key Facts and a User Profile from a new session, "
            "return an updated '## Key Facts' section that accumulates important, "
            "non-redundant facts or behaviours observed about the user. "
            "Keep existing facts unless directly contradicted. "
            "Do NOT include profile field values already captured in User Profile. "
            "Return ONLY the section, formatted as:\n\n"
            "## Key Facts\n- fact\n- fact\n...\n\n"
            "No commentary, no other headings."
        )
        user_msg = (
            f"Existing Key Facts:\n{existing_key_facts or 'None'}\n\n"
            f"User Profile from latest session:\n{new_session_profile}"
        )
        try:
            raw = await llm_gateway.complete(
                messages=[
                    LLMMessage("system", KEY_FACTS_SYSTEM),
                    LLMMessage("user", user_msg),
                ]
            )
            key_facts_result = raw[0] if isinstance(raw, tuple) else raw
        except Exception:
            logger.warning(
                "LLM call for Key Facts failed — keeping existing Key Facts",
                exc_info=True,
            )
            key_facts_result = existing_key_facts

        sections = merged_profile
        if key_facts_result and key_facts_result.strip():
            sections = f"{sections}\n\n{key_facts_result.strip()}"

        self.cross_session_file.save(sections)
        logger.debug("Cross-session memory updated (code-merged profile + LLM key facts)")

    async def store_memory(
        self,
        content: str,
        memory_type: MemoryType = MemoryType.SEMANTIC,
        importance: float = 0.5,
    ) -> None:
        """Explicitly store a fact or outcome to long-term memory."""
        await self.long_term.store(
            Memory(
                session_id=self.session_id,
                memory_type=memory_type,
                content=content,
                importance=importance,
            ),
            user_id=self.user_id,
        )

    async def retrieve_memories(self, query: str) -> list[Memory]:
        return await self.long_term.retrieve(query, user_id=self.user_id)

    async def end_session(self) -> None:
        """Called when a session closes — summarise and persist the whole conversation."""
        turns = self.short_term.last_n(50)
        if not turns:
            return

        text = "\n".join(f"{t.role}: {t.content}" for t in turns)
        raw = await llm_gateway.complete(
            messages=[
                LLMMessage("system", SUMMARISE_SYSTEM),
                LLMMessage("user", f"Summarise this session:\n{text}"),
            ]
        )
        summary = raw[0] if isinstance(raw, tuple) else raw
        await self.long_term.store(
            Memory(
                session_id=self.session_id,
                memory_type=MemoryType.EPISODIC,
                content=summary,
                importance=0.7,
            ),
            user_id=self.user_id,
        )
