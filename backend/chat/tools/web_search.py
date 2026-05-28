"""Web Search tool — read-only, available in Chat mode.

Default provider: DuckDuckGo (free, no API key required).
Optional upgrade: Google Custom Search JSON API (set GOOGLE_API_KEY + GOOGLE_CSE_ID).
Legacy providers: Tavily, SerpAPI (set corresponding keys + WEB_SEARCH_PROVIDER env var).
"""
from __future__ import annotations

import json
from typing import Any

from core.permissions.gate import Permission
from core.tools.base import BaseTool, ToolResult
from core.permissions.gate import require_permission
from config.settings import settings


class WebSearchTool(BaseTool):
    name = "web_search"
    description = (
        "Search the web for current information, news, or anything the model "
        "doesn't know. Returns a list of relevant results with titles, URLs, "
        "and short summaries."
    )
    permission = Permission.READ

    @require_permission(Permission.READ)
    async def run(self, query: str, max_results: int | None = None) -> ToolResult:  # type: ignore[override]
        k = int(max_results) if max_results is not None else settings.web_search_max_results
        provider = settings.web_search_provider

        try:
            if provider == "duckduckgo":
                results = await self._duckduckgo(query, k)
            elif provider == "google":
                results = await self._google(query, k)
            elif provider == "tavily":
                results = await self._tavily(query, k)
            else:
                results = await self._serpapi(query, k)

            if not results:
                return ToolResult(
                    tool_name=self.name, success=True,
                    output="No results found for this query.",
                )

            output = "\n\n".join(
                f"**{r['title']}** — {r['url']}\n{r['snippet']}"
                for r in results
            )
            return ToolResult(tool_name=self.name, success=True, output=output)

        except Exception as e:
            return ToolResult(tool_name=self.name, success=False, output=None, error=str(e))

    # ------------------------------------------------------------------ #
    #  Providers                                                           #
    # ------------------------------------------------------------------ #

    async def _duckduckgo(self, query: str, k: int) -> list[dict]:
        """Free search via DuckDuckGo — no API key required."""
        try:
            from ddgs import DDGS  # new package name (ddgs >= 9.x)
        except ImportError:
            from duckduckgo_search import DDGS  # legacy name fallback
        import asyncio

        def _sync_search() -> list[dict]:
            with DDGS() as ddgs:
                return list(ddgs.text(query, max_results=k))

        # duckduckgo_search is synchronous; run it in a thread pool
        loop = asyncio.get_event_loop()
        raw = await loop.run_in_executor(None, _sync_search)
        return [
            {
                "title": r.get("title", ""),
                "url": r.get("href", ""),
                "snippet": r.get("body", ""),
            }
            for r in raw
        ]

    async def _google(self, query: str, k: int) -> list[dict]:
        """Google Custom Search JSON API — requires GOOGLE_API_KEY + GOOGLE_CSE_ID."""
        import httpx
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://www.googleapis.com/customsearch/v1",
                params={
                    "key": settings.google_api_key,
                    "cx": settings.google_cse_id,
                    "q": query,
                    "num": min(k, 10),
                },
            )
            resp.raise_for_status()
            data = resp.json()
        return [
            {
                "title": item.get("title", ""),
                "url": item.get("link", ""),
                "snippet": item.get("snippet", ""),
            }
            for item in data.get("items", [])[:k]
        ]

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

    # ------------------------------------------------------------------ #
    #  Schema                                                              #
    # ------------------------------------------------------------------ #

    def schema(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search query to look up on the web.",
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "Maximum number of results to return (default 5).",
                        "default": 5,
                    },
                },
                "required": ["query"],
            },
        }
