"""Cross-platform WSL executable resolution and command helpers.

On Windows, the ``wsl`` executable may not be found by Python's
``shutil.which`` if the process's PATH is incomplete (e.g. when
started by a process manager or ``Start-Process -WindowStyle Hidden``).
This module resolves the full path using multiple strategies:

1. ``shutil.which("wsl")`` — works when PATH is complete
2. Well-known hardcoded paths — ``C:\\Windows\\System32\\wsl.exe``
3. ``cmd.exe /c where wsl`` — uses Windows' own PATH resolution
"""

import asyncio
import logging
import os
import platform
import shutil

logger = logging.getLogger(__name__)

_IS_WINDOWS = platform.system() == "Windows"

# Well-known locations for wsl.exe on Windows
_WSL_KNOWN_PATHS = [
    r"C:\Windows\System32\wsl.exe",
    r"C:\Windows\System32\wsl.EXE",
]

_resolved_wsl: str | None = None


def _try_resolve() -> str | None:
    """Try all strategies to find the wsl executable."""
    # Strategy 1: shutil.which (respects current PATH)
    for name in ("wsl", "wsl.exe"):
        found = shutil.which(name)
        if found:
            return found

    # Strategy 2: Check well-known paths
    for path in _WSL_KNOWN_PATHS:
        if os.path.isfile(path):
            return path

    # Strategy 3: Use `cmd.exe /c where wsl` which uses Windows'
    # own PATH resolution (more thorough than Python's)
    try:
        import subprocess
        result = subprocess.run(
            ["cmd.exe", "/c", "where", "wsl"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            first_line = result.stdout.strip().split("\n")[0].strip()
            if os.path.isfile(first_line):
                return first_line
    except Exception:
        pass

    return None


def get_wsl_path() -> str | None:
    """Return the resolved full path to wsl.exe, or None if not found.

    Result is cached after first successful resolution.
    """
    global _resolved_wsl
    if _resolved_wsl is not None:
        return _resolved_wsl

    if not _IS_WINDOWS:
        return None

    _resolved_wsl = _try_resolve()
    if _resolved_wsl:
        logger.info("Resolved WSL executable: %s", _resolved_wsl)
    else:
        logger.warning(
            "Could not resolve 'wsl' executable. "
            "Checked: shutil.which, known paths, cmd.exe /c where"
        )
    return _resolved_wsl


def wsl_cmd(*args: str) -> list[str]:
    """Build a command list prefixed with the WSL executable path.

    On Linux, returns ``list(args)`` (no prefix needed).
    On Windows, returns ``["C:\\...\\wsl.exe", *args]``.

    Raises FileNotFoundError if WSL is not found on Windows.
    """
    if not _IS_WINDOWS:
        return list(args)

    path = get_wsl_path()
    if path is None:
        raise FileNotFoundError(
            "WSL executable not found. Install WSL 2 with: wsl --install -d Ubuntu"
        )
    return [path, *args]


def wsl_path_to_linux(windows_path: str) -> str:
    """Convert a Windows path to a WSL Linux path.

    ``C:\\foo\\bar`` → ``/mnt/c/foo/bar``
    """
    if not _IS_WINDOWS:
        return windows_path
    if len(windows_path) > 1 and windows_path[1] == ":":
        drive = windows_path[0].lower()
        rest = windows_path[2:].replace("\\", "/")
        return f"/mnt/{drive}{rest}"
    return windows_path.replace("\\", "/")
