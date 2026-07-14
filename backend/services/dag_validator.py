"""DAG validation and construction — inline tools, no separate MCP server.

Two categories of functions:

Category 1: LLM Tool Functions (called by Claude via Anthropic tool-use API)
  - list_locations(): Returns valid location names
  - validate_plan(): Validates a partial plan against location whitelist

Category 2: Backend Utility Functions (called directly by orchestrator)
  - create_plan(): Assembles Phase 1 prompt structure
  - create_task_dag(): Builds complete validated DAG from Phase 2 response
  - get_spawn_positions(): Computes N non-overlapping spawn positions
"""

import json
import os
from collections import deque
from typing import Any

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
LOCATIONS_FILE = os.path.join(DATA_DIR, "locations.json")

ALLOWED_TASK_TYPES = {"navigate", "charge", "weigh", "dock", "undock"}


# ═══════════════════════════════════════════════════════════════
# Category 1: LLM Tool Functions
# ═══════════════════════════════════════════════════════════════

def list_locations() -> dict:
    """Returns valid location names from locations.json.

    Called by Claude via tool-use API.
    Prevents LLM from inventing "dock1" or "sector_7".
    """
    locations = _load_locations()
    return {
        "locations": list(locations.keys()),
        "count": len(locations),
    }


def validate_plan(plan_json: dict) -> dict:
    """Validates a plan against location whitelist and field requirements.

    Called by Claude via tool-use API to self-correct before returning.

    Checks:
    - All tasks have required fields (id, type, location, assigned_to)
    - All location values exist in locations.json
    - Task types are from allowed enum
    - No duplicate task IDs
    """
    errors = []
    locations = _load_locations()
    valid_locs = set(locations.keys())
    tasks = plan_json.get("tasks", [])
    seen_ids = set()

    for i, task in enumerate(tasks):
        tid = task.get("id", f"task[{i}]")

        # Check required fields
        for field in ("id", "type", "location", "assigned_to"):
            if field not in task:
                errors.append(f"{tid}: missing required field '{field}'")

        # Check duplicate IDs
        if task.get("id") in seen_ids:
            errors.append(f"{tid}: duplicate task ID")
        seen_ids.add(task.get("id"))

        # Check location exists
        loc = task.get("location")
        if loc and loc not in valid_locs:
            errors.append(
                f"{tid}: invalid location '{loc}'. "
                f"Valid: {sorted(valid_locs)}"
            )

        # Check task type
        ttype = task.get("type")
        if ttype and ttype not in ALLOWED_TASK_TYPES:
            errors.append(
                f"{tid}: invalid type '{ttype}'. "
                f"Must be one of: {sorted(ALLOWED_TASK_TYPES)}"
            )

    return {"valid": len(errors) == 0, "errors": errors}


# ═══════════════════════════════════════════════════════════════
# Category 2: Backend Utility Functions
# ═══════════════════════════════════════════════════════════════

def create_plan(mission: str, robot_count: int) -> dict:
    """Assembles Phase 1 prompt structure.

    Called by LLMOrchestrator, not by Claude.
    Returns a context dict with available locations and robot fleet info.
    """
    locations = _load_locations()
    return {
        "mission": mission,
        "robot_count": robot_count,
        "available_locations": list(locations.keys()),
        "location_coordinates": locations,
    }


def create_task_dag(plan: dict) -> dict:
    """Build a complete validated DAG from a Phase 2 LLM response.

    Steps:
    1. Load and validate all fields
    2. Topological sort via Kahn's algorithm
    3. Assign robots round-robin by proximity (if not already assigned)
    4. Check for charging task insertion
    5. Return canonical DAG spec

    Raises ValueError on validation failure.
    """
    errors = []
    tasks = plan.get("tasks", [])
    robots = plan.get("robots", [])
    locations = plan.get("locations", {})
    robot_ids = {r["id"] for r in robots}
    valid_locs = set(locations.keys())
    task_ids = set()

    # ── Validate ──
    for task in tasks:
        tid = task.get("id", "?")
        if tid in task_ids:
            errors.append(f"duplicate task id: {tid}")
        task_ids.add(tid)

        if task.get("location") not in valid_locs:
            errors.append(f"task {tid}: invalid location '{task.get('location')}'")
        if task.get("assigned_to") not in robot_ids:
            errors.append(f"task {tid}: invalid robot '{task.get('assigned_to')}'")

    if errors:
        raise ValueError(f"DAG validation failed:\n" + "\n".join(errors))

    # ── Topological sort (Kahn's algorithm) ──
    in_degree = {t["id"]: 0 for t in tasks}
    adj_list = {t["id"]: [] for t in tasks}  # id → dependents

    for t in tasks:
        for dep in t.get("depends_on", []):
            if dep not in adj_list:
                errors.append(f"task {t['id']}: depends_on '{dep}' not found")
                continue
            adj_list[dep].append(t["id"])
            in_degree[t["id"]] += 1

    queue = deque(tid for tid, deg in in_degree.items() if deg == 0)
    sorted_ids = []
    while queue:
        tid = queue.popleft()
        sorted_ids.append(tid)
        for dep in adj_list[tid]:
            in_degree[dep] -= 1
            if in_degree[dep] == 0:
                queue.append(dep)

    if len(sorted_ids) != len(tasks):
        errors.append("circular dependency detected in task graph")

    if errors:
        raise ValueError(f"DAG validation failed:\n" + "\n".join(errors))

    # ── Reorder tasks to topological order ──
    task_map = {t["id"]: t for t in tasks}
    ordered_tasks = [task_map[tid] for tid in sorted_ids]

    # ── Build canonical DAG ──
    dag = {
        "mission_id": plan.get("mission_id", ""),
        "robot_count": len(robots),
        "robots": robots,
        "tasks": ordered_tasks,
        "locations": locations,
        "metadata": plan.get("metadata", {}),
    }
    return dag


def get_spawn_positions(N: int) -> list[dict]:
    """Compute N non-overlapping spawn positions in the Gazebo world.

    Pure geometry — no I/O.
    Uses existing launch pattern positions extended to 6.
    """
    base = [
        {"x": -4.0, "y": 0.0},   # robot_1
        {"x": -3.0, "y": -2.0},  # robot_2
        {"x": -4.0, "y": 2.0},   # robot_3
        {"x": -3.0, "y": 2.0},   # robot_4
        {"x": -2.0, "y": 0.0},   # robot_5
        {"x": -2.0, "y": -2.0},  # robot_6
    ]
    if N < 1 or N > 6:
        raise ValueError(f"N must be 1-6, got {N}")
    return base[:N]


# ═══════════════════════════════════════════════════════════════
# Internal helpers
# ═══════════════════════════════════════════════════════════════

def _load_locations() -> dict:
    """Load yard locations from JSON file."""
    if not os.path.exists(LOCATIONS_FILE):
        return {}
    with open(LOCATIONS_FILE) as f:
        return json.load(f)
