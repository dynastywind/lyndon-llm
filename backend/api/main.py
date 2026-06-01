"""
FastAPI application entry point.
"""

from __future__ import annotations

from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import auth, chat, code, cowork, rag, registry, sandbox
from api.ws.stream import router as ws_router
from config.settings import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup — create DB tables then register tools
    await _init_db()
    _register_all_tools()
    from core.mcp.manager import mcp_tool_manager

    await mcp_tool_manager.reload_all()
    yield
    # Shutdown — nothing to clean up yet


async def _init_db() -> None:
    """Create all tables if they don't exist yet, then apply incremental migrations."""
    from db.base import Base, engine
    import db.models  # noqa: F401 — side-effect: registers all models with Base.metadata

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _migrate(conn)


async def _migrate(conn) -> None:
    """
    Lightweight forward-only migrations for columns added after initial release.
    Each ALTER TABLE is wrapped in a try/except so running it twice is harmless.
    """
    from sqlalchemy import text

    migrations = [
        # v2 — persist file/image attachments with each user message
        "ALTER TABLE chat_messages ADD COLUMN attachments_json TEXT",
        # v3 — per-user scoping for MCP servers and chat sessions
        "ALTER TABLE mcp_servers ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE",
        "ALTER TABLE chat_sessions ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE SET NULL",
    ]
    for stmt in migrations:
        with suppress(Exception):  # column already exists — safe to ignore
            await conn.execute(text(stmt))


def _register_all_tools() -> None:
    from chat.tools.chart import RenderChartTool
    from chat.tools.rag_query import RAGQueryTool
    from chat.tools.run_code import RunCodeTool

    # Chat tools (read-only)
    from chat.tools.web_search import WebSearchTool
    from core.permissions.gate import Mode
    from core.tools.registry import tool_registry

    tool_registry.register(Mode.CHAT, WebSearchTool)
    tool_registry.register(Mode.CHAT, RAGQueryTool)
    tool_registry.register(Mode.CHAT, RenderChartTool)
    tool_registry.register(Mode.CHAT, RunCodeTool)

    # Cowork tools (read + write + exec)
    from cowork.tools.file_io import FileReadTool, FileWriteTool
    from cowork.tools.shell import ShellTool

    tool_registry.register(Mode.COWORK, ShellTool)
    tool_registry.register(Mode.COWORK, FileReadTool)
    tool_registry.register(Mode.COWORK, FileWriteTool)
    tool_registry.register(Mode.COWORK, RAGQueryTool)
    tool_registry.register(Mode.COWORK, WebSearchTool)

    # Code tools (same as cowork + git-aware)
    tool_registry.register(Mode.CODE, ShellTool)
    tool_registry.register(Mode.CODE, FileReadTool)
    tool_registry.register(Mode.CODE, FileWriteTool)


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(cowork.router, prefix="/api/cowork", tags=["cowork"])
app.include_router(code.router, prefix="/api/code", tags=["code"])
app.include_router(rag.router, prefix="/api/rag", tags=["rag"])
app.include_router(registry.router, prefix="/api/registry", tags=["registry"])
app.include_router(sandbox.router, prefix="/api/sandbox", tags=["sandbox"])
app.include_router(ws_router, prefix="/ws", tags=["websocket"])


@app.get("/health")
async def health():
    return {"status": "ok", "app": settings.app_name}


@app.get("/api/models")
async def list_models():
    """
    Return models currently loaded in EXO via GET /ollama/api/ps.

    This endpoint (mirroring `ollama ps`) lists only models that are
    actively running in memory — no inference probe needed.
    """
    import httpx

    base_url = settings.llm_base_url.rstrip("/").removesuffix("/v1")
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{base_url}/ollama/api/ps")
            resp.raise_for_status()
            data = resp.json()
            models = [m["model"] for m in data.get("models", [])]
    except Exception:
        models = []
    return {"models": models}
