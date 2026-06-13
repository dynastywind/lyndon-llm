"""
LLM Gateway — single entry point for all LLM calls across all modes.
Uses the OpenAI-compatible API (works with local models, OpenAI, etc.)
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
import logging
import time
from typing import Any

from config.settings import settings

logger = logging.getLogger(__name__)

# Use Langfuse's drop-in OpenAI wrapper when credentials are configured;
# fall back to the plain openai client when they are not set.
if settings.langfuse_secret_key and settings.langfuse_public_key:
    import os

    from langfuse import Langfuse
    from langfuse.openai import AsyncOpenAI  # type: ignore[assignment]

    from core.security.pii import mask_langfuse

    # OTEL reads OTEL_SERVICE_NAME once when the tracer provider is created.
    # Set it before instantiating Langfuse so it appears as
    # resourceAttributes.service.name in every exported span.
    os.environ.setdefault("OTEL_SERVICE_NAME", settings.langfuse_service_name)

    # v4 requires explicit instantiation to register the OTEL tracer provider.
    # Store as module-level singleton so other modules (e.g. engine.py) can
    # reuse the same instance and share its tracer provider.
    # `mask` strips PII from every traced input/output before it is exported to
    # the (cloud) Langfuse host — prompts carry decrypted profile data.
    langfuse_client = Langfuse(
        public_key=settings.langfuse_public_key,
        secret_key=settings.langfuse_secret_key,
        host=settings.langfuse_host,
        environment="dev" if settings.environment.value == "development" else "prod",
        mask=mask_langfuse,
    )
    logger.info(
        "Langfuse observability enabled (host: %s, service: %s)",
        settings.langfuse_host,
        settings.langfuse_service_name,
    )
else:
    from openai import AsyncOpenAI

from dataclasses import dataclass  # noqa: E402

from openai.types.chat import ChatCompletion, ChatCompletionMessage  # noqa: E402


@dataclass
class LLMUsage:
    """Token consumption for one or more LLM calls."""

    prompt_tokens: int = 0
    completion_tokens: int = 0

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens

    def __iadd__(self, other: LLMUsage) -> LLMUsage:
        self.prompt_tokens += other.prompt_tokens
        self.completion_tokens += other.completion_tokens
        return self

    def to_dict(self) -> dict[str, int]:
        return {
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
        }


def _usage_from_response(response: ChatCompletion) -> LLMUsage:
    if response.usage is None:
        return LLMUsage()
    return LLMUsage(
        prompt_tokens=response.usage.prompt_tokens or 0,
        completion_tokens=response.usage.completion_tokens or 0,
    )


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
    ) -> tuple[str, LLMUsage]:
        """Non-streaming completion — returns (text, usage)."""
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
        return response.choices[0].message.content or "", _usage_from_response(response)

    async def complete_full(
        self,
        messages: list[LLMMessage],
        *,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict | None = None,
    ) -> tuple[ChatCompletionMessage, LLMUsage]:
        """Non-streaming completion — returns (full message, usage)."""
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
        return response.choices[0].message, _usage_from_response(response)

    async def stream(
        self,
        messages: list[LLMMessage],
        *,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncGenerator[str | LLMUsage, None]:
        """Streaming completion — yields text chunks then a final LLMUsage sentinel."""
        t0 = time.monotonic()
        response = await self._client.chat.completions.create(
            model=model or settings.llm_model,
            messages=[m.to_dict() for m in messages],
            temperature=temperature if temperature is not None else settings.llm_temperature,
            max_tokens=max_tokens or settings.llm_max_tokens,
            stream=True,
            stream_options={"include_usage": True},
        )
        ttfb = (time.monotonic() - t0) * 1000
        token_count = 0
        usage = LLMUsage()
        async for chunk in response:
            if chunk.usage:
                usage = LLMUsage(
                    prompt_tokens=chunk.usage.prompt_tokens or 0,
                    completion_tokens=chunk.usage.completion_tokens or 0,
                )
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta.content:
                if token_count == 0:
                    logger.info("llm.stream  TTFB %.0f ms", ttfb)
                token_count += 1
                yield delta.content
        logger.info(
            "llm.stream  total %.0f ms  tokens %d", (time.monotonic() - t0) * 1000, token_count
        )
        yield usage

    async def complete_with_tools_raw(
        self,
        messages: list[dict],
        tools: list[dict],
        *,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        tool_choice: str = "auto",
    ) -> tuple[ChatCompletionMessage, LLMUsage]:
        """
        Non-streaming call that accepts already-serialised message dicts and
        tool schemas (OpenAI function-calling format).
        Returns (full message, usage).
        """
        t0 = time.monotonic()
        # Bound this call: some local backends (EXO) don't support function-calling
        # and never return for a tools= request. Cap the timeout AND disable the
        # SDK's automatic retries (otherwise a timeout is retried ~3x), so on a hang
        # the caller (the agentic loop) falls back to a plain streamed answer promptly.
        response: ChatCompletion = await self._client.with_options(
            max_retries=0
        ).chat.completions.create(
            model=model or settings.llm_model,
            messages=messages,  # type: ignore[arg-type]
            temperature=temperature if temperature is not None else settings.llm_temperature,
            max_tokens=max_tokens or settings.llm_max_tokens,
            tools=tools or None,  # type: ignore[arg-type]
            tool_choice=tool_choice,
            stream=False,
            timeout=settings.llm_tool_call_timeout,
        )
        logger.info("llm.complete_with_tools_raw  %.0f ms", (time.monotonic() - t0) * 1000)
        return response.choices[0].message, _usage_from_response(response)

    async def stream_from_raw(
        self,
        messages: list[dict],
        *,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncGenerator[str | LLMUsage, None]:
        """
        Streaming completion that accepts already-serialised message dicts.
        Yields text chunks then a final LLMUsage sentinel.
        """
        t0 = time.monotonic()
        response = await self._client.chat.completions.create(
            model=model or settings.llm_model,
            messages=messages,  # type: ignore[arg-type]
            temperature=temperature if temperature is not None else settings.llm_temperature,
            max_tokens=max_tokens or settings.llm_max_tokens,
            stream=True,
            stream_options={"include_usage": True},
        )
        ttfb = (time.monotonic() - t0) * 1000
        token_count = 0
        usage = LLMUsage()
        async for chunk in response:
            if chunk.usage:
                usage = LLMUsage(
                    prompt_tokens=chunk.usage.prompt_tokens or 0,
                    completion_tokens=chunk.usage.completion_tokens or 0,
                )
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta.content:
                if token_count == 0:
                    logger.info("llm.stream_from_raw  TTFB %.0f ms", ttfb)
                token_count += 1
                yield delta.content
        logger.info(
            "llm.stream_from_raw  total %.0f ms  tokens %d",
            (time.monotonic() - t0) * 1000,
            token_count,
        )
        yield usage

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
