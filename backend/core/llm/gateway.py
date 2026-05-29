"""
LLM Gateway — single entry point for all LLM calls across all modes.
Uses the OpenAI-compatible API (works with local models, OpenAI, etc.)
"""
from __future__ import annotations

import logging
import time
from collections.abc import AsyncGenerator
from typing import Any

from openai import AsyncOpenAI
from openai.types.chat import ChatCompletion, ChatCompletionMessage

from config.settings import settings

logger = logging.getLogger(__name__)


class LLMMessage:
    def __init__(self, role: str, content: str):
        self.role = role
        self.content = content

    def to_dict(self) -> dict[str, str]:
        return {"role": self.role, "content": self.content}


class LLMGateway:
    """
    Thin async wrapper around any OpenAI-compatible LLM endpoint.
    All blocks (Chat, Cowork, Code) go through this single class.
    """

    def __init__(self) -> None:
        self._client = AsyncOpenAI(
            base_url=settings.llm_base_url,
            api_key=settings.llm_api_key,
        )
        self._embed_client = AsyncOpenAI(
            base_url=settings.embedding_base_url,
            api_key=settings.embedding_api_key,
        )

    # ------------------------------------------------------------------ #
    #  Text generation                                                     #
    # ------------------------------------------------------------------ #

    async def complete(
        self,
        messages: list[LLMMessage],
        *,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict | None = None,
    ) -> str:
        """Non-streaming completion — returns the assistant text content."""
        t0 = time.monotonic()
        response: ChatCompletion = await self._client.chat.completions.create(
            model=model or settings.llm_model,
            messages=[m.to_dict() for m in messages],
            temperature=temperature if temperature is not None else settings.llm_temperature,
            max_tokens=max_tokens or settings.llm_max_tokens,
            tools=tools or None,
            tool_choice=tool_choice or None,
            stream=False,
        )
        logger.info("llm.complete  %.0f ms", (time.monotonic() - t0) * 1000)
        return response.choices[0].message.content or ""

    async def complete_full(
        self,
        messages: list[LLMMessage],
        *,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict | None = None,
    ) -> ChatCompletionMessage:
        """Non-streaming completion — returns the full message object (content + tool_calls)."""
        t0 = time.monotonic()
        response: ChatCompletion = await self._client.chat.completions.create(
            model=model or settings.llm_model,
            messages=[m.to_dict() for m in messages],
            temperature=temperature if temperature is not None else settings.llm_temperature,
            max_tokens=max_tokens or settings.llm_max_tokens,
            tools=tools or None,
            tool_choice=tool_choice or None,
            stream=False,
        )
        logger.info("llm.complete_full  %.0f ms", (time.monotonic() - t0) * 1000)
        return response.choices[0].message

    async def stream(
        self,
        messages: list[LLMMessage],
        *,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncGenerator[str, None]:
        """Streaming completion — yields text chunks as they arrive."""
        t0 = time.monotonic()
        response = await self._client.chat.completions.create(
            model=model or settings.llm_model,
            messages=[m.to_dict() for m in messages],
            temperature=temperature if temperature is not None else settings.llm_temperature,
            max_tokens=max_tokens or settings.llm_max_tokens,
            stream=True,
        )
        ttfb = (time.monotonic() - t0) * 1000
        token_count = 0
        async for chunk in response:
            delta = chunk.choices[0].delta
            if delta.content:
                if token_count == 0:
                    logger.info("llm.stream  TTFB %.0f ms", ttfb)
                token_count += 1
                yield delta.content
        logger.info("llm.stream  total %.0f ms  tokens %d", (time.monotonic() - t0) * 1000, token_count)

    async def complete_with_tools_raw(
        self,
        messages: list[dict],
        tools: list[dict],
        *,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> ChatCompletionMessage:
        """
        Non-streaming call that accepts already-serialised message dicts and
        tool schemas (OpenAI function-calling format).  Returns the full
        ChatCompletionMessage so callers can inspect tool_calls.
        """
        t0 = time.monotonic()
        response: ChatCompletion = await self._client.chat.completions.create(
            model=model or settings.llm_model,
            messages=messages,  # type: ignore[arg-type]
            temperature=temperature if temperature is not None else settings.llm_temperature,
            max_tokens=max_tokens or settings.llm_max_tokens,
            tools=tools or None,  # type: ignore[arg-type]
            tool_choice="auto",
            stream=False,
        )
        logger.info("llm.complete_with_tools_raw  %.0f ms", (time.monotonic() - t0) * 1000)
        return response.choices[0].message

    async def stream_from_raw(
        self,
        messages: list[dict],
        *,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncGenerator[str, None]:
        """
        Streaming completion that accepts already-serialised message dicts.
        Use this for the final answer after tool calls have been resolved.
        """
        t0 = time.monotonic()
        response = await self._client.chat.completions.create(
            model=model or settings.llm_model,
            messages=messages,  # type: ignore[arg-type]
            temperature=temperature if temperature is not None else settings.llm_temperature,
            max_tokens=max_tokens or settings.llm_max_tokens,
            stream=True,
        )
        ttfb = (time.monotonic() - t0) * 1000
        token_count = 0
        async for chunk in response:
            delta = chunk.choices[0].delta
            if delta.content:
                if token_count == 0:
                    logger.info("llm.stream_from_raw  TTFB %.0f ms", ttfb)
                token_count += 1
                yield delta.content
        logger.info(
            "llm.stream_from_raw  total %.0f ms  tokens %d",
            (time.monotonic() - t0) * 1000, token_count,
        )

    # ------------------------------------------------------------------ #
    #  Embeddings                                                          #
    # ------------------------------------------------------------------ #

    async def embed(self, texts: list[str]) -> list[list[float]]:
        """
        Generate embeddings via the embedding model.
        Strips empty strings before sending (some models reject them).
        """
        # Replace empty strings with a single space to avoid API errors
        cleaned = [t if t.strip() else " " for t in texts]
        response = await self._embed_client.embeddings.create(
            model=settings.embedding_model,
            input=cleaned,
        )
        # Sort by index to guarantee order matches input
        ordered = sorted(response.data, key=lambda x: x.index)
        return [item.embedding for item in ordered]


# Module-level singleton
llm_gateway = LLMGateway()
