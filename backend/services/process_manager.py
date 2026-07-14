"""Process lifecycle management: PID tracking, kill, port negotiation.

Design decisions (from ADR-3):
- PID files in /tmp/mission_swarm.pids (Linux/WSL only)
- SIGTERM → 3s grace → SIGKILL
- Port negotiation from pool [11345, 11346, 11347]
- atexit + signal.SIGTERM handlers for belt-and-suspenders cleanup
- Fallback pkill -f only if PID file is missing
"""

import asyncio
import atexit
import json
import os
import signal
import socket
import time
from typing import Optional

PID_FILE = "/tmp/mission_swarm.pids"
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


def kill_all() -> None:
    """Kill all tracked processes.

    1. Read PID file
    2. SIGTERM all
    3. Wait 3s grace period
    4. SIGKILL survivors
    5. Verify port is free (15s retry)
    6. Clean up PID file
    """
    pids = read_pids()
    if not pids:
        _pkill_fallback()
        clear_pid_file()
        return

    # Step 1: SIGTERM all
    for entry in pids:
        try:
            os.kill(entry["pid"], signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            pass

    # Step 2: Wait for grace period
    time.sleep(3.0)

    # Step 3: SIGKILL survivors
    for entry in pids:
        try:
            os.kill(entry["pid"], signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass

    # Step 4: Verify port free
    _wait_for_port_free(PORT_POOL[0], timeout=15.0)

    # Step 5: Clean up
    clear_pid_file()


def _pkill_fallback() -> None:
    """Fallback: kill by process name pattern if PID file is missing."""
    for pattern in [
        "gzserver",
        "gzclient",
        "fleet_coordinator",
        "robot_state_publisher",
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
    while time.monotonic() - start < timeout:
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection("127.0.0.1", port),
                timeout=2.0,
            )
            writer.close()
            await writer.wait_closed()
            return True
        except (ConnectionRefusedError, OSError, asyncio.TimeoutError):
            await asyncio.sleep(0.5)
    return False


# ── Registration ──


def atexit_register() -> None:
    """Register cleanup handlers (called once at startup)."""
    atexit.register(kill_all)

    def _signal_handler(signum, frame):
        kill_all()
        os._exit(0)

    # Handle SIGTERM and SIGINT gracefully
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _signal_handler)
    if hasattr(signal, "SIGINT"):
        signal.signal(signal.SIGINT, _signal_handler)
