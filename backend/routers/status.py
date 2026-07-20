"""WebSocket /status endpoint for live fleet status streaming."""

import asyncio
import json
import time
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from ..models.robot import WSMessage, WSMessageType
from ..models import MissionPhase
from ..session import session_store
from .. import persistence

router = APIRouter()

MAX_WS_CONNECTIONS = 10
_active_connections: set[WebSocket] = set()
_latest_fleet_state: dict = {}
_connections_lock = asyncio.Lock()


async def broadcast_message(msg: WSMessage) -> None:
    """Push a message to all connected WebSocket clients."""
    to_remove: list[WebSocket] = []
    snapshot = list(_active_connections)
    for ws in snapshot:
        try:
            await ws.send_text(msg.model_dump_json())
        except Exception:
            to_remove.append(ws)
    if to_remove:
        async with _connections_lock:
            for ws in to_remove:
                _active_connections.discard(ws)


def update_fleet_state(state: dict) -> None:
    """Update latest fleet state and broadcast to all clients."""
    global _latest_fleet_state
    _latest_fleet_state = state
    _check_completion(state)


def _check_completion(state: dict) -> None:
    """Auto-transition to COMPLETE when fleet reports all tasks done."""
    tasks_completed = state.get("tasks_completed", 0)
    tasks_total = state.get("tasks_total", 0)
    session_id = state.get("session_id", "")
    if tasks_total > 0 and tasks_completed >= tasks_total and session_id:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.ensure_future(_do_complete(session_id))


async def _do_complete(session_id: str) -> None:
    """Perform the COMPLETE transition asynchronously."""
    if await session_store.transition(
        session_id,
        from_phases=[MissionPhase.RUNNING],
        to=MissionPhase.COMPLETE,
    ):
        meta = persistence.load_session_meta(session_id)
        mock_mode = meta.get("mock", False) if meta else False
        await persistence.save_session_meta(session_id, MissionPhase.COMPLETE.value, 0, mock_mode)
        await persistence.append_decision(session_id, "Fleet reported all tasks completed")


@router.websocket("/status")
async def fleet_status_ws(websocket: WebSocket):
    origin = websocket.headers.get("origin", "")
    if origin and "localhost" not in origin and "127.0.0.1" not in origin:
        await websocket.close(code=1008)
        return

    if len(_active_connections) >= MAX_WS_CONNECTIONS:
        await websocket.close(code=1013, reason="Too many connections")
        return

    await websocket.accept()
    async with _connections_lock:
        _active_connections.add(websocket)

    seq = 0

    async def _reader():
        nonlocal seq
        try:
            while True:
                data = await websocket.receive_text()
                msg = json.loads(data)
                if msg.get("type") == "sync":
                    if _latest_fleet_state:
                        seq += 1
                        snapshot = WSMessage(
                            type=WSMessageType.FLEET_STATUS,
                            seq=seq,
                            timestamp=time.time(),
                            payload=_latest_fleet_state.copy(),
                        )
                        await websocket.send_text(snapshot.model_dump_json())
        except Exception:
            pass

    try:
        reader_task = asyncio.create_task(_reader())
        while True:
            try:
                if _latest_fleet_state:
                    seq += 1
                    msg = WSMessage(
                        type=WSMessageType.FLEET_STATUS,
                        seq=seq,
                        timestamp=time.time(),
                        payload=_latest_fleet_state.copy(),
                    )
                    await websocket.send_text(msg.model_dump_json())
                else:
                    seq += 1
                    msg = WSMessage(
                        type=WSMessageType.HEARTBEAT,
                        seq=seq,
                        timestamp=time.time(),
                        payload={},
                    )
                    await websocket.send_text(msg.model_dump_json())
                await asyncio.sleep(0.5)
            except asyncio.CancelledError:
                break
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        async with _connections_lock:
            _active_connections.discard(websocket)
