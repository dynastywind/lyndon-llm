"""
Short-term memory — manages the in-session conversation context window.

Strategy:
  1. Keep a ring buffer of recent ConversationTurns.
  2. Estimate token count per turn (rough: 1 token ≈ 4 chars).
  3. When total tokens approach the limit, summarise the oldest half
     and replace those turns with a single SUMMARY turn.
  4. Always preserve the system prompt and the most recent N turns verbatim.
"""

from __future__ import annotations

from chat.memory.types import ConversationTurn
from config.settings import settings


def _estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


class ShortTermMemory:
    ALWAYS_KEEP_RECENT = 6  # never summarise the last N turns

    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        self._turns: list[ConversationTurn] = []
        self._system_prompt: str = ""

    # ------------------------------------------------------------------ #
    #  Public API                                                          #
    # ------------------------------------------------------------------ #

    def set_system_prompt(self, prompt: str) -> None:
        self._system_prompt = prompt

    def add(self, role: str, content: str, **kwargs) -> ConversationTurn:
        turn = ConversationTurn(
            role=role,
            content=content,
            token_count=_estimate_tokens(content),
            **kwargs,
        )
        self._turns.append(turn)
        return turn

    def get_messages(self) -> list[dict[str, str]]:
        """Return messages in OpenAI format, including system prompt."""
        messages = []
        if self._system_prompt:
            messages.append({"role": "system", "content": self._system_prompt})
        messages.extend({"role": t.role, "content": t.content} for t in self._turns)
        return messages

    def total_tokens(self) -> int:
        sp_tokens = _estimate_tokens(self._system_prompt)
        return sp_tokens + sum(t.token_count for t in self._turns)

    def needs_compression(self) -> bool:
        return self.total_tokens() > settings.short_term_max_tokens

    async def compress(self, summariser_fn) -> str:
        """
        Summarise the oldest half of the buffer.
        `summariser_fn` is an async callable: (turns) -> summary_str
        Returns the summary string for optional storage in long-term memory.
        """
        if len(self._turns) <= self.ALWAYS_KEEP_RECENT:
            return ""

        cutoff = len(self._turns) - self.ALWAYS_KEEP_RECENT
        to_summarise = self._turns[:cutoff]
        keep = self._turns[cutoff:]

        summary_text = await summariser_fn(to_summarise)
        summary_turn = ConversationTurn(
            role="assistant",
            content=f"[SUMMARY OF EARLIER CONVERSATION]\n{summary_text}",
            token_count=_estimate_tokens(summary_text),
        )
        self._turns = [summary_turn] + keep
        return summary_text

    def clear(self) -> None:
        self._turns.clear()

    def last_n(self, n: int) -> list[ConversationTurn]:
        return self._turns[-n:]
