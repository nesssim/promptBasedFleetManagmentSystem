"""Gazebo lifecycle management.

Responsible for:
1. Starting gzserver on a negotiated port
2. Polling for Gazebo readiness (30s timeout)
3. Sequential robot spawning with SDF patching (2s delay between)
4. Emitting spawn_progress events to connected WebSocket clients
"""

import asyncio
import json
import os
import tempfile
import xml.etree.ElementTree as ET
from typing import Optional

from backend.services.process_manager import (
    track_pid,
    negotiate_port,
    async_wait_for_gazebo,
)

# Path to the stock TurtleBot3 Burger SDF model
TURTLEBOT3_SDF = (
    "/opt/ros/humble/share/turtlebot3_gazebo/"
    "models/turtlebot3_burger/model.sdf"
)

# Week 1/2/4 spawn positions (extended for up to 6 robots)
BASE_SPAWN_POSITIONS = [
    {"x": -4.0, "y": 0.0},   # robot_1
    {"x": -3.0, "y": -2.0},  # robot_2
    {"x": -4.0, "y": 2.0},   # robot_3
    {"x": -3.0, "y": 2.0},   # robot_4
    {"x": -2.0, "y": 0.0},   # robot_5
    {"x": -2.0, "y": -2.0},  # robot_6
]


# ── SDF Patching ──


def patch_sdf(robot_n: int) -> str:
    """Patch the stock TurtleBot3 SDF with unique frame names.

    Creates /tmp/burger_{N}.sdf with odometry_frame, robot_base_frame,
    and frame_name rewritten to use robot_N/ prefix.

    Returns path to patched SDF file.
    """
    if not os.path.exists(TURTLEBOT3_SDF):
        raise FileNotFoundError(
            f"TurtleBot3 SDF not found at {TURTLEBOT3_SDF}. "
            f"Is turtlebot3_gazebo installed?"
        )

    tree = ET.parse(TURTLEBOT3_SDF)
    root = tree.getroot()

    ns = f"robot_{robot_n}"

    # Patch odometry frame
    for elem in root.iter("odometry_frame"):
        elem.text = f"{ns}/odom"

    # Patch robot base frame
    for elem in root.iter("robot_base_frame"):
        elem.text = f"{ns}/base_footprint"

    # Patch frame name
    for elem in root.iter("frameName"):
        elem.text = f"{ns}/base_scan"

    out_path = f"/tmp/burger_{robot_n}.sdf"
    tree.write(out_path, xml_declaration=True)
    return out_path


# ── Spawn Positions ──


def get_spawn_positions(N: int) -> list[dict]:
    """Return N non-overlapping spawn positions."""
    if N < 1 or N > 6:
        raise ValueError(f"N must be 1-6, got {N}")
    return BASE_SPAWN_POSITIONS[:N]


# ── GazeboLauncher ──


class GazeboLauncher:
    """Manages Gazebo lifecycle for a single mission."""

    def __init__(self):
        self.port: Optional[int] = None
        self.gzserver_process: Optional[asyncio.subprocess.Process] = None
        self.robot_processes: list[dict] = []
        self._progress_callbacks: list[callable] = []

    def on_progress(self, callback: callable) -> None:
        """Register a callback for spawn progress events.

        Callback receives: dict with current, total, status, robot_id
        """
        self._progress_callbacks.append(callback)

    async def _emit_progress(self, current: int, total: int, status: str, robot_id: str = "") -> None:
        """Emit spawn progress to all registered callbacks."""
        event = {
            "current": current,
            "total": total,
            "status": status,
            "robot_id": robot_id,
        }
        for cb in self._progress_callbacks:
            await cb(event)

    async def launch(self, robot_count: int) -> int:
        """Full Gazebo launch sequence.

        Args:
            robot_count: Number of robots to spawn (1-6)

        Returns:
            The negotiated Gazebo port number

        Raises:
            TimeoutError: if Gazebo doesn't start within 30s
            RuntimeError: if port negotiation fails
        """
        # Step 1: Negotiate port
        self.port = negotiate_port()
        print(f"[gazebo] Using port {self.port}")

        # Step 2: Start gzserver
        self.gzserver_process = await asyncio.create_subprocess_exec(
            "gzserver",
            f"--port={self.port}",
            "/opt/ros/humble/share/gazebo_ros/worlds/empty_world.world",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        track_pid(self.gzserver_process.pid, "gzserver")
        print(f"[gazebo] gzserver started (PID {self.gzserver_process.pid})")

        # Step 3: Wait for Gazebo readiness
        print(f"[gazebo] Waiting for Gazebo on port {self.port}...")
        ready = await async_wait_for_gazebo(self.port, timeout=30.0)
        if not ready:
            raise TimeoutError(f"Gazebo did not start within 30s on port {self.port}")
        print("[gazebo] Gazebo is ready")

        # Step 4: Spawn robots sequentially
        positions = get_spawn_positions(robot_count)
        for i, pos in enumerate(positions, start=1):
            await self._emit_progress(i - 1, robot_count, "spawning", f"robot_{i}")
            try:
                await self._spawn_robot(i, pos)
                print(f"[gazebo] robot_{i} spawned at ({pos['x']}, {pos['y']})")
                await self._emit_progress(i, robot_count, "ok", f"robot_{i}")
            except Exception as e:
                print(f"[gazebo] robot_{i} spawn failed: {e}")
                await self._emit_progress(i, robot_count, "failed", f"robot_{i}")

            # 2s delay between spawns (prevents Gazebo entity spawner deadlock)
            if i < robot_count:
                await asyncio.sleep(2.0)

        print(f"[gazebo] All {robot_count} robots spawned")
        return self.port

    async def _spawn_robot(self, n: int, position: dict) -> None:
        """Spawn a single robot in Gazebo and start its state publisher."""
        sdf_path = patch_sdf(n)

        # Launch robot_state_publisher for this robot
        rsp = await asyncio.create_subprocess_exec(
            "ros2", "run", "robot_state_publisher", "robot_state_publisher",
            "--ros-args",
            "-r", f"__ns:=/robot_{n}",
            "-r", f"__node:=robot_{n}_state_publisher",
            "-p", f"frame_prefix:=robot_{n}",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        track_pid(rsp.pid, f"robot_{n}_state_publisher")
        self.robot_processes.append({"id": f"robot_{n}", "pid": rsp.pid, "type": "state_publisher"})

        # Spawn entity in Gazebo
        spawn = await asyncio.create_subprocess_exec(
            "ros2", "run", "gazebo_ros", "spawn_entity.py",
            "-file", sdf_path,
            "-entity", f"burger_{n}",
            "-robot_namespace", f"robot_{n}",
            "-x", str(position["x"]),
            "-y", str(position["y"]),
            "-z", "0.0",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await spawn.communicate()

        if spawn.returncode != 0:
            error_msg = stderr.decode() if stderr else "unknown error"
            raise RuntimeError(f"spawn_entity for robot_{n} failed: {error_msg}")

    async def kill(self) -> None:
        """Kill all spawned processes for this mission."""
        for entry in self.robot_processes:
            try:
                proc = entry.get("process")
                if proc:
                    proc.terminate()
            except Exception:
                pass
        self.robot_processes.clear()

        if self.gzserver_process:
            self.gzserver_process.terminate()
            try:
                await asyncio.wait_for(self.gzserver_process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                self.gzserver_process.kill()
            self.gzserver_process = None
