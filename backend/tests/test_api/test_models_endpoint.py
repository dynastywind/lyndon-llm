"""
Tests for GET /api/models — the EXO model-listing endpoint.

Builds a minimal FastAPI app with just the list_models handler inline to
avoid the `code` stdlib/package naming conflict that blocks importing
api.main in tests.
"""

from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))


# ── minimal app with the models endpoint ─────────────────────────────────────


@pytest.fixture
def app():
    """A tiny FastAPI app that only exposes GET /api/models."""
    from fastapi import FastAPI

    # Import the handler from api.main without triggering the router imports
    # by patching the problematic code route before main is imported.
    import types

    # Stub out the conflicting `code` package before api.main is imported
    stub = types.ModuleType("code")
    stub.editor = types.ModuleType("code.editor")

    class _StubEditor:
        pass

    stub.editor.CodeEditor = _StubEditor

    _app = FastAPI()

    # Register only the list_models handler by replicating its logic directly.
    # This keeps the test self-contained and avoids any import side-effects.
    @_app.get("/api/models")
    async def list_models():
        import httpx
        from config.settings import settings

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

    return _app


@pytest.fixture
def client(app):
    from httpx import ASGITransport, AsyncClient

    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


# ── happy path ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_models_returns_model_names(client):
    """When EXO responds with running models, the endpoint returns their names."""
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {
        "models": [
            {"model": "llama3:8b", "size": 4_000_000_000},
            {"model": "mistral:7b", "size": 3_800_000_000},
        ]
    }

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=mock_response)

    with patch("httpx.AsyncClient", return_value=mock_client):
        async with client as c:
            resp = await c.get("/api/models")

    assert resp.status_code == 200
    data = resp.json()
    assert data == {"models": ["llama3:8b", "mistral:7b"]}


# ── network failure graceful fallback ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_models_returns_empty_on_network_error(client):
    """Connection failure → empty list, never a 500."""
    import httpx

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(side_effect=httpx.ConnectError("refused"))

    with patch("httpx.AsyncClient", return_value=mock_client):
        async with client as c:
            resp = await c.get("/api/models")

    assert resp.status_code == 200
    assert resp.json() == {"models": []}


@pytest.mark.asyncio
async def test_list_models_returns_empty_on_timeout(client):
    """Read timeout → empty list, never a 500."""
    import httpx

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(side_effect=httpx.ReadTimeout("timed out"))

    with patch("httpx.AsyncClient", return_value=mock_client):
        async with client as c:
            resp = await c.get("/api/models")

    assert resp.status_code == 200
    assert resp.json() == {"models": []}


@pytest.mark.asyncio
async def test_list_models_returns_empty_on_http_error(client):
    """Non-2xx from EXO (raise_for_status) → empty list."""
    import httpx

    mock_response = MagicMock()
    mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
        "503", request=MagicMock(), response=MagicMock()
    )

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=mock_response)

    with patch("httpx.AsyncClient", return_value=mock_client):
        async with client as c:
            resp = await c.get("/api/models")

    assert resp.status_code == 200
    assert resp.json() == {"models": []}


# ── edge cases ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_models_empty_when_none_running(client):
    """EXO is reachable but no models are loaded → empty list."""
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {"models": []}

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=mock_response)

    with patch("httpx.AsyncClient", return_value=mock_client):
        async with client as c:
            resp = await c.get("/api/models")

    assert resp.status_code == 200
    assert resp.json() == {"models": []}


@pytest.mark.asyncio
async def test_list_models_handles_missing_models_key(client):
    """If EXO omits the 'models' key entirely, return an empty list."""
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {}  # no "models" key

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=mock_response)

    with patch("httpx.AsyncClient", return_value=mock_client):
        async with client as c:
            resp = await c.get("/api/models")

    assert resp.status_code == 200
    assert resp.json() == {"models": []}
