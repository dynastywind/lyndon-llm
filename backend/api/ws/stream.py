"""WebSocket endpoint — streams all agent events to the frontend."""

from __future__ import annotations

from contextlib import suppress
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from core.events.bus import Events, event_bus

router = APIRouter()


@router.websocket("/{session_id}")
async def websocket_stream(websocket: WebSocket, session_id: str):
    await websocket.accept()

    async def forward(payload: dict):
        with suppress(Exception):
            await websocket.send_text(json.dumps(payload))

    # Subscribe to all events for this session
    event_names = [
        Events.CHAT_RESPONSE_CHUNK,
        Events.CHAT_RESPONSE_DONE,
        Events.PLAN_CREATED,
        Events.PLAN_APPROVED,
        Events.STEP_STARTED,
        Events.STEP_DONE,
        Events.STEP_FAILED,
        Events.TASK_DONE,
        Events.DIFF_READY,
        Events.TESTS_PASSED,
        Events.TESTS_FAILED,
        Events.COMMIT_DONE,
    ]

    async def session_handler(payload: dict):
        if payload.get("session_id") == session_id:
            await forward({"event": "event", "data": payload})

    for event in event_names:
        event_bus.on(event, session_handler)

    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            # Handle ping
            if msg.get("type") == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        pass
    finally:
        for event in event_names:
            event_bus.off(event, session_handler)
