"""
Chat Engine — conversation loop for Chat mode.

Agentic tool loop:
  1. Build messages from memory (system + history + user turn)
  2. Call the LLM non-streaming with registered tools exposed
  3. If the model requests tool calls → execute them, emit SSE events,
     append results to message list, repeat (max MAX_TOOL_ROUNDS)
  4. Stream the final answer back as token events

All yields are typed event dicts consumed by the SSE route:
  {"type": "token",       "text": "…"}
  {"type": "tool_start",  "id": "…", "name": "…", "args": {…}}
  {"type": "tool_result", "id": "…", "name": "…", "success": bool, "preview": "…"}
  {"type": "error",       "message": "…"}
"""
from __future__ import annotations

import json
import re
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any
from uuid import uuid4

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

- **web_search**: Call this ONLY when the answer genuinely requires current \
data: live news, today's weather, real-time prices, sports scores, or \
software release announcements from the past few months. \
Do NOT search for general knowledge, historical facts, how-to explanations, \
coding help, math, or anything your training already covers well.
- **rag_query**: Call this when the user asks about documents, files, or \
knowledge that may have been uploaded to your personal knowledge base.
- **render_chart**: Call this whenever the user asks for a chart, graph, or \
data visualization. Provide the complete dataset and series configuration. \
You may combine with web_search: search first, then render a chart from \
the results.

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
    ) -> AsyncGenerator[dict[str, Any], None]:
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

        # 4. Run the agentic tool loop — collect text for memory
        full_response = ""
        async for event in self._agentic_loop():
            if event["type"] == "token":
                full_response += event["text"]
            yield event

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

    async def _agentic_loop(self) -> AsyncGenerator[dict[str, Any], None]:
        """
        Runs tool calls until the model produces a plain-text response or
        MAX_TOOL_ROUNDS is reached, then streams the final answer as token events.

        Two server behaviours are handled:

        Structured (standard OpenAI API)
          response_msg.tool_calls is populated → execute tools → append tool-role
          messages → call model again → repeat until plain answer → stream.

        Content / EXO (Llama 3.x servers that don't translate native tokens)
          Tool call JSON appears in response_msg.content instead → extract via
          _parse_tool_calls_from_content → execute tools → inject results directly
          into the last user message → single streaming call.  No second round-trip
          is attempted because EXO doesn't understand tool / tool_calls messages.
        """
        original_messages: list[dict] = self.memory.get_messages()
        messages: list[dict] = list(original_messages)
        tool_schemas = tool_registry.get_openai_schemas(Mode.CHAT)
        tools = tool_registry.get_tools(Mode.CHAT, self._gate)

        try:
            for _round in range(MAX_TOOL_ROUNDS):
                response_msg = await llm_gateway.complete_with_tools_raw(
                    messages, tool_schemas,
                )

                # Primary: structured tool_calls from the API
                # Fallback: parse tool call JSON embedded in content (EXO / Llama 3.x)
                is_synthetic = not response_msg.tool_calls
                effective_calls = (
                    response_msg.tool_calls
                    or _parse_tool_calls_from_content(response_msg.content or "", tools)
                )

                if not effective_calls:
                    # No tool calls — stream the final answer
                    async for chunk in llm_gateway.stream_from_raw(messages):
                        yield {"type": "token", "text": chunk}
                    return

                # ── Execute tool calls ────────────────────────────────────
                messages.append(_build_tool_call_msg(
                    content=None if is_synthetic else response_msg.content,
                    tool_calls=effective_calls,
                ))

                round_results: list[tuple[str, str]] = []   # (tool_name, result_text)

                for tc in effective_calls:
                    fn_name = tc.function.name
                    try:
                        fn_args = json.loads(tc.function.arguments or "{}")
                    except json.JSONDecodeError:
                        fn_args = {}

                    yield {"type": "tool_start", "id": tc.id, "name": fn_name, "args": fn_args}

                    tool_result_text, success = await self._call_tool(tools, fn_name, fn_args)

                    # If the tool returned a chart spec, forward it as a dedicated event
                    if success:
                        chart_spec = _extract_chart_spec(fn_name, tool_result_text)
                        if chart_spec:
                            yield {"type": "chart", "spec": chart_spec}
                            tool_result_text = (
                                f"The render_chart tool succeeded. Chart "
                                f"'{chart_spec.get('title', '')}' has already "
                                "been rendered and is visible to the user. "
                                "Do not say you could not render the chart, "
                                "and do not try to render it again. Continue "
                                "answering any remaining non-chart parts of "
                                "the user's request."
                            )

                    preview = (tool_result_text or "")[:200]
                    yield {"type": "tool_result", "id": tc.id, "name": fn_name,
                           "success": success, "preview": preview}

                    round_results.append((fn_name, tool_result_text))
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": tool_result_text,
                    })

                if is_synthetic:
                    # EXO / Llama 3.x path: the server doesn't understand tool-role
                    # messages.  Inject results into the user message and stream once
                    # — no second round-trip.
                    final_msgs = _inject_tool_results(original_messages, round_results)
                    async for chunk in llm_gateway.stream_from_raw(final_msgs):
                        yield {"type": "token", "text": chunk}
                    return

            # Max rounds reached — stream final answer
            async for chunk in llm_gateway.stream_from_raw(messages):
                yield {"type": "token", "text": chunk}

        except Exception as exc:
            yield {"type": "error", "message": str(exc)}
            # Fall back: plain streaming without tools
            async for chunk in llm_gateway.stream_from_raw(original_messages):
                yield {"type": "token", "text": chunk}

    # ------------------------------------------------------------------ #
    #  Helpers                                                             #
    # ------------------------------------------------------------------ #

    async def _call_tool(
        self,
        tools: dict,
        fn_name: str,
        fn_args: dict,
    ) -> tuple[str, bool]:
        """Execute a tool and return (result_text, success)."""
        tool = tools.get(fn_name)
        if tool is None:
            return f"Error: unknown tool '{fn_name}'", False
        try:
            result = await tool.run(**fn_args)
            if result.success:
                return result.output or "(empty result)", True
            return f"Tool error: {result.error}", False
        except Exception as exc:
            return f"Tool execution error: {exc}", False

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
#  Synthetic tool-call types (used when the server embeds tool calls  #
#  in content instead of returning structured tool_calls)             #
# ------------------------------------------------------------------ #

