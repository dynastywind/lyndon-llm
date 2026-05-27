"""
FastAPI application entry point.
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import chat, cowork, code
from api.ws.stream import router as ws_router
from config.settings import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    _register_all_tools()
    yield
    # Shutdown — nothing to clean up yet


def _register_all_tools() -> None:
    from core.tools.registry import tool_registry
    from core.permissions.gate import Mode

    # Chat tools (read-only)
    from chat.tools.web_search import WebSearchTool
    from chat.tools.rag_query import RAGQueryTool
    tool_registry.register(Mode.CHAT, WebSearchTool)
    tool_registry.register(Mode.CHAT, RAGQueryTool)

    # Cowork tools (read + write + exec)
    from cowork.tools.shell import ShellTool
    from cowork.tools.file_io import FileReadTool, FileWriteTool
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

app.include_router(chat.router,   prefix="/api/chat",   tags=["chat"])
app.include_router(cowork.router, prefix="/api/cowork", tags=["cowork"])
app.include_router(code.router,   prefix="/api/code",   tags=["code"])
app.include_router(ws_router,     prefix="/ws",         tags=["websocket"])


@app.get("/health")
async def health():
    return {"status": "ok", "app": settings.app_name}
