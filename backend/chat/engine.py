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

import base64 as b64
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field
import json
import logging
import re
import time
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from chat.memory.manager import MemoryManager
from chat.orchestrator import (
    get_orchestrator,
    kb_has_sources,
    legacy_route_decision,
)
from chat.rag.retriever import HybridRetriever, RetrievedChunk
from config.settings import settings
from core.events.bus import Events, event_bus
from core.llm.gateway import llm_gateway
from core.permissions.gate import Mode, PermissionGate
from core.session.manager import Session
from core.tools.registry import tool_registry

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

BASE_SYSTEM_PROMPT = """\
You are a helpful, knowledgeable personal assistant.

## Tools
When tools are available for this turn, use them only when needed:

- **web_search**: For current data — live news, today's weather, real-time \
prices, sports scores, or recent software releases. Do NOT search for general \
knowledge, historical facts, how-to explanations, coding help, or math.
- **rag_query**: For documents or files in the personal knowledge base when \
you need more detail than the retrieved context already provides.
- **render_chart**: When the user asks for a chart, graph, or visualization. \
Provide the complete dataset and series configuration.

## Answering
- When retrieved document context appears below, use it and cite sources \
(file names).
- When tool results are provided, use them and cite URLs or sources.
- Otherwise answer from your general knowledge. Be concise and direct.
"""

logger = logging.getLogger(__name__)

# Maximum characters of retrieved RAG context to inject into the system prompt
MAX_CONTEXT_CHARS = 6000

# Maximum number of tool-call rounds before we force a final answer
MAX_TOOL_ROUNDS = 5


@dataclass
class _Timer:
    """Lightweight wall-clock stopwatch for per-phase request metrics."""

    _t0: float = field(default_factory=time.monotonic, init=False)
    phases: dict[str, int] = field(default_factory=dict, init=False)

    def mark(self, name: str) -> None:
        self.phases[name] = round((time.monotonic() - self._t0) * 1000)

    def elapsed_ms(self) -> int:
        return round((time.monotonic() - self._t0) * 1000)


def _format_context(chunks: list[RetrievedChunk]) -> str:
    if not chunks:
        return ""
    parts = [f"[{i}] Source: {c.source}\n{c.content}" for i, c in enumerate(chunks, 1)]
    return "## Retrieved context\n\n" + "\n\n---\n\n".join(parts)


