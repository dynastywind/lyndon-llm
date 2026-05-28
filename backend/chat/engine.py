"""
Chat Engine — conversation loop for Chat mode.

RAG strategy: retrieve-first.
Before every LLM call, retrieve relevant chunks from the knowledge base
and inject them as context. This works reliably with any local model
without requiring function-calling support.
"""
from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import TYPE_CHECKING

from chat.memory.manager import MemoryManager
from chat.rag.retriever import HybridRetriever, RetrievedChunk
from core.events.bus import event_bus, Events
from core.llm.gateway import llm_gateway, LLMMessage
from core.session.manager import Session

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

BASE_SYSTEM_PROMPT = """\
You are a helpful, knowledgeable personal assistant.
When context is provided below, use it to answer the question accurately.
Always cite sources by mentioning the file or URL the information came from.
If the context does not contain relevant information, say so and answer from your general knowledge.
Be concise and direct. Ask clarifying questions when needed.
"""

# Maximum characters of retrieved context to inject into the prompt
MAX_CONTEXT_CHARS = 6000


def _format_context(chunks: list[RetrievedChunk]) -> str:
    """Format retrieved chunks into a context block for the system prompt."""
    if not chunks:
        return ""
    parts = []
    for i, chunk in enumerate(chunks, 1):
        parts.append(
            f"[{i}] Source: {chunk.source}\n{chunk.content}"
        )
    return "## Retrieved context\n\n" + "\n\n---\n\n".join(parts)


class ChatEngine:
    def __init__(self, session: Session, db: "AsyncSession | None" = None) -> None:
        self.session = session
        self.memory = MemoryManager(session.session_id)
        self._retriever = HybridRetriever()
        self._db = db

    async def stream_response(
        self,
        user_message: str,
    ) -> AsyncGenerator[str, None]:
        """
        Main chat turn:
          1. Retrieve relevant RAG chunks
          2. Enrich system prompt (long-term memories + RAG context)
          3. Add user turn to short-term memory
          4. Compress short-term memory if near the token limit
          5. Stream LLM response
          6. Store assistant turn
        """
        await event_bus.emit(Events.CHAT_MESSAGE_RECEIVED, {
            "session_id": self.session.session_id,
            "message": user_message,
        })

        # Persist user message to DB (if a DB session was injected)
        if self._db:
            from db.repos.chat import ChatRepo
            _repo = ChatRepo(self._db)
            await _repo.ensure_session(self.session.session_id, "chat")
            await _repo.add_message(self.session.session_id, "user", user_message)

        # 1. Retrieve RAG context
        rag_chunks = await self._retrieve(user_message)
        context_block = _format_context(rag_chunks)

        # 2. Build system prompt (base + long-term memories + RAG context)
        system_prompt = BASE_SYSTEM_PROMPT
        if context_block:
            system_prompt = f"{BASE_SYSTEM_PROMPT}\n\n{context_block}"

        await self.memory.build_system_prompt(system_prompt, user_message)

        # 3. Add user turn
        self.memory.add_user_turn(user_message)

        # 4. Compress if near token limit
        await self.memory.maybe_compress()

        # 5. Build message list and stream
        messages_dict = self.memory.get_messages()
        messages = [LLMMessage(m["role"], m["content"]) for m in messages_dict]

        full_response = ""
        async for chunk in llm_gateway.stream(messages=messages):
            full_response += chunk
            yield chunk

        # 6. Store assistant turn + maybe compress again
        self.memory.add_assistant_turn(full_response)
        await self.memory.maybe_compress()

        # Persist assistant message and update session title / updated_at
        if self._db:
            from db.repos.chat import ChatRepo
            _repo = ChatRepo(self._db)
            await _repo.add_message(self.session.session_id, "assistant", full_response)
            await _repo.maybe_set_title(self.session.session_id, user_message)

        await event_bus.emit(Events.CHAT_RESPONSE_DONE, {
            "session_id": self.session.session_id,
            "rag_sources": [c.source for c in rag_chunks],
        })

    async def _retrieve(self, query: str) -> list[RetrievedChunk]:
        """
        Query the RAG knowledge base. Returns empty list if the
        knowledge base is empty or the query fails — never raises.
        """
        try:
            chunks = await self._retriever.retrieve(query)
            # Trim total context to MAX_CONTEXT_CHARS
            kept, total = [], 0
            for chunk in chunks:
                if total + len(chunk.content) > MAX_CONTEXT_CHARS:
                    break
                kept.append(chunk)
                total += len(chunk.content)
            return kept
        except Exception:
            return []

    async def close(self) -> None:
        """Persist session summary to long-term memory."""
        await self.memory.end_session()
