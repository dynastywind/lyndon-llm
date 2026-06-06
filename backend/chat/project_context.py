"""
Shared project-context builder.

When a chat session belongs to a project, this assembles the project's shared
brief and context into a single system-prompt block that is injected into every
LLM path — normal chat turns, the chat planner, chat-plan synthesis, and the
cowork/code planner — so the project's instructions and files always apply.

Returns an empty string when the session has no project (or anything fails), so
callers can append it unconditionally.
"""

from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from chat.rag.retriever import HybridRetriever
from db.repos.chat import ChatRepo
from db.repos.project import ProjectRepo

logger = logging.getLogger(__name__)


async def build_project_block(
    db: AsyncSession | None,
    session_id: str,
    query: str,
    user_id: str | None = None,
) -> str:
    """Build the project context block for *session_id*, or "" if none applies."""
    if db is None or not session_id:
        return ""
    try:
        session = await ChatRepo(db).get_session(session_id)
        if session is None or not session.project_id:
            return ""
        project = await ProjectRepo(db).get(session.project_id)
        if project is None:
            return ""

        parts: list[str] = []
        if project.instructions:
            parts.append(f"## Project instructions\n\n{project.instructions}")

        folders = ProjectRepo.folders(project)
        if folders:
            lines = "\n".join(
                f"- {f.get('name') or f.get('path')} — {f.get('path')}" for f in folders
            )
            parts.append(
                "## Project working folders\n\n"
                "This project is scoped to the following local folders:\n" + lines
            )

        # Project-scoped RAG over the project's uploaded files.
        try:
            chunks = await HybridRetriever().retrieve(
                query, user_id=user_id, project_id=project.id
            )
            from chat.engine import MAX_CONTEXT_CHARS, _format_context

            kept, total = [], 0
            for c in chunks:
                if total + len(c.content) > MAX_CONTEXT_CHARS:
                    break
                kept.append(c)
                total += len(c.content)
            ctx = _format_context(kept)
            if ctx:
                parts.append(ctx)
        except Exception:  # noqa: BLE001 — RAG is best-effort; never break the turn
            logger.exception("project RAG retrieval failed for project %s", project.id)

        return "\n\n".join(parts)
    except Exception:  # noqa: BLE001 — context is best-effort; never break the turn
        logger.exception("build_project_block failed for session %s", session_id)
        return ""
