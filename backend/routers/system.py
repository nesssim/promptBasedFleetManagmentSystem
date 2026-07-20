"""GET /system/wsl-check — Detect WSL availability.

For the MVP, we gate the "Launch Mission" button behind a WSL check.
If WSL is not installed or ROS2/Gazebo is not configured inside WSL,
the user gets a clear message before they reach the launch step.
"""

import asyncio
import logging
import subprocess

from fastapi import APIRouter

from ..services.wsl import get_wsl_path, wsl_cmd

logger = logging.getLogger(__name__)

router = APIRouter()


def _decode_wsl_output(raw: bytes) -> str:
    """Decode WSL subprocess output, handling UTF-16LE (Windows-native commands)
    and UTF-8 (Linux-side commands) transparently.

    WSL2 on Windows emits UTF-16LE for commands like ``wsl --version`` and
    ``wsl --list``, producing null bytes between every ASCII character when
    read as raw bytes.  We detect this pattern and decode accordingly.
    """
    if len(raw) < 2:
        return raw.decode("utf-8", errors="replace")

    # Heuristic: if the second byte of every pair is 0x00, it's UTF-16LE
    # (ASCII chars in UTF-16LE are \xNN\x00, while in UTF-8 they are just \xNN)
    odd_bytes = raw[1::2]
    null_count = sum(1 for b in odd_bytes if b == 0x00)
    total_pairs = len(odd_bytes)

    if total_pairs > 0 and null_count > total_pairs * 0.5:
        try:
            return raw.decode("utf-16-le").strip()
        except Exception:
            pass

    return raw.decode("utf-8", errors="replace").strip()


def _run_wsl_command_sync(
    args: list[str], timeout: float = 12.0
) -> tuple[int, str, str]:
    """Synchronous WSL command runner using subprocess.run.

    Uses subprocess.run (which works reliably on Windows) instead of
    asyncio.create_subprocess_exec (which can fail with FileNotFoundError
    in certain process contexts like uvicorn workers).
    """
    try:
        cmd = wsl_cmd(*args)
        logger.info("Running WSL command: %s", cmd)
        result = subprocess.run(
            cmd,
            capture_output=True,
            timeout=timeout,
        )
        return (
            result.returncode,
            _decode_wsl_output(result.stdout),
            _decode_wsl_output(result.stderr),
        )
    except FileNotFoundError as e:
        logger.error("FileNotFoundError running WSL: %s", e)
        return (-1, "", f"wsl executable not found: {e}")
    except subprocess.TimeoutExpired:
        return (-1, "", f"Command timed out after {timeout}s")
    except Exception as e:
        logger.error("Exception running WSL command: %s: %s", type(e).__name__, e)
        return (-1, "", str(e))


async def _run_wsl_command(
    args: list[str], timeout: float = 12.0
) -> tuple[int, str, str]:
    """Run a command via WSL and return (returncode, stdout, stderr).

    Delegates to subprocess.run via a thread executor for Windows
    compatibility (asyncio.create_subprocess_exec can fail with
    FileNotFoundError for wsl.exe in certain process contexts).
    """
    return await asyncio.to_thread(_run_wsl_command_sync, args, timeout)


async def _run_wsl_bash(command: str, timeout: float = 12.0) -> tuple[int, str, str]:
    """Run a bash command inside the default WSL distribution.

    Uses ``wsl bash -lc <command>``.  The command string is passed as a
    single argument — WSL concatenates args with spaces before handing
    them to the default shell, so no extra quoting is needed.
    """
    return await _run_wsl_command(
        ["bash", "-lc", command], timeout=timeout
    )