class ChatEngine:
    def __init__(self, session: Session, db: AsyncSession | None = None) -> None:
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
        attachments: list[dict] | None = None,
        custom_system_prompt: str | None = None,
        session_prompt: str | None = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        timer = _Timer()

        await event_bus.emit(
            Events.CHAT_MESSAGE_RECEIVED,
            {
                "session_id": self.session.session_id,
                "message": user_message,
            },
        )

        # Persist user message (with attachments so they survive a reload)
        if self._db:
            from db.repos.chat import ChatRepo

            _repo = ChatRepo(self._db)
            await _repo.ensure_session(self.session.session_id, "chat")
            await _repo.add_message(
                self.session.session_id,
                "user",
                user_message,
                attachments=attachments or None,
            )

        # 1. Route: direct | rag | tools | rag_and_tools
        if settings.orchestrator_enabled:
            has_kb = await kb_has_sources()
            decision = await get_orchestrator().route(
                user_message,
                has_kb_sources=has_kb,
            )
        else:
            decision = legacy_route_decision()

        timer.mark("route_ms")
        logger.info(
            "chat route=%s tools=%s reason=%s session=%s  [%.0f ms]",
            decision.route,
            sorted(decision.tools),
            decision.reason,
            self.session.session_id,
            timer.phases["route_ms"],
        )

        # 2. Retrieve RAG context when orchestrator requests it
        rag_chunks: list[RetrievedChunk] = []
        if decision.needs_rag:
            rag_chunks = await self._retrieve(user_message)
        context_block = _format_context(rag_chunks)
        if decision.needs_rag:
            timer.mark("rag_ms")

        # 3. Build system prompt (base + memories + optional RAG)
        #    The user-defined system prompt and session prompt are NOT put here;
        #    they are injected into the first user turn (see step 4b) so the
        #    model always sees them as immutable conversation-opening context
        #    while the DB and memory manager store only the clean user message.
        system_prompt = BASE_SYSTEM_PROMPT
        if context_block:
            system_prompt = f"{system_prompt}\n\n{context_block}"
        await self.memory.build_system_prompt(system_prompt, user_message)

        # 4. Add user turn to short-term memory & compress if needed
        #    Memory always stores plain text (no base64 blobs).
        self.memory.add_user_turn(user_message)
        await self.memory.maybe_compress()

        # Build the actual message list for the LLM.  If the user attached files,
        # patch the last user message to multimodal content *after* memory is
        # updated so compression always operates on plain text.
        llm_messages = _inject_attachments(self.memory.get_messages(), attachments or [])

        # 4b. First-message context injection (LLM copy only — invisible to user)
        #   • custom_system_prompt: global rules the user set in Settings; arrives
        #     only on the first message of a session. Wrapped with an instruction
        #     to follow it throughout the entire conversation.
        #   • session_prompt: one-off context set per session; also arrives only
        #     on the first message.
        #   Both are prepended to the last user message in the order:
        #   [system guidelines] → [session context] → actual user message.
        if custom_system_prompt or session_prompt:
            llm_messages = _inject_first_message_context(
                llm_messages, custom_system_prompt, session_prompt
            )

        # 5. Tool loop or direct stream — collect text for memory
        full_response = ""
        first_token = False
        if decision.needs_tools:
            # Fast path: when web_search is the only tool needed, skip the
            # non-streaming "pick a tool" LLM round-trip.  Run the search
            # directly, inject results, then do a single streaming call.
            # This cuts first-token latency roughly in half for news/weather queries.
            if decision.tools == frozenset({"web_search"}):
                async for event in self._search_and_stream(
                    user_message,
                    llm_messages,
                ):
                    if event["type"] == "tool_result":
                        timer.mark("search_ms")
                    if event["type"] == "token":
                        if not first_token:
                            first_token = True
                            timer.mark("ttft_ms")
                        full_response += event["text"]
                    yield event
            else:
                async for event in self._agentic_loop(
                    allowed_tools=decision.tools,
                    messages_override=llm_messages,
                ):
                    if event["type"] == "token":
                        if not first_token:
                            first_token = True
                            timer.mark("ttft_ms")
                        full_response += event["text"]
                    elif event["type"] == "chart":
                        full_response += _chart_spec_to_markdown(event["spec"])
                    yield event
        else:
            async for chunk in llm_gateway.stream_from_raw(llm_messages):
                if not first_token:
                    first_token = True
                    timer.mark("ttft_ms")
                full_response += chunk
                yield {"type": "token", "text": chunk}

        total_ms = timer.elapsed_ms()
        timer.mark("total_ms")
        logger.info(
            "chat done  total=%d ms  phases=%s",
            total_ms,
            timer.phases,
        )
        yield {"type": "metrics", "total_ms": total_ms, "phases": timer.phases}

        # 6. Persist metrics
        if self._db:
            try:
                from db.repos.metrics import MetricsRepo

                await MetricsRepo(self._db).add(
                    session_id=self.session.session_id,
                    total_ms=total_ms,
                    phases=timer.phases,
                    route=decision.route,
                )
            except Exception:
                pass  # metrics are best-effort — never block the response

        # 7. Persist assistant turn & update session title
        self.memory.add_assistant_turn(full_response)
        await self.memory.maybe_compress()

        if self._db:
            from db.repos.chat import ChatRepo

            _repo = ChatRepo(self._db)
            await _repo.add_message(self.session.session_id, "assistant", full_response)
            await _repo.maybe_set_title(self.session.session_id, user_message)

        await event_bus.emit(
            Events.CHAT_RESPONSE_DONE,
            {
                "session_id": self.session.session_id,
                "route": decision.route,
                "rag_sources": [c.source for c in rag_chunks],
            },
        )

    # ------------------------------------------------------------------ #
    #  Agentic loop                                                        #
    # ------------------------------------------------------------------ #

    async def _agentic_loop(
        self,
        allowed_tools: frozenset[str] | None = None,
        messages_override: list[dict] | None = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
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
        original_messages: list[dict] = (
            messages_override if messages_override is not None else self.memory.get_messages()
        )
        messages: list[dict] = list(original_messages)
        tool_schemas = tool_registry.get_openai_schemas(Mode.CHAT)
        tools = tool_registry.get_tools(Mode.CHAT, self._gate)

        if allowed_tools is not None:
            tool_schemas = [s for s in tool_schemas if s["function"]["name"] in allowed_tools]
            tools = {k: v for k, v in tools.items() if k in allowed_tools}

        try:
            for _round in range(MAX_TOOL_ROUNDS):
                response_msg = await llm_gateway.complete_with_tools_raw(
                    messages,
                    tool_schemas,
                )

                # Primary: structured tool_calls from the API
                # Fallback: parse tool call JSON embedded in content (EXO / Llama 3.x)
                is_synthetic = not response_msg.tool_calls
                effective_calls = response_msg.tool_calls or _parse_tool_calls_from_content(
                    response_msg.content or "", tools
                )

                if not effective_calls:
                    # No tool calls — stream the final answer
                    async for chunk in llm_gateway.stream_from_raw(messages):
                        yield {"type": "token", "text": chunk}
                    return

                # ── Execute tool calls ────────────────────────────────────
                messages.append(
                    _build_tool_call_msg(
                        content=None if is_synthetic else response_msg.content,
                        tool_calls=effective_calls,
                    )
                )

                round_results: list[tuple[str, str]] = []  # (tool_name, result_text)

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
                    yield {
                        "type": "tool_result",
                        "id": tc.id,
                        "name": fn_name,
                        "success": success,
                        "preview": preview,
                    }

                    round_results.append((fn_name, tool_result_text))
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "content": tool_result_text,
                        }
                    )

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

    async def _search_and_stream(
        self,
        user_message: str,
        messages: list[dict],
    ) -> AsyncGenerator[dict[str, Any], None]:
        """
        Web-search fast path — avoids the non-streaming LLM round-trip that the
        full agentic loop uses to decide which tool to call.

        Flow: run web_search directly → emit tool events → inject results into
        the message list → stream the final answer in one pass.
        """
        tools = tool_registry.get_tools(Mode.CHAT, self._gate)
        tool = tools.get("web_search")

        if tool is None:
            async for chunk in llm_gateway.stream_from_raw(messages):
                yield {"type": "token", "text": chunk}
            return

        tool_id = f"call_{uuid4().hex[:8]}"
        yield {
            "type": "tool_start",
            "id": tool_id,
            "name": "web_search",
            "args": {"query": user_message},
        }

        result = await self._call_tool(tools, "web_search", {"query": user_message})
        result_text, success = result

        yield {
            "type": "tool_result",
            "id": tool_id,
            "name": "web_search",
            "success": success,
            "preview": (result_text or "")[:200],
        }

        enriched = _inject_tool_results(messages, [("web_search", result_text)])
        async for chunk in llm_gateway.stream_from_raw(enriched):
            yield {"type": "token", "text": chunk}

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
    arguments: str  # JSON-encoded string, matching OpenAI API shape


