"""
Memory Manager — unified interface over short-term and long-term memory.
Every Chat engine interaction goes through this class.
"""

from __future__ import annotations

import re
import uuid

from chat.memory.cross_session_file import CrossSessionFileMemory
from chat.memory.long_term import LongTermMemory
from chat.memory.session_file import SessionFileMemory
from chat.memory.short_term import ShortTermMemory
from chat.memory.types import Memory, MemoryType
from config.settings import settings
from core.llm.gateway import LLMMessage, llm_gateway


def _extract_user_profile(content: str) -> str:
    """Return the '## User Profile' block from a memory file, or '' if absent."""
    match = re.search(r"(## User Profile\n.*?)(?=\n## |\Z)", content, re.DOTALL)
    return match.group(1).strip() if match else ""

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
        self.cross_session_file = CrossSessionFileMemory()

    # ------------------------------------------------------------------ #
    #  Session start — inject relevant memories into system prompt         #
    # ------------------------------------------------------------------ #

    async def build_system_prompt(self, base_prompt: str, user_message: str) -> str:
        """
        Retrieve relevant long-term memories and session file memory, then
        prepend them to the system prompt so the LLM has full context.

        Injection order (after base prompt):
          1. This session's file memory (conversation summary + user profile)
          2. Cross-session long-term memories from vector store
        """
        enriched = base_prompt

        # 1. Inject cross-session memory (persistent user profile + key facts)
        cross_memory = self.cross_session_file.load()
        if cross_memory:
            enriched = f"{enriched}\n\n## Cross-Session Memory\n{cross_memory}"

        # 2. Inject per-session file memory (conversation summary + user profile)
        session_memory = self.session_file.load(self.session_id)
        if session_memory:
            enriched = f"{enriched}\n\n## This Session's Memory\n{session_memory}"

        # 3. Inject relevant cross-session long-term memories
        memories = await self.long_term.retrieve(
            query=user_message,
            top_k=settings.long_term_top_k,
            user_id=self.user_id,
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
            return await llm_gateway.complete(
                messages=[
                    LLMMessage("system", SUMMARISE_SYSTEM),
                    LLMMessage("user", text),
                ]
            )

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

        # Sync updated session summary to Chroma.
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

        # If the User Profile changed, update the cross-session memory file.
        new_profile = _extract_user_profile(content)
        if new_profile and new_profile != old_profile:
            await self.cross_session_file.update(new_profile, llm_gateway.complete)

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
        summary = await llm_gateway.complete(
            messages=[
                LLMMessage("system", SUMMARISE_SYSTEM),
                LLMMessage("user", f"Summarise this session:\n{text}"),
            ]
        )
        await self.long_term.store(
            Memory(
                session_id=self.session_id,
                memory_type=MemoryType.EPISODIC,
                content=summary,
                importance=0.7,
            ),
            user_id=self.user_id,
        )
