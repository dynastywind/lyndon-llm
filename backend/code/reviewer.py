"""Code Reviewer — analyses diffs and produces structured review comments."""
from __future__ import annotations

from dataclasses import dataclass

from core.llm.gateway import llm_gateway, LLMMessage


@dataclass
class ReviewComment:
    file_path: str
    line: int | None
    severity: str      # "info" | "warning" | "error"
    message: str


@dataclass
class ReviewResult:
    summary: str
    comments: list[ReviewComment]
    approved: bool


REVIEW_SYSTEM = """\
You are an expert code reviewer. Analyse the provided diff and give a concise review.

Respond in this JSON format only:
{
  "summary": "<1-3 sentence overall assessment>",
  "approved": true/false,
  "comments": [
    {
      "file_path": "<file>",
      "line": <line number or null>,
      "severity": "info|warning|error",
      "message": "<comment>"
    }
  ]
}

Focus on: correctness, security, performance, maintainability. Be specific and actionable.
"""


class CodeReviewer:
    async def review(self, diff_text: str, context: str = "") -> ReviewResult:
        import json

        messages = [
            LLMMessage("system", REVIEW_SYSTEM),
            LLMMessage(
                "user",
                f"Review this diff:\n\n```diff\n{diff_text}\n```"
                + (f"\n\nAdditional context:\n{context}" if context else ""),
            ),
        ]

        response = await llm_gateway.complete(messages=messages, temperature=0.1)
        cleaned = response.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()

        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError:
            return ReviewResult(
                summary=response,
                comments=[],
                approved=False,
            )

        comments = [
            ReviewComment(
                file_path=c.get("file_path", ""),
                line=c.get("line"),
                severity=c.get("severity", "info"),
                message=c.get("message", ""),
            )
            for c in data.get("comments", [])
        ]
        return ReviewResult(
            summary=data.get("summary", ""),
            comments=comments,
            approved=data.get("approved", False),
        )