@dataclass
class _SyntheticFunction:
    name: str
    arguments: str          # JSON-encoded string, matching OpenAI API shape


@dataclass
class _SyntheticToolCall:
    id: str
    function: _SyntheticFunction


# ------------------------------------------------------------------ #
#  Content parser — EXO / Llama 3.x fallback                         #
# ------------------------------------------------------------------ #

# Llama 3 special tokens that may wrap tool-call JSON in content
_LLAMA_TOKEN_RE = re.compile(r'<\|[^|>]+\|>')


def _extract_json_objects(text: str) -> list[dict]:
    """Extract all top-level JSON objects from text using brace counting."""
    objects: list[dict] = []
    depth = 0
    start = -1
    for i, ch in enumerate(text):
        if ch == '{':
            if depth == 0:
                start = i
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0 and start >= 0:
                try:
                    obj = json.loads(text[start : i + 1])
                    if isinstance(obj, dict):
                        objects.append(obj)
                except json.JSONDecodeError:
                    pass
                start = -1
    return objects


def _parse_tool_calls_from_content(
    content: str,
    available_tools: dict,
) -> list[_SyntheticToolCall]:
    """
    Fallback parser for servers (e.g. EXO) that put Llama 3.x tool calls
    in the message content instead of the tool_calls field.

    Recognises the Llama 3 native format:
        {"name": "<tool>", "parameters": {...}}

    and the OpenAI-alike format:
        {"name": "<tool>", "arguments": {...}}
    """
    if not content:
        return []

    # Strip Llama special tokens so the JSON is cleanly extractable
    clean = _LLAMA_TOKEN_RE.sub('', content).strip()

    calls: list[_SyntheticToolCall] = []
    seen: set[str] = set()

    for obj in _extract_json_objects(clean):
        name = obj.get('name')
        # Only accept known tool names to avoid false positives
        if not name or name not in available_tools or name in seen:
            continue
        seen.add(name)

        params = (
            obj.get('parameters')       # Llama 3 native
            or obj.get('arguments')     # OpenAI-alike
            or obj.get('input')         # some models use "input"
            or {}
        )
        if isinstance(params, str):
            try:
                params = json.loads(params)
            except json.JSONDecodeError:
                params = {}

        calls.append(_SyntheticToolCall(
            id=f"call_{uuid4().hex[:8]}",
            function=_SyntheticFunction(
                name=name,
                arguments=json.dumps(params),
            ),
        ))

    return calls


# ------------------------------------------------------------------ #
#  Message serialisation helpers                                       #
# ------------------------------------------------------------------ #

def _extract_chart_spec(tool_name: str, result_text: str) -> dict | None:
    """Return the chart spec dict if the result is from render_chart, else None."""
    if tool_name != "render_chart":
        return None
    try:
        from chat.tools.chart import CHART_SPEC_KEY
        obj = json.loads(result_text or "")
        return obj.get(CHART_SPEC_KEY)
    except (json.JSONDecodeError, AttributeError, TypeError):
        return None


def _inject_tool_results(
    original_messages: list[dict],
    tool_results: list[tuple[str, str]],
) -> list[dict]:
    """
    EXO / Llama 3.x fallback: rather than using tool-role messages (which EXO
    doesn't understand), append the tool results as context inside the last
    user message so the model can answer in one streaming call.
    """
    if not tool_results:
        return original_messages

    result_block = "\n\n".join(
        f"[{name} result]\n{text}" for name, text in tool_results
    )

    enriched = list(original_messages)
    # Find the last user turn and append the results to it
    for i in range(len(enriched) - 1, -1, -1):
        if enriched[i].get("role") == "user":
            original_content = enriched[i].get("content") or ""
            enriched[i] = {
                **enriched[i],
                "content": (
                    f"{original_content}\n\n"
                    f"---\n"
                    f"Here are results retrieved by available tools:\n\n"
                    f"{result_block}"
                ),
            }
            break

    return enriched


def _build_tool_call_msg(content: str | None, tool_calls: list) -> dict:
    """Build the assistant message dict that precedes tool result messages."""
    return {
        "role": "assistant",
        "content": content,
        "tool_calls": [
            {
                "id": tc.id,
                "type": "function",
                "function": {
                    "name": tc.function.name,
                    "arguments": tc.function.arguments,
                },
            }
            for tc in tool_calls
        ],
    }
