"""Process lifecycle management: PID tracking, kill, port negotiation.

Linux-native implementation:
- PID files in /tmp
- SIGTERM → 3s grace → SIGKILL
- Port negotiation from pool [11345, 11346, 11347]
- atexit + signal handlers for cleanup
- pkill fallback if PID file is missing
"""

import asyncio
import atexit
import json
import logging
import os
import signal
import socket
import subprocess
import tempfile
import time
from typing import Optional

logger = logging.getLogger(__name__)

PID_FILE = os.path.join(tempfile.gettempdir(), "mission_swarm.pids")
PORT_POOL = [11345, 11346, 11347]


# ── PID Tracking ──


def track_pid(pid: int, label: str) -> None:
    """Append a PID to the tracked processes file."""
    os.makedirs(os.path.dirname(PID_FILE), exist_ok=True)
    entry = json.dumps({"pid": pid, "label": label, "started": time.time()})
    with open(PID_FILE, "a") as f:
        f.write(entry + "\n")


def read_pids() -> list[dict]:
    """Read all tracked PIDs from file."""
    if not os.path.exists(PID_FILE):
        return []
    with open(PID_FILE) as f:
        return [json.loads(line) for line in f if line.strip()]


def clear_pid_file() -> None:
    """Remove the PID file."""
    if os.path.exists(PID_FILE):
        os.remove(PID_FILE)


# ── Kill Logic ──


def _kill_process(pid: int) -> None:
    """Kill a process by PID (SIGTERM)."""
    try:
        os.kill(pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        pass


def _force_kill_process(pid: int) -> None:
    """Force-kill a process (SIGKILL)."""
    try:
        os.kill(pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        logger.info("Failed to force-kill PID %d", pid)


def kill_all() -> None:
    """Kill all tracked processes and any lingering Gazebo processes.

    1. Read PID file and kill tracked PIDs
    2. Force-kill after grace period
    3. pkill fallback for orphaned processes
    4. Wait for pool ports to be free
    5. Clean up PID file
    """
    pids = read_pids()

    for entry in pids:
        _kill_process(entry["pid"])

    if pids:
        time.sleep(3.0)
        for entry in pids:
            _force_kill_process(entry["pid"])

    _pkill_fallback()

    for port in PORT_POOL:
        _wait_for_port_free(port, timeout=5.0)

    clear_pid_file()


def _pkill_fallback() -> None:
    """Fallback: kill by process name pattern."""
    for pattern in [
        "gzserver",
        "gzclient",
        "robot_state_publisher",
        "spawn_entity",
    ]:
        os.system(f"pkill -f {pattern} 2>/dev/null")


# ── Port Negotiation ──


def negotiate_port(preferred: Optional[list[int]] = None) -> int:
    """Find first free port from the pool.

    Raises RuntimeError if none are free.
    """
    pool = preferred or PORT_POOL
    for port in pool:
        if _port_is_free(port):
            return port
    raise RuntimeError(
        f"No free port in pool {pool}. "
        f"Kill existing Gazebo instances and retry."
    )


def _port_is_free(port: int) -> bool:
    """Check if a TCP port is free on localhost."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) != 0


def _wait_for_port_free(port: int, timeout: float = 15.0) -> bool:
    """Poll until a port is free, with timeout."""
    start = time.time()
    while time.time() - start < timeout:
        if _port_is_free(port):
            return True
        time.sleep(0.5)
    return False


# ── Async helpers ──


async def async_wait_for_gazebo(port: int, timeout: float = 30.0) -> bool:
    """Async: poll a Gazebo port until it accepts connections.

    Returns True if ready, False on timeout.
    """
    start = time.monotonic()
    attempt = 0
    while time.monotonic() - start < timeout:
        attempt += 1
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection("127.0.0.1", port),
                timeout=2.0,
            )
            writer.close()
            await writer.wait_closed()
            return True
        except (ConnectionRefusedError, OSError, asyncio.TimeoutError):
            pass
        await asyncio.sleep(0.5)
    logger.warning("Gazebo probe timed out after %d attempts on port %d", attempt, port)
    return False


# ── Registration ──


def atexit_register() -> None:
    """Register cleanup handlers (called once at startup)."""
    atexit.register(kill_all)

    def _signal_handler(signum, frame):
        kill_all()
        os._exit(0)

    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _signal_handler)
    if hasattr(signal, "SIGINT"):
        signal.signal(signal.SIGINT, _signal_handler)
