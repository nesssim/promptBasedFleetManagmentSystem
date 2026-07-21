"""Gazebo lifecycle management — Linux native.

Responsible for:
1. Starting gzserver on a negotiated port
2. Polling for Gazebo readiness (30s timeout)
3. Sequential robot spawning with SDF patching (2s delay between)

Runs all ROS2/Gazebo commands directly via ``bash -lc``.
"""

import asyncio
import logging
import os
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from typing import Optional

from .process_manager import (
    track_pid,
    negotiate_port,
    async_wait_for_gazebo,
    kill_all,
)

logger = logging.getLogger(__name__)

# Path to the stock TurtleBot3 Burger SDF model
TURTLEBOT3_SDF = (
    "/opt/ros/humble/share/turtlebot3_gazebo/"
    "models/turtlebot3_burger/model.sdf"
)

# Spawn positions (extended for up to 6 robots)
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

    Creates a temp file burger_{N}.sdf with odometry_frame, robot_base_frame,
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

    for elem in root.iter("odometry_frame"):
        elem.text = f"{ns}/odom"
    for elem in root.iter("robot_base_frame"):
        elem.text = f"{ns}/base_footprint"
    for elem in root.iter("frameName"):
        elem.text = f"{ns}/base_scan"

    fd, out_path = tempfile.mkstemp(suffix=".sdf", prefix=f"burger_{robot_n}_")
    os.close(fd)
    ET.ElementTree(root).write(out_path, xml_declaration=True)
    return out_path


# ── Spawn Positions ──


def get_spawn_positions(N: int) -> list[dict]:
    """Return N non-overlapping spawn positions."""
    if N < 1 or N > 6:
        raise ValueError(f"N must be 1-6, got {N}")
    return BASE_SPAWN_POSITIONS[:N]


# ── GazeboLauncher ──


class GazeboLauncher:
    """Manages Gazebo lifecycle for a single mission.

    Runs all commands natively via ``bash -lc``.
    """

    def __init__(self):
        self.port: Optional[int] = None
        self.gzserver_process: Optional[subprocess.Popen] = None
        self.robot_processes: list[dict] = []

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
        kill_all()
        await asyncio.sleep(1.0)

        self.port = negotiate_port()
        logger.info("Using port %s", self.port)

        # Start gzserver
        gzserver_cmd = (
            "export GAZEBO_MODEL_PATH=/opt/ros/humble/share/turtlebot3_gazebo/models && "
            "source /opt/ros/humble/setup.bash && "
            f"exec gzserver --port={self.port} "
            "-s libgazebo_ros_init.so "
            "-s libgazebo_ros_factory.so "
            "-s libgazebo_ros_force_system.so "
            "/opt/ros/humble/share/gazebo_ros/worlds/empty.world"
        )
        gzserver_args = ["bash", "-lc", gzserver_cmd]
        logger.info("Starting gzserver")

        def _start_gzserver():
            proc = subprocess.Popen(
                gzserver_args,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )

            def _drain_stderr():
                try:
                    for line in proc.stderr:
                        logger.warning("gzserver stderr: %s", line.decode(errors="replace").rstrip())
                except (ValueError, OSError):
                    pass

            import threading
            threading.Thread(target=_drain_stderr, daemon=True).start()
            return proc

        self.gzserver_process = await asyncio.to_thread(_start_gzserver)
        track_pid(self.gzserver_process.pid, "gzserver")
        logger.info("gzserver started (PID %s, poll=%s)", self.gzserver_process.pid, self.gzserver_process.poll())

        if self.gzserver_process.poll() is not None:
            logger.error(
                "gzserver exited immediately with code %s",
                self.gzserver_process.returncode,
            )
            raise RuntimeError(f"gzserver exited immediately (rc={self.gzserver_process.returncode})")

        # Wait for Gazebo readiness
        logger.info("Waiting for Gazebo on port %s...", self.port)

        if self.gzserver_process.poll() is not None:
            raise RuntimeError(
                f"gzserver died before probe (rc={self.gzserver_process.returncode})"
            )

        ready = await async_wait_for_gazebo(self.port, timeout=30.0)
        if not ready:
            if self.gzserver_process.poll() is not None:
                raise RuntimeError(
                    f"gzserver died during startup (rc={self.gzserver_process.returncode})"
                )
            raise TimeoutError(f"Gazebo did not start within 30s on port {self.port}")
        logger.info("Gazebo is ready")

        # Spawn robots sequentially
        positions = get_spawn_positions(robot_count)
        for i, pos in enumerate(positions, start=1):
            try:
                await self._spawn_robot(i, pos)
                logger.info("robot_%s spawned at (%s, %s)", i, pos['x'], pos['y'])
            except Exception as e:
                logger.info("robot_%s spawn failed: %s", i, e)

            if i < robot_count:
                await asyncio.sleep(2.0)

        logger.info("All %s robots spawned", robot_count)
        return self.port

    async def _spawn_robot(self, n: int, position: dict) -> None:
        """Spawn a single robot in Gazebo and start its state publisher."""
        sdf_path = patch_sdf(n)

        # Launch robot_state_publisher for this robot
        rsp_cmd = (
            f"source /opt/ros/humble/setup.bash && "
            f"ros2 run robot_state_publisher robot_state_publisher "
            f"--ros-args "
            f"-r __ns:=/robot_{n} "
            f"-r __node:=robot_{n}_state_publisher "
            f"-p frame_prefix:=robot_{n}"
        )
        rsp_args = ["bash", "-lc", rsp_cmd]
        logger.info("Starting robot_%s state publisher", n)

        def _start_rsp():
            return subprocess.Popen(
                rsp_args,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )

        rsp = await asyncio.to_thread(_start_rsp)
        track_pid(rsp.pid, f"robot_{n}_state_publisher")
        self.robot_processes.append({"id": f"robot_{n}", "pid": rsp.pid, "type": "state_publisher"})

        # Spawn entity in Gazebo
        spawn_cmd = (
            f"source /opt/ros/humble/setup.bash && "
            f"ros2 run gazebo_ros spawn_entity.py "
            f"-file {sdf_path} "
            f"-entity burger_{n} "
            f"-robot_namespace robot_{n} "
            f"-x {position['x']} "
            f"-y {position['y']} "
            f"-z 0.0"
        )
        spawn_args = ["bash", "-lc", spawn_cmd]
        logger.info("Spawning burger_%s at (%s, %s)", n, position["x"], position["y"])

        def _spawn_entity():
            return subprocess.run(
                spawn_args,
                capture_output=True,
                timeout=30,
            )

        result = await asyncio.to_thread(_spawn_entity)

        if result.returncode != 0:
            error_msg = result.stderr.decode(errors="replace") if result.stderr else "unknown error"
            raise RuntimeError(f"spawn_entity for robot_{n} failed: {error_msg}")
