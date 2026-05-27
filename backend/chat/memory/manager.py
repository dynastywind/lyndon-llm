"""
Memory Manager — unified interface over short-term and long-term memory.
Every Chat engine interaction goes through this class.
"""
from __future__ import annotations

from chat.memory.long_term import LongTermMemory
from chat.memory.short_term import ShortTermMemory
from chat.memory.types import Memory, MemoryType
from config.settings import settings
from core.llm.gateway import llm_gateway, LLMMessage


SUMMARISE_SYSTEM = (
    "You are a concise summariser. Given a conversation excerpt, produce a "
    "2-4 sentence summary that captures the key facts, decisions, and outcomes. "
    "Write in third-person (e.g. 'The user asked about...'). Be factual."
)


class MemoryManager:
    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        self.short_term = ShortTermMemory(session_id)
        self.long_term = LongTermMemory()

    # ------------------------------------------------------------------ #
    #  Session start — inject relevant memories into system prompt         #
    # ------------------------------------------------------------------ #

    async def build_system_prompt(self, base_prompt: str, user_message: str) -> str:
        """
        Retrieve relevant long-term memories and prepend them to the
        system prompt so the LLM has cross-session context.
        """
        memories = await self.long_term.retrieve(
            query=user_message,
            top_k=settings.long_term_top_k,
        )
        if not memories:
            return base_prompt

        mem_block = "\n".join(f"- [{m.memory_type.value}] {m.content}" for m in memories)
        enriched = (
            f"{base_prompt}\n\n"
            f"## Relevant memories from past sessions\n{mem_block}"
        )
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
            await self.long_term.store(Memory(
                session_id=self.session_id,
                memory_type=MemoryType.EPISODIC,
                content=summary,
                importance=0.6,
            ))

    async def store_memory(
        self,
        content: str,
        memory_type: MemoryType = MemoryType.SEMANTIC,
        importance: float = 0.5,
    ) -> None:
        """Explicitly store a fact or outcome to long-term memory."""
        await self.long_term.store(Memory(
            session_id=self.session_id,
            memory_type=memory_type,
            content=content,
            importance=importance,
        ))

    async def retrieve_memories(self, query: str) -> list[Memory]:
        return await self.long_term.retrieve(query)

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
        await self.long_term.store(Memory(
            session_id=self.session_id,
            memory_type=MemoryType.EPISODIC,
            content=summary,
            importance=0.7,
        ))
