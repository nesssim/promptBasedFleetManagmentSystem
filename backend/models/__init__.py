"""Shared Pydantic models, enums, and dataclasses."""

from enum import Enum
from dataclasses import dataclass, field
from typing import Optional


class MissionPhase(str, Enum):
    """Backend-owned state machine — single source of truth for mission phase."""

    IDLE = "idle"
    PLANNING = "planning"
    PLAN_READY = "plan_ready"
    GENERATING = "generating"
    DAG_READY = "dag_ready"
    LAUNCHING = "launching"
    RUNNING = "running"
    COMPLETE = "complete"
    ERROR = "error"


@dataclass
class SessionState:
    """In-memory session — lost on backend restart (documented limitation).

    Keyed by UUID session token. Backend is single source of truth;
    browser reflects state via WebSocket phase_change messages.
    """

    phase: MissionPhase = MissionPhase.IDLE
    robot_count: int = 3
    conversation_history: list = field(default_factory=list)
    current_plan: Optional[dict] = None
    current_dag: Optional[dict] = None
    mission_id: Optional[str] = None
    correction_count: int = 0

    def reset(self) -> None:
        """Return session to IDLE with defaults."""
        self.phase = MissionPhase.IDLE
        self.robot_count = 3
        self.conversation_history.clear()
        self.current_plan = None
        self.current_dag = None
        self.mission_id = None
        self.correction_count = 0
