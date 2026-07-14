"""WebSocket /status endpoint for live fleet status streaming."""

import asyncio
import json
import time
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from ..models.robot import WSMessage, WSMessageType

router = APIRouter()

MAX_WS_CONNECTIONS = 10
_active_connections: set[WebSocket] = set()
_latest_fleet_state: dict = {}
_seq_counter: int = 0


def broadcast_message(msg: WSMessage) -> None:
    """Push a message to all connected WebSocket clients."""
    to_remove: list[WebSocket] = []
    for ws in _active_connections:
        try:
            asyncio.ensure_future(ws.send_text(msg.model_dump_json()))
        except Exception:
            to_remove.append(ws)
    for ws in to_remove:
        _active_connections.discard(ws)


def update_fleet_state(state: dict) -> None:
    """Update latest fleet state and broadcast to all clients."""
    global _latest_fleet_state
    _latest_fleet_state = state


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
    _active_connections.add(websocket)

    global _seq_counter
    seq = _seq_counter

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
                _seq_counter = seq
                await asyncio.sleep(0.5)
            except asyncio.CancelledError:
                break
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        _active_connections.discard(websocket)
