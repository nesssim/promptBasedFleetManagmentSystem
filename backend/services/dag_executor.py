"""DAG Executor — runs the task graph against live robots in Gazebo.

After Gazebo is launched and robots are spawned, this module executes
the DAG by navigating each robot to task locations in dependency order.

Navigation uses a proportional controller (scripts/navigate_robot.py)
running natively via bash.

Usage (called from launch.py after successful spawn):
    executor = DAGExecutor(dag, launcher)
    asyncio.create_task(executor.run())
"""

import asyncio
import json
import logging
import math
import os
import subprocess
import time
from collections import defaultdict
from typing import Callable, Optional

from .gazebo import BASE_SPAWN_POSITIONS

logger = logging.getLogger(__name__)

# Paths
_SCRIPT_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "scripts")
_NAVIGATE_SCRIPT = os.path.join(_SCRIPT_DIR, "navigate_robot.py")


class DAGExecutor:
    """Execute a validated DAG against live Gazebo robots.

    Handles:
    - Dependency resolution across robots
    - Sequential task execution per robot
    - Navigation via rclpy script
    - Non-navigate tasks (charge, weigh, dock) simulated with sleep
    """

    def __init__(
        self,
        dag: dict,
        robot_count: int,
        progress_callback: Optional[Callable] = None,
    ):
        self.dag = dag
        self.robot_count = robot_count
        self.tasks_by_id = {t["id"]: t for t in dag.get("tasks", [])}
        self.locations = dag.get("locations", {})
        self.completed_tasks: set[str] = set()
        self.task_results: dict[str, dict] = {}
        self._progress_cb = progress_callback
        self._cancelled = False

        # Current positions: robot_N -> {x, y}
        self.robot_positions: dict[str, dict] = {}
        for i in range(1, robot_count + 1):
            if i - 1 < len(BASE_SPAWN_POSITIONS):
                self.robot_positions[f"robot_{i}"] = dict(BASE_SPAWN_POSITIONS[i - 1])

        # Build per-robot task queues (topological order preserved)
        self.robot_queues: dict[str, list[dict]] = defaultdict(list)
        for task in dag.get("tasks", []):
            robot = task.get("assigned_to", "")
            if robot:
                self.robot_queues[robot].append(task)

    async def run(self) -> dict:
        """Execute the full DAG. Returns summary of results."""
        logger.info(
            "DAGExecutor starting: %d tasks across %d robots",
            len(self.tasks_by_id), len(self.robot_queues),
        )

        robot_tasks = []
        for robot_id in sorted(self.robot_queues.keys()):
            robot_tasks.append(self._run_robot_tasks(robot_id))

        results = await asyncio.gather(*robot_tasks, return_exceptions=True)

        summary = {
            "completed": len(self.completed_tasks),
            "total": len(self.tasks_by_id),
            "results": self.task_results,
        }

        for i, result in enumerate(results):
            robot_id = sorted(self.robot_queues.keys())[i]
            if isinstance(result, Exception):
                logger.error("Robot %s failed: %s", robot_id, result)
                summary["results"][robot_id] = {"error": str(result)}
            else:
                summary["results"][robot_id] = result

        logger.info("DAGExecutor finished: %s", summary)
        return summary

    def cancel(self):
        """Signal all robots to stop."""
        self._cancelled = True

    async def _run_robot_tasks(self, robot_id: str) -> dict:
        """Execute all tasks for one robot in dependency order."""
        tasks = self.robot_queues[robot_id]
        completed = []

        for task in tasks:
            if self._cancelled:
                logger.info("DAGExecutor cancelled — stopping %s", robot_id)
                break

            deps = task.get("depends_on", [])
            while deps and not self._cancelled:
                unmet = [d for d in deps if d not in self.completed_tasks]
                if not unmet:
                    break
                await asyncio.sleep(0.5)

            if self._cancelled:
                break

            task_id = task["id"]
            logger.info("[%s] Starting task %s (%s)", robot_id, task_id, task.get("type"))

            if self._progress_cb:
                await self._progress_cb({
                    "type": "task_start",
                    "robot_id": robot_id,
                    "task_id": task_id,
                    "task_type": task.get("type"),
                })

            try:
                result = await self._execute_task(robot_id, task)
                self.completed_tasks.add(task_id)
                self.task_results[task_id] = {"status": "completed", **result}
                completed.append(task_id)

                if self._progress_cb:
                    await self._progress_cb({
                        "type": "task_complete",
                        "robot_id": robot_id,
                        "task_id": task_id,
                    })

                logger.info("[%s] Task %s completed", robot_id, task_id)

            except Exception as e:
                self.task_results[task_id] = {"status": "failed", "error": str(e)}
                logger.error("[%s] Task %s failed: %s", robot_id, task_id, e)

                if self._progress_cb:
                    await self._progress_cb({
                        "type": "task_failed",
                        "robot_id": robot_id,
                        "task_id": task_id,
                        "error": str(e),
                    })

        return {"completed_tasks": completed}

    async def _execute_task(self, robot_id: str, task: dict) -> dict:
        """Execute a single task based on its type."""
        task_type = task.get("type", "")
        location = task.get("location", "")
        duration = task.get("duration_s", 10)

        if task_type == "navigate":
            return await self._navigate_to(robot_id, location)
        elif task_type in ("charge", "weigh", "dock", "undock"):
            logger.info("[%s] Simulating %s for %ds at %s", robot_id, task_type, duration, location)
            await asyncio.sleep(min(duration, 5))
            return {"action": task_type, "location": location, "simulated": True}
        else:
            logger.warning("[%s] Unknown task type: %s", robot_id, task_type)
            await asyncio.sleep(1)
            return {"action": task_type, "location": location, "simulated": True}

    async def _navigate_to(self, robot_id: str, location_name: str) -> dict:
        """Navigate robot to a named location using the navigation script."""
        if location_name not in self.locations:
            raise ValueError(f"Unknown location: {location_name}")

        target = self.locations[location_name]
        target_x = target["x"]
        target_y = target["y"]

        pos = self.robot_positions.get(robot_id, {"x": 0.0, "y": 0.0})
        dist = math.sqrt((target_x - pos["x"]) ** 2 + (target_y - pos["y"]) ** 2)

        logger.info(
            "[%s] Navigating to %s (%.1f, %.1f) from (%.1f, %.1f), dist=%.1fm",
            robot_id, location_name, target_x, target_y, pos["x"], pos["y"], dist,
        )

        if dist < 0.3:
            logger.info("[%s] Already at %s", robot_id, location_name)
            return {"location": location_name, "distance": dist}

        # Run navigate_robot.py directly via bash
        nav_cmd = (
            f"source /opt/ros/humble/setup.bash && "
            f"export TURTLEBOT3_MODEL=burger && "
            f"python3 {_NAVIGATE_SCRIPT} "
            f"--robot-id {robot_id} "
            f"--target-x {target_x} "
            f"--target-y {target_y}"
        )
        nav_args = ["bash", "-lc", nav_cmd]
        logger.info("[%s] Navigation command: %s", robot_id, nav_args)

        def _run_nav():
            return subprocess.run(
                nav_args,
                capture_output=True,
                timeout=120,
            )

        result = await asyncio.to_thread(_run_nav)

        if result.returncode != 0:
            stderr = result.stderr.decode(errors="replace") if result.stderr else ""
            logger.warning("[%s] Navigation script returned %d: %s", robot_id, result.returncode, stderr)

        self.robot_positions[robot_id] = {"x": target_x, "y": target_y}

        return {"location": location_name, "distance": dist}
