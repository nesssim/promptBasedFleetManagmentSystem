"""Process lifecycle management: PID tracking, kill, port negotiation.

Design decisions (from ADR-3):
- PID files in system temp dir (cross-platform: /tmp or %TEMP%)
- SIGTERM → 3s grace → SIGKILL (Unix); taskkill /PID (Windows)
- Port negotiation from pool [11345, 11346, 11347]
- atexit + signal.SIGTERM handlers for belt-and-suspenders cleanup
- Fallback pkill -f only if PID file is missing (Unix only)
"""

import asyncio
import atexit
import json
import logging
import os
import platform
import signal
import socket
import subprocess
import tempfile
import time
from typing import Optional

logger = logging.getLogger(__name__)

PID_FILE = os.path.join(tempfile.gettempdir(), "mission_swarm.pids")
PORT_POOL = [11345, 11346, 11347]
IS_WINDOWS = platform.system() == "Windows"


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
    """Kill a process by PID, cross-platform."""
    if IS_WINDOWS:
        try:
            subprocess.run(
                ["taskkill", "/F", "/PID", str(pid)],
                capture_output=True,
                timeout=5,
            )
        except Exception:
            logger.info("Failed to kill process")
    else:
        try:
            os.kill(pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            pass


def _force_kill_process(pid: int) -> None:
    """Force-kill a process, cross-platform."""
    if IS_WINDOWS:
        _kill_process(pid)  # taskkill /F is already a force kill
    else:
        try:
            os.kill(pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            logger.info("Failed to kill process")


def kill_all() -> None:
    """Kill all tracked processes AND any WSL/Gazebo processes.

    1. Read PID file and kill tracked PIDs
    2. ALWAYS run _pkill_fallback to catch WSL processes (different PID namespace)
    3. Wait for all pool ports to be free
    4. Clean up PID file
    """
    pids = read_pids()

    # Kill tracked PIDs (Windows-side)
    for entry in pids:
        _kill_process(entry["pid"])

    if pids:
        time.sleep(3.0)
        if not IS_WINDOWS:
            for entry in pids:
                _force_kill_process(entry["pid"])

    # ALWAYS run fallback to kill WSL processes (different PID namespace)
    _pkill_fallback()

    # Wait for all pool ports to be free
    for port in PORT_POOL:
        _wait_for_port_free(port, timeout=5.0)

    clear_pid_file()


def _pkill_fallback() -> None:
    """Fallback: kill by process name pattern if PID file is missing."""
    if IS_WINDOWS:
        # Kill Windows-side processes
        for name in ["gazebo", "gzserver", "robot_state_publisher"]:
            try:
                subprocess.run(
                    ["taskkill", "/F", "/IM", f"{name}.exe"],
                    capture_output=True,
                    timeout=5,
                )
            except Exception:
                pass
        # Also kill processes inside WSL (they have different PIDs)
        try:
            from .wsl import get_wsl_path
            wsl = get_wsl_path()
            if wsl:
                subprocess.run(
                    [wsl, "--", "bash", "-lc",
                     "pkill -f gzserver; pkill -f gzclient; pkill -f robot_state_publisher; pkill -f spawn_entity"],
                    capture_output=True,
                    timeout=10,
                )
        except Exception:
            pass
    else:
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
    """Check if a TCP port is free on localhost.

    On Windows+WSL2, also checks inside WSL since processes there
    are in a separate network namespace.
    """
    # Check from Windows side
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        if s.connect_ex(("127.0.0.1", port)) == 0:
            return False  # port occupied on Windows side

    # Also check from inside WSL
    if IS_WINDOWS:
        try:
            from .wsl import get_wsl_path
            wsl = get_wsl_path()
            if wsl:
                probe = (
                    f"python3 -c \"import socket; s=socket.socket(); "
                    f"s.settimeout(2); s.connect(('127.0.0.1',{port})); s.close()\""
                )
                result = subprocess.run(
                    [wsl, "--", "bash", "-lc", probe],
                    capture_output=True,
                    timeout=5,
                )
                if result.returncode == 0:
                    return False  # port occupied inside WSL
        except Exception:
            pass

    return True


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

    On Windows+WSL2, gzserver listens inside WSL's NAT network and is
    unreachable from Windows at 127.0.0.1. So we probe via WSL's bash.

    Returns True if ready, False on timeout.
    """
    from .wsl import get_wsl_path

    wsl = get_wsl_path() if IS_WINDOWS else None

    start = time.monotonic()
    attempt = 0
    while time.monotonic() - start < timeout:
        attempt += 1
        try:
            if wsl:
                # Python socket probe from inside WSL — most reliable
                probe_cmd = (
                    f"python3 -c \"import socket; s=socket.socket(); "
                    f"s.settimeout(2); s.connect(('127.0.0.1',{port})); s.close()\""
                )
                result = await asyncio.to_thread(
                    subprocess.run,
                    [wsl, "--", "bash", "-lc", probe_cmd],
                    capture_output=True,
                    timeout=5,
                )
                if attempt <= 3 or attempt % 5 == 0:
                    logger.info(
                        "WSL probe port %d attempt %d: rc=%d stderr=%s",
                        port, attempt, result.returncode,
                        (result.stderr or b"").decode(errors="replace")[:200],
                    )
                if result.returncode == 0:
                    return True
            else:
                reader, writer = await asyncio.wait_for(
                    asyncio.open_connection("127.0.0.1", port),
                    timeout=2.0,
                )
                writer.close()
                await writer.wait_closed()
                return True
        except (ConnectionRefusedError, OSError, asyncio.TimeoutError, FileNotFoundError):
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

    # Handle SIGTERM and SIGINT gracefully
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _signal_handler)
    if hasattr(signal, "SIGINT"):
        signal.signal(signal.SIGINT, _signal_handler)
