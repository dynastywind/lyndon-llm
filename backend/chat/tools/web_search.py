"""Web Search tool — read-only, available in Chat mode."""
from __future__ import annotations

from typing import Any

from core.permissions.gate import Permission
from core.tools.base import BaseTool, ToolResult
from core.permissions.gate import require_permission
from config.settings import settings


class WebSearchTool(BaseTool):
    name = "web_search"
    description = "Search the web for up-to-date information on a query."
    permission = Permission.READ

    @require_permission(Permission.READ)
    async def run(self, query: str, max_results: int | None = None) -> ToolResult:
        k = max_results or settings.web_search_max_results
        provider = settings.web_search_provider

        try:
            if provider == "tavily":
                results = await self._tavily(query, k)
            else:
                results = await self._serpapi(query, k)

            output = "\n\n".join(
                f"**{r['title']}** ({r['url']})\n{r['snippet']}"
                for r in results
            )
            return ToolResult(tool_name=self.name, success=True, output=output)
        except Exception as e:
            return ToolResult(tool_name=self.name, success=False, output=None, error=str(e))

    async def _tavily(self, query: str, k: int) -> list[dict]:
        import httpx
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": settings.tavily_api_key,
                    "query": query,
                    "max_results": k,
                    "search_depth": "basic",
                },
            )
            resp.raise_for_status()
            data = resp.json()
        return [
            {"title": r.get("title", ""), "url": r.get("url", ""), "snippet": r.get("content", "")}
            for r in data.get("results", [])
        ]

    async def _serpapi(self, query: str, k: int) -> list[dict]:
        import httpx
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://serpapi.com/search",
                params={"q": query, "api_key": settings.serpapi_api_key, "num": k},
            )
            resp.raise_for_status()
            data = resp.json()
        return [
            {"title": r.get("title", ""), "url": r.get("link", ""), "snippet": r.get("snippet", "")}
            for r in data.get("organic_results", [])[:k]
        ]

    def schema(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query."},
                    "max_results": {"type": "integer", "description": "Max results to return.", "default": 5},
                },
                "required": ["query"],
            },
        }
