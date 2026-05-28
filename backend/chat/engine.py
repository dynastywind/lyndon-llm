"""
Chat Engine — conversation loop for Chat mode.

Agentic tool loop:
  1. Build messages from memory (system + history + user turn)
  2. Call the LLM non-streaming with registered tools exposed
  3. If the model requests tool calls → execute them, stream status hints,
     append results to message list, repeat (max MAX_TOOL_ROUNDS)
  4. Stream the final answer back to the client

RAG context is injected into the system prompt before the loop so retrieval
results are always available to the model regardless of whether it uses tools.
"""
from __future__ import annotations

import json
from collections.abc import AsyncGenerator
from typing import TYPE_CHECKING

from chat.memory.manager import MemoryManager
from chat.rag.retriever import HybridRetriever, RetrievedChunk
from core.events.bus import event_bus, Events
from core.llm.gateway import llm_gateway, LLMMessage
from core.permissions.gate import Mode, PermissionGate
from core.session.manager import Session
from core.tools.registry import tool_registry

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

BASE_SYSTEM_PROMPT = """\
You are a helpful, knowledgeable personal assistant.

## Tools
You have access to the following tools — use them proactively:

- **web_search**: Call this whenever the user asks about recent events, news, \
current prices, sports scores, weather, release announcements, or anything \
that may have changed after your training cut-off. When in doubt about \
whether your knowledge is current, search rather than guess.
- **rag_query**: Call this when the user asks about documents, files, or \
knowledge that may have been uploaded to your personal knowledge base.

## Answering
- When context or search results are provided, use them to answer accurately \
and cite the source (file name or URL).
- If neither tool returns useful information, answer from your general \
knowledge and say so briefly.
- Be concise and direct. Ask clarifying questions when needed.
"""

# Maximum characters of retrieved RAG context to inject into the system prompt
MAX_CONTEXT_CHARS = 6000

# Maximum number of tool-call rounds before we force a final answer
MAX_TOOL_ROUNDS = 5


def _format_context(chunks: list[RetrievedChunk]) -> str:
    if not chunks:
        return ""
    parts = [f"[{i}] Source: {c.source}\n{c.content}" for i, c in enumerate(chunks, 1)]
    return "## Retrieved context\n\n" + "\n\n---\n\n".join(parts)


