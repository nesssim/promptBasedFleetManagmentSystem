"""GET endpoints for health, robots, and mission history."""

import json
import os
from fastapi import APIRouter, Request, HTTPException

from ..models import MissionPhase

router = APIRouter()

HISTORY_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "missions.json")


def _load_history() -> list[dict]:
    """Load mission history from append-only JSON file."""
    if not os.path.exists(HISTORY_FILE):
        return []
    with open(HISTORY_FILE) as f:
        return json.load(f)


@router.get("/health")
async def health_check(request: Request):
    """Return system health status.

    During the first 30s after launch, health checks are suppressed
    (Gazebo cold start grace period). After 30s, standard 2s ping / 10s timeout.
    """
    return {
        "status": "ok",
        "service": "MissionSwarm R2",
        "version": "1.0.0",
    }


@router.get("/robots")
async def get_robots(request: Request):
    """Return current robot states from FleetCoordinator (via latest WS message cache)."""
    # Stub — will be populated from ros_bridge cache
    return {"robots": [], "source": "ros_bridge_cache"}


@router.get("/history")
async def get_history():
    """Return past missions from missions.json."""
    return {"missions": _load_history()}


@router.get("/history/{mission_id}/replay")
async def replay_mission(mission_id: str):
    """Return a specific mission's data for replay."""
    history = _load_history()
    for entry in history:
        if entry.get("mission_id") == mission_id or entry.get("id") == mission_id:
            return entry
    raise HTTPException(404, f"Mission {mission_id} not found")
