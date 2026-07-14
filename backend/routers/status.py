"""WebSocket /status endpoint for live fleet status streaming.

Uses framed messages with seq numbers for missed-message detection.
Messages are produced by the ROS 2 bridge background thread and
forwarded to all connected WebSocket clients.
"""

import json
import time
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.models.robot import WSMessage, WSMessageType

router = APIRouter()

# In-memory message ring buffer (5min) for reconnect state sync
RING_BUFFER_SIZE = 600  # 600 messages at 0.5s cadence = 5min
_message_ring: list[WSMessage] = []


def broadcast_message(msg: WSMessage) -> None:
    """Called by ros_bridge when a new /fleet_status message arrives.

    Stores in ring buffer and pushes to all connected clients.
    """
    _message_ring.append(msg)
    if len(_message_ring) > RING_BUFFER_SIZE:
        _message_ring.pop(0)
    # Push to all connected clients
    for ws in _active_connections:
        try:
            # Use asyncio.ensure_future or similar — actual delivery
            # is handled by the ros_bridge → asyncio.Queue → WS path
            pass
        except Exception:
            _active_connections.discard(ws)


_active_connections: set[WebSocket] = set()


@router.websocket("/status")
async def fleet_status_ws(websocket: WebSocket):
    """Stream fleet status to browser via WebSocket.

    Message framing:
    {
      "type": "fleet_status" | "spawn_progress" | "phase_change" | "error" | "heartbeat",
      "seq": int,
      "timestamp": float,
      "payload": {...}
    }

    On reconnect, client sends last_seq. Backend sends full state snapshot.
    """
    await websocket.accept()
    _active_connections.add(websocket)

    seq = 0
    try:
        while True:
            # In Phase 3, this reads from ros_bridge.async_queue
            # For now, send heartbeats every 5s
            try:
                data = await asyncio.wait_for(
                    _get_next_message(),
                    timeout=5.0,
                )
                seq += 1
                msg = WSMessage(
                    type=WSMessageType.FLEET_STATUS,
                    seq=seq,
                    timestamp=time.time(),
                    payload=data,
                )
                await websocket.send_text(msg.model_dump_json())
            except asyncio.TimeoutError:
                # Heartbeat fallback
                seq += 1
                msg = WSMessage(
                    type=WSMessageType.HEARTBEAT,
                    seq=seq,
                    timestamp=time.time(),
                    payload={},
                )
                await websocket.send_text(msg.model_dump_json())

    except WebSocketDisconnect:
        _active_connections.discard(websocket)


# Placeholder for ros_bridge async queue (Phase 3)
import asyncio

_ws_queue: asyncio.Queue = asyncio.Queue()


async def _get_next_message() -> dict:
    """Read next message from ROS 2 bridge queue or heartbeat."""
    return await _ws_queue.get()
