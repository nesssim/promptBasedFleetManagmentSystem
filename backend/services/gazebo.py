"""Gazebo lifecycle management — cross-platform (Linux native + Windows/WSL).

Responsible for:
1. Starting gzserver on a negotiated port
2. Polling for Gazebo readiness (30s timeout)
3. Sequential robot spawning with SDF patching (2s delay between)
4. Emitting spawn_progress events to connected WebSocket clients

Platform adaptation:
- Linux: runs ROS2/Gazebo commands directly
- Windows: prefixes commands with `wsl` (requires WSL2 with ROS2 Humble installed)

Uses ``subprocess.Popen`` / ``subprocess.run`` instead of
``asyncio.create_subprocess_exec`` because the latter has a Windows
bug where it cannot resolve executables (even absolute paths) when
running inside certain process contexts (e.g. uvicorn workers).
"""

import asyncio
import logging
import os
import platform
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from typing import Callable, Optional

from .process_manager import (
    track_pid,
    negotiate_port,
    async_wait_for_gazebo,
    kill_all,
)
from .wsl import wsl_cmd as _wsl_cmd, wsl_path_to_linux as _wsl_path, get_wsl_path

logger = logging.getLogger(__name__)

_IS_WINDOWS = platform.system() == "Windows"


def _wsl_bash_cmd(shell_cmd: str) -> list[str]:
    """Build a WSL command that avoids double-nested bash.

    Uses ``wsl.EXE -- bash -lc '...'`` so WSL doesn't wrap it in another
    ``bash -c``, preventing orphan-process issues.
    """
    wsl_exe = get_wsl_path()
    if not wsl_exe:
        raise FileNotFoundError("WSL executable not found")
    return [wsl_exe, "--", "bash", "-lc", shell_cmd]

# Path to the stock TurtleBot3 Burger SDF model (inside WSL/Linux)
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


def _read_sdf_via_wsl() -> str:
    """Read the TurtleBot3 SDF content from inside WSL."""
    wsl_exe = get_wsl_path()
    if not wsl_exe:
        raise FileNotFoundError("WSL executable not found — cannot read SDF from WSL")
    cmd = [
        wsl_exe, "bash", "-lc",
        f"cat {TURTLEBOT3_SDF}",
    ]
    result = subprocess.run(cmd, capture_output=True, timeout=10)
    if result.returncode != 0:
        stderr = result.stderr.decode(errors="replace") if result.stderr else ""
        raise FileNotFoundError(
            f"Failed to read SDF from WSL (rc={result.returncode}): {stderr}"
        )
    return result.stdout.decode(errors="replace")


