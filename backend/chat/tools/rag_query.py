"""RAG Query tool — searches the local knowledge base."""
from __future__ import annotations

from typing import Any

from core.permissions.gate import Permission
from core.tools.base import BaseTool, ToolResult
from core.permissions.gate import require_permission


class RAGQueryTool(BaseTool):
    name = "rag_query"
    description = (
        "Search the local knowledge base (ingested PDFs, docs, code files) "
        "for relevant information."
    )
    permission = Permission.READ

    @require_permission(Permission.READ)
    async def run(self, query: str, top_k: int = 5) -> ToolResult:
        try:
            from chat.rag.retriever import retriever
            chunks = await retriever.retrieve(query, top_k=top_k)

            if not chunks:
                return ToolResult(
                    tool_name=self.name,
                    success=True,
                    output="No relevant documents found in the knowledge base.",
                )

            output = "\n\n---\n\n".join(
                f"**Source:** {c.source}\n\n{c.content}"
                for c in chunks
            )
            return ToolResult(tool_name=self.name, success=True, output=output)
        except Exception as e:
            return ToolResult(tool_name=self.name, success=False, output=None, error=str(e))

    def schema(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "What to search for."},
                    "top_k": {"type": "integer", "description": "Number of chunks to retrieve.", "default": 5},
                },
                "required": ["query"],
            },
        }