class ChatEngine:
    def __init__(self, session: Session, db: "AsyncSession | None" = None) -> None:
        self.session = session
        self.memory = MemoryManager(session.session_id)
        self._retriever = HybridRetriever()
        self._db = db
        # Build a permissive gate for Chat mode — web_search is READ only
        self._gate = PermissionGate(Mode.CHAT)

    # ------------------------------------------------------------------ #
    #  Main entry point                                                    #
    # ------------------------------------------------------------------ #

    async def stream_response(
        self,
        user_message: str,
    ) -> AsyncGenerator[str, None]:
        await event_bus.emit(Events.CHAT_MESSAGE_RECEIVED, {
            "session_id": self.session.session_id,
            "message": user_message,
        })

        # Persist user message
        if self._db:
            from db.repos.chat import ChatRepo
            _repo = ChatRepo(self._db)
            await _repo.ensure_session(self.session.session_id, "chat")
            await _repo.add_message(self.session.session_id, "user", user_message)

        # 1. Retrieve RAG context
        rag_chunks = await self._retrieve(user_message)
        context_block = _format_context(rag_chunks)

        # 2. Build system prompt (base + memories + RAG)
        system_prompt = BASE_SYSTEM_PROMPT
        if context_block:
            system_prompt = f"{BASE_SYSTEM_PROMPT}\n\n{context_block}"
        await self.memory.build_system_prompt(system_prompt, user_message)

        # 3. Add user turn to short-term memory & compress if needed
        self.memory.add_user_turn(user_message)
        await self.memory.maybe_compress()

        # 4. Run the agentic tool loop
        full_response = ""
        async for chunk in self._agentic_loop():
            full_response += chunk
            yield chunk

        # 5. Persist assistant turn & update session title
        self.memory.add_assistant_turn(full_response)
        await self.memory.maybe_compress()

        if self._db:
            from db.repos.chat import ChatRepo
            _repo = ChatRepo(self._db)
            await _repo.add_message(self.session.session_id, "assistant", full_response)
            await _repo.maybe_set_title(self.session.session_id, user_message)

        await event_bus.emit(Events.CHAT_RESPONSE_DONE, {
            "session_id": self.session.session_id,
            "rag_sources": [c.source for c in rag_chunks],
        })

    # ------------------------------------------------------------------ #
    #  Agentic loop                                                        #
    # ------------------------------------------------------------------ #

    async def _agentic_loop(self) -> AsyncGenerator[str, None]:
        """
        Runs tool calls until the model produces a plain-text response or
        MAX_TOOL_ROUNDS is reached, then streams the final answer.
        """
        # Serialise current memory to raw message dicts
        messages: list[dict] = self.memory.get_messages()

        # Get OpenAI-format tool schemas for Chat mode
        tool_schemas = tool_registry.get_openai_schemas(Mode.CHAT)
        # Instantiated tools for execution
        tools = tool_registry.get_tools(Mode.CHAT, self._gate)

        tools_ran = False

        try:
            for _round in range(MAX_TOOL_ROUNDS):
                response_msg = await llm_gateway.complete_with_tools_raw(
                    messages, tool_schemas,
                )

                if not response_msg.tool_calls:
                    # Model is done with tool use — stream the final answer
                    if tools_ran:
                        # Append assistant message (no tool_calls) and stream
                        messages.append({
                            "role": "assistant",
                            "content": response_msg.content or "",
                        })
                        async for chunk in llm_gateway.stream_from_raw(messages[:-1]):
                            yield chunk
                    else:
                        # First call had no tool calls — stream fresh (better UX)
                        async for chunk in llm_gateway.stream_from_raw(messages):
                            yield chunk
                    return

                # ── Tool calls requested ──────────────────────────────────
                tools_ran = True

                # Append the assistant's tool-call turn (required by the API)
                messages.append(_assistant_tool_call_msg(response_msg))

                for tc in response_msg.tool_calls:
                    fn_name = tc.function.name
                    try:
                        fn_args = json.loads(tc.function.arguments or "{}")
                    except json.JSONDecodeError:
                        fn_args = {}

                    # Yield a visible status hint to the frontend
                    hint = _tool_status_hint(fn_name, fn_args)
                    yield hint

                    # Execute the tool
                    tool_result_text = await self._call_tool(tools, fn_name, fn_args)

                    # Append tool result message
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": tool_result_text,
                    })

            # Max rounds reached — stream a final answer with the accumulated context
            async for chunk in llm_gateway.stream_from_raw(messages):
                yield chunk

        except Exception as exc:
            # Model doesn't support function calling or an unexpected error occurred.
            # Fall back to plain streaming without tools.
            yield f"\n\n*(tool system unavailable: {exc})*\n\n"
            async for chunk in llm_gateway.stream_from_raw(messages):
                yield chunk

    # ------------------------------------------------------------------ #
    #  Helpers                                                             #
    # ------------------------------------------------------------------ #

    async def _call_tool(
        self,
        tools: dict,
        fn_name: str,
        fn_args: dict,
    ) -> str:
        tool = tools.get(fn_name)
        if tool is None:
            return f"Error: unknown tool '{fn_name}'"
        try:
            result = await tool.run(**fn_args)
            if result.success:
                return result.output or "(empty result)"
            return f"Tool error: {result.error}"
        except Exception as exc:
            return f"Tool execution error: {exc}"

    async def _retrieve(self, query: str) -> list[RetrievedChunk]:
        try:
            chunks = await self._retriever.retrieve(query)
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
        await self.memory.end_session()


# ------------------------------------------------------------------ #
#  Message serialisation helpers                                       #
# ------------------------------------------------------------------ #

def _assistant_tool_call_msg(response_msg) -> dict:
    """Convert a ChatCompletionMessage with tool_calls to a plain dict."""
    tool_calls_serialised = [
        {
            "id": tc.id,
            "type": "function",
            "function": {
                "name": tc.function.name,
                "arguments": tc.function.arguments,
            },
        }
        for tc in (response_msg.tool_calls or [])
    ]
    return {
        "role": "assistant",
        "content": response_msg.content,  # may be None
        "tool_calls": tool_calls_serialised,
    }


def _tool_status_hint(fn_name: str, fn_args: dict) -> str:
    """Return a short Markdown status line to stream to the client."""
    if fn_name == "web_search":
        query = fn_args.get("query", "…")
        return f"\n> 🔍 Searching the web for **{query}**…\n\n"
    if fn_name == "rag_query":
        query = fn_args.get("query", "…")
        return f"\n> 📚 Querying knowledge base for **{query}**…\n\n"
    return f"\n> ⚙️ Running **{fn_name}**…\n\n"