@dataclass
class _SyntheticToolCall:
    id: str
    function: _SyntheticFunction


# ------------------------------------------------------------------ #
#  Content parser — EXO / Llama 3.x fallback                         #
# ------------------------------------------------------------------ #

# Llama 3 special tokens that may wrap tool-call JSON in content
_LLAMA_TOKEN_RE = re.compile(r"<\|[^|>]+\|>")


def _extract_json_objects(text: str) -> list[dict]:
    """Extract all top-level JSON objects from text using brace counting."""
    objects: list[dict] = []
    depth = 0
    start = -1
    for i, ch in enumerate(text):
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
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
    clean = _LLAMA_TOKEN_RE.sub("", content).strip()

    calls: list[_SyntheticToolCall] = []
    seen: set[str] = set()

    for obj in _extract_json_objects(clean):
        name = obj.get("name")
        # Only accept known tool names to avoid false positives
        if not name or name not in available_tools or name in seen:
            continue
        seen.add(name)

        params = (
            obj.get("parameters")  # Llama 3 native
            or obj.get("arguments")  # OpenAI-alike
            or obj.get("input")  # some models use "input"
            or {}
        )
        if isinstance(params, str):
            try:
                params = json.loads(params)
            except json.JSONDecodeError:
                params = {}

        calls.append(
            _SyntheticToolCall(
                id=f"call_{uuid4().hex[:8]}",
                function=_SyntheticFunction(
                    name=name,
                    arguments=json.dumps(params),
                ),
            )
        )

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


