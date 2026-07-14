"""Models for live robot state, fleet status, and WebSocket framing."""

from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


class RobotStatus(str, Enum):
    """Possible states for a single robot."""

    IDLE = "idle"
    NAVIGATING = "navigating"
    WORKING = "working"  # doing an action (load/unload/scan)
    CHARGING = "charging"
    ERROR = "error"


class RobotState(BaseModel):
    """Current state of a single robot, published in fleet_status messages."""

    id: str
    status: RobotStatus = RobotStatus.IDLE
    battery: float = Field(default=100.0, ge=0.0, le=100.0)
    x: float = 0.0
    y: float = 0.0
    current_task: str = ""
    completed_tasks: int = 0
    total_tasks: int = 0


class FleetStatus(BaseModel):
    """Aggregate fleet state published on /fleet_status and streamed via WS."""

    robots: list[RobotState] = []
    tasks_completed: int = 0
    tasks_total: int = 0
    mission_phase: str = "idle"
    mission_time_s: float = 0.0


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
