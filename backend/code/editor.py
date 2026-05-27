"""
Code Editor — LLM-driven file editing with diff generation.
"""
from __future__ import annotations

import difflib
from pathlib import Path

from code.repo import RepoManager, RepoDiff
from core.llm.gateway import llm_gateway, LLMMessage


EDIT_SYSTEM = """\
You are an expert software engineer. When asked to modify code, respond with ONLY
the complete new file content — no explanations, no markdown fences, no commentary.
Output the exact text that should replace the current file.
"""


class CodeEditor:
    def __init__(self, repo: RepoManager) -> None:
        self.repo = repo

    async def edit_file(
        self,
        relative_path: str,
        instruction: str,
        context_files: list[str] | None = None,
    ) -> RepoDiff:
        """
        Ask the LLM to modify a file according to `instruction`.
        Returns a RepoDiff showing what changed.
        """
        original = self.repo.file_content(relative_path)

        # Build context
        context_block = ""
        if context_files:
            parts = []
            for cf in context_files:
                try:
                    parts.append(f"=== {cf} ===\n{self.repo.file_content(cf)}")
                except Exception:
                    pass
            context_block = "\nRelated files for context:\n" + "\n\n".join(parts)

        messages = [
            LLMMessage("system", EDIT_SYSTEM),
            LLMMessage(
                "user",
                f"File: {relative_path}\n\n"
                f"Current content:\n```\n{original}\n```\n"
                f"{context_block}\n\n"
                f"Instruction: {instruction}",
            ),
        ]

        new_content = await llm_gateway.complete(messages=messages, temperature=0.1)

        # Write to disk
        self.repo.write_file(relative_path, new_content)

        # Generate unified diff
        diff_lines = list(difflib.unified_diff(
            original.splitlines(keepends=True),
            new_content.splitlines(keepends=True),
            fromfile=f"a/{relative_path}",
            tofile=f"b/{relative_path}",
        ))
        diff_text = "".join(diff_lines)

        return RepoDiff(
            file_path=relative_path,
            diff_text=diff_text,
            is_new=False,
        )

    async def create_file(self, relative_path: str, instruction: str) -> RepoDiff:
        """Create a new file from an instruction."""
        messages = [
            LLMMessage("system", EDIT_SYSTEM),
            LLMMessage(
                "user",
                f"Create a new file at: {relative_path}\n\nInstruction: {instruction}",
            ),
        ]
        content = await llm_gateway.complete(messages=messages, temperature=0.1)
        self.repo.write_file(relative_path, content)
        return RepoDiff(file_path=relative_path, diff_text=content, is_new=True)