@router.get("/system/wsl-check")
async def check_wsl():
    """Probe WSL availability and ROS2/Gazebo readiness.

    Returns a detailed report:
      - wsl_installed: bool
      - wsl_version: str or null
      - distro: str or null
      - ros2_available: bool
      - gazebo_available: bool
      - details: list of check messages
    """
    details: list[str] = []
    result = {
        "wsl_installed": False,
        "wsl_version": None,
        "distro": None,
        "ros2_available": False,
        "gazebo_available": False,
        "details": details,
    }

    # Pre-check: can we even find wsl.exe?
    wsl_path = get_wsl_path()
    logger.info("WSL check starting. wsl_path=%s", wsl_path)
    if not wsl_path:
        details.append(
            "WSL executable not found on this system. "
            "Install WSL 2 with: wsl --install -d Ubuntu"
        )
        details.append(
            "Searched: PATH (shutil.which), "
            r"C:\Windows\System32\wsl.exe, cmd.exe /c where wsl"
        )
        return result

    # ── Step 1: Is WSL available? ──
    rc, stdout, stderr = await _run_wsl_command(["--version"])
    logger.info(
        "WSL --version: rc=%s stdout_len=%d preview=%r stderr=%r",
        rc, len(stdout), stdout[:80], stderr[:80],
    )
    if rc != 0 or not stdout:
        details.append(
            "WSL is NOT installed or not accessible. "
            "Install WSL 2 with: wsl --install -d Ubuntu"
        )
        details.append(
            f"wsl --version returned: rc={rc} "
            f"out={stdout[:100]!r} err={stderr[:100]!r}"
        )
        return result

    result["wsl_installed"] = True
    result["wsl_version"] = stdout.split("\n")[0].strip()
    details.append(f"WSL detected: {result['wsl_version']}")

    # ── Step 2: What distribution is default? ──
    # Use ``-l`` (not ``-l -v``) — the verbose variant can hang.
    rc, stdout, stderr = await _run_wsl_command(["-l"])
    logger.info("WSL -l: rc=%s stdout_len=%d", rc, len(stdout))
    if rc == 0 and stdout:
        lines = [l.strip() for l in stdout.split("\n") if l.strip()]
        # First line is usually a header like
        # "Windows Subsystem for Linux Distributions:"
        data_lines = [
            l for l in lines
            if not l.startswith("Windows Subsystem")
        ]
        if data_lines:
            default_line = next(
                (
                    l for l in data_lines
                    if "(Default)" in l or "*" in l
                ),
                data_lines[0] if data_lines else None,
            )
            if default_line:
                parts = (
                    default_line
                    .replace("(Default)", "")
                    .replace("*", "")
                    .strip()
                    .split()
                )
                result["distro"] = parts[0] if parts else None
                details.append(
                    f"Default WSL distro: {result['distro']}"
                )
            else:
                details.append(f"WSL distros found: {len(data_lines)}")
        else:
            details.append(f"WSL distros:\n{stdout[:200]}")
    else:
        details.append(f"Could not list WSL distros: {stderr[:100]}")

    # ── Step 3: Is ROS2 available inside WSL? ──
    # Source the ROS2 setup script to get the correct PATH.
    rc, stdout, stderr = await _run_wsl_bash(
        "source /opt/ros/humble/setup.bash 2>/dev/null "
        "&& which ros2 2>/dev/null "
        "&& echo ROS2_OK "
        "|| echo NOT_FOUND"
    )
    logger.info("ROS2 check: rc=%s stdout=%r stderr=%r", rc, stdout[:80], stderr[:80])
    if rc == 0 and stdout and "NOT_FOUND" not in stdout:
        result["ros2_available"] = True
        details.append("ROS2 Humble detected")
    else:
        details.append(
            "ROS2 not found inside WSL. Install with: "
            "sudo apt install ros-humble-desktop"
        )

    # ── Step 4: Is Gazebo available inside WSL? ──
    rc, stdout, stderr = await _run_wsl_bash(
        "source /opt/ros/humble/setup.bash 2>/dev/null "
        "&& which gzserver 2>/dev/null "
        "|| echo NOT_FOUND"
    )
    logger.info("Gazebo check: rc=%s stdout=%r stderr=%r", rc, stdout[:80], stderr[:80])
    if rc == 0 and stdout and "NOT_FOUND" not in stdout:
        result["gazebo_available"] = True
        details.append("Gazebo (gzserver) found in WSL")
    else:
        details.append(
            "Gazebo not found inside WSL. Install with: "
            "sudo apt install ros-humble-gazebo-ros"
        )

    # ── Step 5: Check WSLg (GUI support) ──
    # Non-blocking — only informational. WSLg may need extra config.
    rc, stdout, stderr = await _run_wsl_bash(
        "source /opt/ros/humble/setup.bash 2>/dev/null; echo $DISPLAY"
    )
    if rc == 0 and stdout and stdout.strip():
        details.append(f"WSL display detected: DISPLAY={stdout.strip()}")
    else:
        details.append(
            "No DISPLAY variable — WSLg may not be available. "
            "Gazebo GUI won't render."
        )

    return result