def _chart_spec_to_markdown(spec: dict) -> str:
    """Embed a chart spec in assistant content so it persists in chat history."""
    return "\n\n```chart\n" + json.dumps(spec, ensure_ascii=False) + "\n```\n\n"


def _inject_attachments(messages: list[dict], attachments: list[dict]) -> list[dict]:
    """
    Patch the last user message to include file / image attachments.

    * Images  → appended as OpenAI ``image_url`` content blocks so vision-capable
                models can analyse them.
    * Text / code files → decoded from base64 and prepended to the message text as
                fenced code blocks (capped at 4 000 chars each to avoid context bloat).
    * Other binary files → just the filename is mentioned in the text.

    Memory always stores plain text; this function only modifies the copy passed to
    the LLM, never the memory manager's internal state.
    """
    if not attachments:
        return messages

    image_blocks: list[dict] = []
    text_prefix_parts: list[str] = []

    for att in attachments:
        mime: str = att.get("type", "")
        name: str = att.get("name", "file")
        data: str = att.get("data", "")

        if mime.startswith("image/"):
            image_blocks.append(
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime};base64,{data}"},
                }
            )
        else:
            # Attempt UTF-8 decode for text / code / JSON files.
            try:
                raw_bytes = b64.b64decode(data)
                text_content = raw_bytes.decode("utf-8", errors="replace")
                # Cap individual file content to avoid blowing out the context window.
                if len(text_content) > 4000:
                    text_content = text_content[:4000] + "\n… (truncated)"
                lang = name.rsplit(".", 1)[-1] if "." in name else ""
                text_prefix_parts.append(f"[Attached file: {name}]\n```{lang}\n{text_content}\n```")
            except Exception:
                text_prefix_parts.append(f"[Attached binary file: {name}]")

    if not image_blocks and not text_prefix_parts:
        return messages

    # Find the last user message and rebuild its content.
    patched = list(messages)
    for i in range(len(patched) - 1, -1, -1):
        if patched[i].get("role") == "user":
            original_text: str = patched[i].get("content") or ""
            if isinstance(original_text, list):
                # Already multimodal for some reason — leave as-is.
                break

            # Prepend any extracted text blocks to the user's own text.
            pieces = text_prefix_parts + ([original_text] if original_text else [])
            combined_text = "\n\n".join(pieces)

            if image_blocks:
                new_content: list[dict] | str = [
                    {"type": "text", "text": combined_text or " "}
                ] + image_blocks
            else:
                new_content = combined_text

            patched[i] = {**patched[i], "content": new_content}
            break

    return patched


def _inject_first_message_context(
    messages: list[dict],
    system_prompt: str | None,
    session_prompt: str | None,
) -> list[dict]:
    """
    Prepend invisible context to the last user message in the LLM copy.

    Only the LLM sees this — the DB and memory manager always store the clean
    user message.  Both prompts arrive only on the first message of a session.

    Format:
        [Always follow these guidelines throughout the entire conversation]
        <system prompt>          ← only when system_prompt is provided

        [Context for this session]
        <session prompt>         ← only when session_prompt is provided

        <actual user message>
    """
    parts: list[str] = []
    sys_text = (system_prompt or "").strip()
    ses_text = (session_prompt or "").strip()

    if sys_text:
        parts.append(
            "[Always follow these guidelines throughout the entire conversation]\n" + sys_text
        )
    if ses_text:
        parts.append("[Context for this session]\n" + ses_text)

    if not parts:
        return messages

    header = "\n\n".join(parts)

    patched = list(messages)
    for i in range(len(patched) - 1, -1, -1):
        if patched[i].get("role") == "user":
            content = patched[i].get("content") or ""
            if isinstance(content, str):
                patched[i] = {**patched[i], "content": f"{header}\n\n{content}"}
            elif isinstance(content, list):
                # Multimodal: prepend to the first text block
                new_content = list(content)
                for j, block in enumerate(new_content):
                    if isinstance(block, dict) and block.get("type") == "text":
                        new_content[j] = {**block, "text": f"{header}\n\n{block['text']}"}
                        break
                patched[i] = {**patched[i], "content": new_content}
            break
    return patched


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

    result_block = "\n\n".join(f"[{name} result]\n{text}" for name, text in tool_results)

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