def patch_sdf(robot_n: int) -> str:
    """Patch the stock TurtleBot3 SDF with unique frame names.

    Creates a temp file burger_{N}.sdf with odometry_frame, robot_base_frame,
    and frame_name rewritten to use robot_N/ prefix.

    Returns path to patched SDF file (Windows path on Windows, Linux path on Linux).
    """
    if _IS_WINDOWS:
        # On Windows the Linux path isn't directly accessible — read via WSL
        sdf_xml = _read_sdf_via_wsl()
        root = ET.fromstring(sdf_xml)
    else:
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

    Uses subprocess.Popen for long-running processes (gzserver,
    robot_state_publisher) and subprocess.run for one-shot commands
    (spawn_entity.py), avoiding asyncio.create_subprocess_exec which
    has Windows resolution bugs.
    """

    def __init__(self):
        self.port: Optional[int] = None
        self.gzserver_process: Optional[subprocess.Popen] = None
        self.robot_processes: list[dict] = []
        self._progress_callbacks: list[Callable] = []

    def on_progress(self, callback: Callable) -> None:
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
        # Step 1: Kill any stale Gazebo processes from previous runs
        kill_all()
        # Give WSL processes a moment to fully die
        await asyncio.sleep(1.0)

        # Step 2: Negotiate port
        self.port = negotiate_port()
        logger.info("Using port %s", self.port)

        # Step 3: Start gzserver via subprocess.Popen (long-running process)
        # Use `wsl.EXE -- bash -lc` (with --) to avoid double-nested bash.
        # Use `exec` so gzserver replaces bash (no orphan process issues).
        # Set GAZEBO_MODEL_PATH so mesh models (burger_base.stl etc.) are found.
        gzserver_cmd = (
            "export GAZEBO_MODEL_PATH=/opt/ros/humble/share/turtlebot3_gazebo/models && "
            "source /opt/ros/humble/setup.bash && "
            f"exec gzserver --port={self.port} "
            "-s libgazebo_ros_init.so "
            "-s libgazebo_ros_factory.so "
            "-s libgazebo_ros_force_system.so "
            "/opt/ros/humble/share/gazebo_ros/worlds/empty.world"
        )
        gzserver_args = _wsl_bash_cmd(gzserver_cmd)
        logger.info("Starting gzserver: %s", gzserver_args)

        def _start_gzserver():
            proc = subprocess.Popen(
                gzserver_args,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
            # Read stderr in a background thread so the pipe doesn't block
            def _drain_stderr():
                try:
                    for line in proc.stderr:
                        logger.warning("gzserver stderr: %s", line.decode(errors="replace").rstrip())
                except (ValueError, OSError):
                    pass  # pipe closed
            import threading
            threading.Thread(target=_drain_stderr, daemon=True).start()
            return proc

        self.gzserver_process = await asyncio.to_thread(_start_gzserver)
        track_pid(self.gzserver_process.pid, "gzserver")
        logger.info("gzserver started (PID %s, poll=%s)", self.gzserver_process.pid, self.gzserver_process.poll())

        # Check if gzserver died immediately
        if self.gzserver_process.poll() is not None:
            logger.error(
                "gzserver exited immediately with code %s",
                self.gzserver_process.returncode,
            )
            raise RuntimeError(f"gzserver exited immediately (rc={self.gzserver_process.returncode})")

        # Step 4: Wait for Gazebo readiness
        logger.info("Waiting for Gazebo on port %s...", self.port)

        # Check if gzserver is still alive before probing
        if self.gzserver_process.poll() is not None:
            raise RuntimeError(
                f"gzserver died before probe (rc={self.gzserver_process.returncode})"
            )

        ready = await async_wait_for_gazebo(self.port, timeout=30.0)
        if not ready:
            # Check if gzserver died during the probe
            if self.gzserver_process.poll() is not None:
                raise RuntimeError(
                    f"gzserver died during startup (rc={self.gzserver_process.returncode})"
                )
            raise TimeoutError(f"Gazebo did not start within 30s on port {self.port}")
        logger.info("Gazebo is ready")

        # Step 5: Spawn robots sequentially
        positions = get_spawn_positions(robot_count)
        for i, pos in enumerate(positions, start=1):
            await self._emit_progress(i - 1, robot_count, "spawning", f"robot_{i}")
            try:
                await self._spawn_robot(i, pos)
                logger.info("robot_%s spawned at (%s, %s)", i, pos['x'], pos['y'])
                await self._emit_progress(i, robot_count, "ok", f"robot_{i}")
            except Exception as e:
                logger.info("robot_%s spawn failed: %s", i, e)
                await self._emit_progress(i, robot_count, "failed", f"robot_{i}")

            # 2s delay between spawns (prevents Gazebo entity spawner deadlock)
            if i < robot_count:
                await asyncio.sleep(2.0)

        logger.info("All %s robots spawned", robot_count)
        return self.port

    async def _spawn_robot(self, n: int, position: dict) -> None:
        """Spawn a single robot in Gazebo and start its state publisher."""
        sdf_path = patch_sdf(n)

        # Launch robot_state_publisher for this robot (long-running)
        rsp_cmd = (
            f"source /opt/ros/humble/setup.bash && "
            f"ros2 run robot_state_publisher robot_state_publisher "
            f"--ros-args "
            f"-r __ns:=/robot_{n} "
            f"-r __node:=robot_{n}_state_publisher "
            f"-p frame_prefix:=robot_{n}"
        )
        rsp_args = _wsl_bash_cmd(rsp_cmd)
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

        # Spawn entity in Gazebo — one-shot command, wait for completion
        spawn_cmd = (
            f"source /opt/ros/humble/setup.bash && "
            f"ros2 run gazebo_ros spawn_entity.py "
            f"-file {_wsl_path(sdf_path)} "
            f"-entity burger_{n} "
            f"-robot_namespace robot_{n} "
            f"-x {position['x']} "
            f"-y {position['y']} "
            f"-z 0.0"
        )
        spawn_args = _wsl_bash_cmd(spawn_cmd)
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

    async def kill(self) -> None:
        """Kill all spawned processes for this mission."""
        import signal
        for entry in self.robot_processes:
            pid = entry.get("pid")
            if pid:
                try:
                    os.kill(pid, signal.SIGTERM)
                except (OSError, ProcessLookupError):
                    pass
        self.robot_processes.clear()

        if self.gzserver_process:
            self.gzserver_process.terminate()
            try:
                await asyncio.to_thread(self.gzserver_process.wait, timeout=5.0)
            except Exception:
                self.gzserver_process.kill()
            self.gzserver_process = None
