"""Web Search tool — read-only, available in Chat mode.

Default provider: DuckDuckGo (free, no API key required).
Optional upgrade: Google Custom Search JSON API (set GOOGLE_API_KEY + GOOGLE_CSE_ID).
Legacy providers: Tavily, SerpAPI (set corresponding keys + WEB_SEARCH_PROVIDER env var).
"""

from __future__ import annotations

import re
from typing import Any

from config.settings import settings
from core.permissions.gate import Permission, require_permission
from core.tools.base import BaseTool, ToolResult

# query 文字 → ddgs region。先判各语言独有字符，最后回落英文。
_JA_KANA_RE = re.compile(r"[぀-ヿ]")  # 平假名/片假名（日文独有）
_KO_RE = re.compile(r"[가-힯]")  # 谚文（韩文独有）
_CYRILLIC_RE = re.compile(r"[Ѐ-ӿ]")  # 西里尔
_CJK_RE = re.compile(r"[一-鿿]")  # 中日韩统一表意文字（汉字）


def _region_for(query: str) -> str:
    """Pick a ddgs region from the query's script so CJK queries don't fall
    into the default us-en index."""
    if _JA_KANA_RE.search(query):
        return "jp-jp"
    if _KO_RE.search(query):
        return "kr-kr"
    if _CYRILLIC_RE.search(query):
        return "ru-ru"
    if _CJK_RE.search(query):  # 含假名/谚文已先返回，剩下的汉字判为中文
        return "cn-zh"
    return "us-en"


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
                    tool_name=self.name,
                    success=True,
                    output="No results found for this query.",
                )

            output = "\n\n".join(f"**{r['title']}** — {r['url']}\n{r['snippet']}" for r in results)
            return ToolResult(tool_name=self.name, success=True, output=output)

        except Exception as e:
            return ToolResult(tool_name=self.name, success=False, output=None, error=str(e))

    # ------------------------------------------------------------------ #
    #  Providers                                                           #
    # ------------------------------------------------------------------ #

    async def _duckduckgo(self, query: str, k: int) -> list[dict]:
        """Free search via DuckDuckGo — no API key required.

        region 按 query 文字自动判定，避免 CJK 查询落进默认 us-en 区。
        先用高质量引擎组合，返回空或报错时回落到 ddgs 'auto' 聚合重试一次。
        """
        try:
            from ddgs import DDGS  # new package name (ddgs >= 9.x)
        except ImportError:
            from duckduckgo_search import DDGS  # legacy name fallback
        import asyncio

        region = _region_for(query)

        def _sync_search() -> list[dict]:
            with DDGS() as ddgs:
                # 第 1 次：高相关、低空率的三引擎组合；第 2 次：auto 全聚合兜底
                for backend in ("duckduckgo, bing, brave", "auto"):
                    try:
                        raw = ddgs.text(
                            query,
                            region=region,
                            safesearch="moderate",
                            backend=backend,
                            max_results=k,
                        )
                    except Exception:
                        continue  # 该 backend 无结果会抛 DDGSException，换下一档
                    if raw:
                        return list(raw)
                return []

        # duckduckgo_search is synchronous; run it in a thread pool.
        # Wrap in wait_for so a rate-limit stall doesn't hang the request;
        # timeout 放宽到 20s 给两档重试留余量。
        loop = asyncio.get_event_loop()
        raw = await asyncio.wait_for(
            loop.run_in_executor(None, _sync_search),
            timeout=20,
        )
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
