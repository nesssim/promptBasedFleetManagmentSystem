"""GET /system/env-check — Detect ROS2/Gazebo availability on this Linux host.

Gates the "Launch Mission" button behind an environment check.
If ROS2 Humble or Gazebo is not installed, the user gets a clear message.
"""

import asyncio
import logging
import subprocess

from fastapi import APIRouter

logger = logging.getLogger(__name__)

router = APIRouter()


def _run_check(command: str, timeout: float = 10.0) -> tuple[int, str, str]:
    """Run a shell command and return (returncode, stdout, stderr)."""
    try:
        result = subprocess.run(
            ["bash", "-lc", command],
            capture_output=True,
            timeout=timeout,
        )
        return (
            result.returncode,
            result.stdout.decode(errors="replace").strip(),
            result.stderr.decode(errors="replace").strip(),
        )
    except subprocess.TimeoutExpired:
        return (-1, "", f"Command timed out after {timeout}s")
    except Exception as e:
        return (-1, "", str(e))


@router.get("/system/env-check")
async def check_environment():
    """Probe ROS2 and Gazebo availability on this host.

    Returns:
      - ros2_available: bool
      - gazebo_available: bool
      - turtlebot3_available: bool
      - details: list of check messages
    """
    details: list[str] = []
    result = {
        "ros2_available": False,
        "gazebo_available": False,
        "turtlebot3_available": False,
        "details": details,
    }

    # Check ROS2
    rc, stdout, _ = _run_check(
        "source /opt/ros/humble/setup.bash 2>/dev/null "
        "&& which ros2 2>/dev/null "
        "&& echo OK || echo NOT_FOUND"
    )
    if rc == 0 and "NOT_FOUND" not in stdout:
        result["ros2_available"] = True
        details.append("ROS2 Humble detected")
    else:
        details.append("ROS2 not found. Install with: sudo apt install ros-humble-desktop")

    # Check Gazebo
    rc, stdout, _ = _run_check(
        "source /opt/ros/humble/setup.bash 2>/dev/null "
        "&& which gzserver 2>/dev/null "
        "&& echo OK || echo NOT_FOUND"
    )
    if rc == 0 and "NOT_FOUND" not in stdout:
        result["gazebo_available"] = True
        details.append("Gazebo (gzserver) found")
    else:
        details.append("Gazebo not found. Install with: sudo apt install ros-humble-gz-sim")

    # Check TurtleBot3 packages
    rc, stdout, _ = _run_check(
        "source /opt/ros/humble/setup.bash 2>/dev/null "
        "&& test -d /opt/ros/humble/share/turtlebot3_gazebo "
        "&& echo OK || echo NOT_FOUND"
    )
    if rc == 0 and "NOT_FOUND" not in stdout:
        result["turtlebot3_available"] = True
        details.append("TurtleBot3 Gazebo packages found")
    else:
        details.append(
            "TurtleBot3 packages not found. Install with: "
            "sudo apt install ros-humble-turtlebot3-gazebo"
        )

    # Check DISPLAY (for Gazebo GUI)
    rc, stdout, _ = _run_check("echo $DISPLAY")
    if rc == 0 and stdout.strip():
        details.append(f"Display detected: DISPLAY={stdout.strip()}")
    else:
        details.append("No DISPLAY variable set. Gazebo GUI may not render (headless is fine).")

    return result
