"""Models for WebSocket framing."""

from pydantic import BaseModel, Field
from enum import Enum


class WSMessageType(str, Enum):
    """WebSocket message types for the framed protocol."""

    FLEET_STATUS = "fleet_status"
    SPAWN_PROGRESS = "spawn_progress"
    PHASE_CHANGE = "phase_change"
    ERROR = "error"
    HEARTBEAT = "heartbeat"


class WSMessage(BaseModel):
    """Framed WebSocket message with seq for missed-message detection."""

    type: WSMessageType
    seq: int
    timestamp: float
    payload: dict = Field(default_factory=dict)
