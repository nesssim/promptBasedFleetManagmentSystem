"""File-based persistence for sessions (meta, chat, plan, errors, decisions).

All data stored under ~/.missionswarm/sessions/{id}/ as JSON files.
Prefs stored at ~/.missionswarm/prefs.json.
"""

import asyncio
import json
import logging
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DATA_DIR = Path.home() / ".missionswarm"
SESSIONS_DIR = DATA_DIR / "sessions"
INDEX_FILE = SESSIONS_DIR / "index.json"
PREFS_FILE = DATA_DIR / "prefs.json"

_file_lock = asyncio.Lock()

# ── helpers ──

_SESSION_ID_RE = re.compile(r'^[a-f0-9]{16,32}$')


def _ensure_dirs():
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)


def _validate_session_id(sid: str) -> None:
    """Reject session IDs that could enable path traversal."""
    if not isinstance(sid, str) or not _SESSION_ID_RE.match(sid):
        raise ValueError(f"Invalid session ID: {sid!r}")


def _session_dir(sid: str) -> Path:
    return SESSIONS_DIR / sid


def _read_json(path: Path):
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("Failed to read %s: %s", path, exc)
        return None


def _write_json(path: Path, data):
    path.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")


# ── session lifecycle ──


async def save_session_meta(sid: str, phase: str, robot_count: int, mock: bool = False):
    """Create or update a session's meta file."""
    _validate_session_id(sid)
    async with _file_lock:
        _ensure_dirs()
        _session_dir(sid).mkdir(parents=True, exist_ok=True)
        path = _session_dir(sid) / "meta.json"
        existing = _read_json(path) or {}
        now = datetime.now(timezone.utc).isoformat()
        existing.update(
            session_id=sid,
            phase=phase,
            robot_count=robot_count,
            mock=mock,
            updated_at=now,
            created_at=existing.get("created_at", now),
        )
        _write_json(path, existing)
        _update_index(sid, phase, robot_count, existing.get("created_at", now), mock)


def _update_index(sid: str, phase: str, robot_count: int, created_at: str, mock: bool = False):
    """Maintain a lightweight index for fast session listing."""
    index = _read_json(INDEX_FILE) or {"sessions": []}
    entries = {e["session_id"]: e for e in index["sessions"]}
    entries[sid] = {
        "session_id": sid,
        "phase": phase,
        "robot_count": robot_count,
        "created_at": created_at,
        "mock": mock,
    }
    index["sessions"] = sorted(entries.values(), key=lambda e: e["created_at"], reverse=True)
    _write_json(INDEX_FILE, index)


def get_session_meta(sid: str) -> Optional[dict]:
    """Read a single session's meta file."""
    _validate_session_id(sid)
    return _read_json(_session_dir(sid) / "meta.json")


async def clear_session_data(sid: str):
    """Delete all data files for a session (chat, plan, decisions, errors).

    Useful before restoring an archived session to the same ID.
    Leaves meta.json intact.
    """
    _validate_session_id(sid)
    async with _file_lock:
        d = _session_dir(sid)
        for name in ("chat.json", "plan.json", "decisions.json", "errors.json"):
            p = d / name
            if p.exists():
                p.unlink()


# ── chat ──


async def append_chat(sid: str, role: str, content: str):
    """Append a single chat message."""
    _validate_session_id(sid)
    async with _file_lock:
        _ensure_dirs()
        _session_dir(sid).mkdir(parents=True, exist_ok=True)
        path = _session_dir(sid) / "chat.json"
        msgs = _read_json(path) or []
        msgs.append({"role": role, "content": content, "timestamp": time.time()})
        _write_json(path, msgs)


def get_chat(sid: str) -> list:
    """Return full chat history."""
    _validate_session_id(sid)
    return _read_json(_session_dir(sid) / "chat.json") or []


# ── plan / dag ──


async def save_plan(sid: str, plan_data: dict):
    """Persist the current plan and DAG data."""
    _validate_session_id(sid)
    async with _file_lock:
        _ensure_dirs()
        _session_dir(sid).mkdir(parents=True, exist_ok=True)
        path = _session_dir(sid) / "plan.json"
        existing = _read_json(path) or {}
        existing.update(plan_data, updated_at=time.time())
        _write_json(path, existing)


def get_plan(sid: str) -> Optional[dict]:
    """Return the persisted plan/DAG."""
    _validate_session_id(sid)
    return _read_json(_session_dir(sid) / "plan.json")


# ── decisions ──


async def append_decision(sid: str, decision: str):
    """Log a decision (correction, generation, etc.)."""
    _validate_session_id(sid)
    async with _file_lock:
        _ensure_dirs()
        _session_dir(sid).mkdir(parents=True, exist_ok=True)
        path = _session_dir(sid) / "decisions.json"
        entries = _read_json(path) or []
        entries.append({"decision": decision, "timestamp": time.time()})
        _write_json(path, entries)


def get_decisions(sid: str) -> list:
    _validate_session_id(sid)
    return _read_json(_session_dir(sid) / "decisions.json") or []


# ── errors ──


async def append_error(sid: str, error_message: str):
    """Log a server-side error."""
    _validate_session_id(sid)
    async with _file_lock:
        _ensure_dirs()
        _session_dir(sid).mkdir(parents=True, exist_ok=True)
        path = _session_dir(sid) / "errors.json"
        entries = _read_json(path) or []
        entries.append({"error": error_message, "timestamp": time.time()})
        _write_json(path, entries)


def get_errors(sid: str) -> list:
    _validate_session_id(sid)
    return _read_json(_session_dir(sid) / "errors.json") or []


# ── full session ──


def load_session_meta(sid: str) -> Optional[dict]:
    """Load a session's meta file, or None if missing."""
    try:
        _validate_session_id(sid)
        path = _session_dir(sid) / "meta.json"
        return _read_json(path)
    except Exception:
        return None


def load_full_session(sid: str) -> Optional[dict]:
    """Load every data file for a session into a single dict.

    Returns None if the session ID is invalid, missing, or data is corrupt.
    Never raises — the history router turns None into a 404.
    """
    try:
        _validate_session_id(sid)
    except ValueError:
        return None
    meta = get_session_meta(sid)
    if not meta:
        return None
    return {
        "meta": meta,
        "chat": get_chat(sid),
        "plan": get_plan(sid),
        "decisions": get_decisions(sid),
        "errors": get_errors(sid),
    }


# ── listing ──


def list_sessions() -> list[dict]:
    """Return all session summaries, newest first.

    Silently skips entries with invalid or missing session directories,
    and sessions with no chat messages.
    """
    index = _read_json(INDEX_FILE)
    if not index:
        return []
    valid = []
    for entry in index.get("sessions", []):
        sid = entry.get("session_id", "")
        try:
            _validate_session_id(sid)
        except ValueError:
            continue
        if not _session_dir(sid).exists():
            continue
        chat_path = _session_dir(sid) / "chat.json"
        if not chat_path.exists():
            continue
        chat = _read_json(chat_path)
        if not chat or len(chat) == 0:
            continue
        valid.append(entry)
    return valid


# ── prefs (persistent user settings) ──


def load_prefs() -> dict:
    """Load user preferences. Returns defaults if file missing."""
    prefs = _read_json(PREFS_FILE)
    if prefs:
        return prefs
    defaults = {"default_robot_count": 3}
    _write_json(PREFS_FILE, defaults)
    return defaults


async def save_prefs(updates: dict):
    """Merge updates into prefs and persist."""
    async with _file_lock:
        prefs = load_prefs()
        prefs.update(updates)
        _write_json(PREFS_FILE, prefs)
