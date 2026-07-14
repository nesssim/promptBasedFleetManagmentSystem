"""Pydantic models for the DAG JSON schema — canonical interface.

This schema is shared by:
- LLM Phase 2 output (DAG Builder)
- dag_validator.py validation
- ros2 param set delivery
- FleetCoordinator execution

All components must conform to this exact shape.
"""

from pydantic import BaseModel, Field
from typing import Optional


class RobotSpec(BaseModel):
    """A robot in the fleet."""

    id: str = Field(..., description="Unique robot identifier (e.g. 'robot_1')")
    type: str = Field(default="burger", description="Robot model type")
    home: str = Field(..., description="Home location name, must exist in locations map")


class TaskSpec(BaseModel):
    """A single task in the mission DAG."""

    id: str = Field(..., description="Unique task ID within the mission")
    type: str = Field(
        ...,
        description="Task type",
        pattern="^(navigate|charge|weigh|dock|undock)$",
    )
    location: str = Field(..., description="Target location name, must exist in locations map")
    depends_on: list[str] = Field(
        default_factory=list,
        description="Task IDs that must complete before this one starts",
    )
    duration_s: Optional[int] = Field(default=30, description="Estimated duration in seconds")
    assigned_to: str = Field(..., description="Robot ID assigned to this task")
    action_type: Optional[str] = Field(
        default=None,
        description="Semantic action (e.g. 'transport', 'load', 'unload', 'scan')",
    )


class Location(BaseModel):
    """A named yard location with world-frame coordinates."""

    x: float = Field(..., description="World-frame X coordinate")
    y: float = Field(..., description="World-frame Y coordinate")


class DAGSpec(BaseModel):
    """Canonical DAG schema — the single interface contract."""

    mission_id: str = Field(..., description="UUID v4 mission identifier")
    robot_count: int = Field(..., ge=1, le=6, description="Number of robots in the fleet")
    robots: list[RobotSpec] = Field(
        ..., min_length=1, max_length=6, description="Robot fleet"
    )
    tasks: list[TaskSpec] = Field(..., min_length=1, description="Mission task DAG")
    locations: dict[str, Location] = Field(
        ..., description="Map of location name to world-frame coordinates"
    )
    metadata: dict = Field(
        default_factory=dict,
        description="Optional metadata (estimated duration, generator info, plan summary)",
    )
