"""
Chat Engine — the main conversation loop for Chat mode.
Handles tool routing, memory management, and streaming responses.
"""
from __future__ import annotations

import json
from collections.abc import AsyncGenerator

from chat.memory.manager import MemoryManager
from chat.memory.types import MemoryType
from core.events.bus import event_bus, Events
from core.llm.gateway import llm_gateway, LLMMessage
from core.session.manager import Session
from core.tools.registry import tool_registry
from core.permissions.gate import Mode

CHAT_SYSTEM_PROMPT = """\
You are a helpful, knowledgeable personal assistant.
You have access to web search and a local knowledge base.
Always cite your sources when using retrieved information.
Be concise and direct. Ask clarifying questions when needed.
"""


class ChatEngine:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.memory = MemoryManager(session.session_id)

    async def stream_response(
        self,
        user_message: str,
    ) -> AsyncGenerator[str, None]:
        """
        Main chat turn: enrich with memories → build messages → call LLM (streaming).
        Handles tool calls inline if the LLM requests them.
        """
        await event_bus.emit(Events.CHAT_MESSAGE_RECEIVED, {
            "session_id": self.session.session_id,
            "message": user_message,
        })

        # 1. Enrich system prompt with long-term memories
        await self.memory.build_system_prompt(CHAT_SYSTEM_PROMPT, user_message)

        # 2. Add user turn
        self.memory.add_user_turn(user_message)

        # 3. Compress if needed
        await self.memory.maybe_compress()

        # 4. Get tool schemas for function calling
        tools = tool_registry.get_openai_schemas(Mode.CHAT)
        messages_dict = self.memory.get_messages()
        messages = [LLMMessage(m["role"], m["content"]) for m in messages_dict]

        # 5. Agentic loop — stream response, handle tool calls
        full_response = ""
        async for chunk in self._agentic_stream(messages, tools):
            full_response += chunk
            yield chunk

        # 6. Store assistant turn
        self.memory.add_assistant_turn(full_response)
        await self.memory.maybe_compress()

        await event_bus.emit(Events.CHAT_RESPONSE_DONE, {
            "session_id": self.session.session_id,
        })

    async def _agentic_stream(
        self,
        messages: list[LLMMessage],
        tools: list[dict],
    ) -> AsyncGenerator[str, None]:
        """
        One round of the agentic loop.
        If LLM returns a tool call, execute it and re-prompt.
        Otherwise stream the text response directly.
        """
        # First: non-streaming call to check for tool use
        response = await llm_gateway.complete(
            messages=messages,
            tools=tools or None,
            tool_choice="auto" if tools else None,
        )

        # Simple heuristic: if response starts with a tool call JSON block, handle it
        if response.startswith('{"tool_calls"') or "tool_calls" in response[:50]:
            try:
                tool_result_text = await self._handle_tool_calls(response, messages)
                yield tool_result_text
                return
            except Exception:
                pass  # fall through to stream as-is

        # Stream the text response
        messages_with_response = messages + [LLMMessage("assistant", response)]
        async for chunk in llm_gateway.stream(messages=messages):
            yield chunk

    async def _handle_tool_calls(
        self,
        response: str,
        messages: list[LLMMessage],
    ) -> str:
        """Execute tool calls and return a follow-up response."""
        tool_instances = tool_registry.get_tools(Mode.CHAT, self.session.gate)

        data = json.loads(response)
        tool_calls = data.get("tool_calls", [])

        tool_results = []
        for call in tool_calls:
            fn = call.get("function", {})
            name = fn.get("name")
            args = json.loads(fn.get("arguments", "{}"))

            if name in tool_instances:
                result = await tool_instances[name].run(**args)
                self.memory.add_tool_turn(name, result.output or result.error or "")
                tool_results.append(f"[{name}]: {result.output or result.error}")

        # Re-prompt with tool results
        tool_context = "\n".join(tool_results)
        follow_up = messages + [
            LLMMessage("assistant", response),
            LLMMessage("tool", tool_context),
        ]
        return await llm_gateway.complete(messages=follow_up)

    async def close(self) -> None:
        """Persist session summary to long-term memory."""
        await self.memory.end_session()
