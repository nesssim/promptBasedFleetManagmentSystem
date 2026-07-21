"""Session state management with TTL and atomic transitions."""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional

from .models import MissionPhase, SessionState

SESSION_TTL = timedelta(hours=1)
MAX_SESSIONS = 1000


class SessionStore:
    """Thread-safe session store with TTL-based expiry."""

    VALID_TRANSITIONS: dict[MissionPhase, list[MissionPhase]] = {
        MissionPhase.IDLE: [MissionPhase.PLANNING],
        MissionPhase.PLANNING: [MissionPhase.PLAN_READY],
        MissionPhase.PLAN_READY: [MissionPhase.GENERATING, MissionPhase.PLANNING],
        MissionPhase.GENERATING: [MissionPhase.DAG_READY],
        MissionPhase.DAG_READY: [MissionPhase.LAUNCHING],
        MissionPhase.LAUNCHING: [MissionPhase.RUNNING, MissionPhase.IDLE, MissionPhase.ERROR],
        MissionPhase.RUNNING: [MissionPhase.IDLE],
        MissionPhase.COMPLETE: [MissionPhase.IDLE],
        MissionPhase.ERROR: [MissionPhase.IDLE, MissionPhase.PLANNING, MissionPhase.GENERATING, MissionPhase.LAUNCHING],
    }

    def __init__(self):
        self._sessions: dict[str, SessionState] = {}
        self._lock = asyncio.Lock()
        self._cleanup_task: Optional[asyncio.Task] = None

    def start_cleanup(self) -> None:
        """Start periodic cleanup of expired sessions."""
        if self._cleanup_task is None:
            self._cleanup_task = asyncio.create_task(self._cleanup_loop())

    async def _cleanup_loop(self) -> None:
        """Run every 5 minutes, evict expired sessions."""
        while True:
            await asyncio.sleep(300)
            await self._evict_expired()

    async def _evict_expired(self) -> None:
        """Remove sessions past their TTL."""
        now = datetime.now()
        async with self._lock:
            expired = [
                sid
                for sid, state in self._sessions.items()
                if now - state.last_accessed > SESSION_TTL
            ]
            for sid in expired:
                del self._sessions[sid]
            if expired:
                logger.info("Evicted %s expired session(s)", len(expired))

    async def get_or_create(self, session_id: str = "") -> tuple[str, SessionState]:
        """Get existing session or create new one. Returns (id, state)."""
        async with self._lock:
            sid = (
                session_id
                if (session_id and session_id in self._sessions)
                else uuid.uuid4().hex
            )
            if sid not in self._sessions:
                if len(self._sessions) >= MAX_SESSIONS:
                    raise RuntimeError("Maximum session limit reached")
                self._sessions[sid] = SessionState()
            state = self._sessions[sid]
            state.touch()
            return sid, state

    async def transition(
        self,
        session_id: str,
        from_phases: list[MissionPhase],
        to: MissionPhase,
    ) -> bool:
        """Atomically transition session state if current phase is in from_phases."""
        async with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                return False
            if session.phase not in from_phases:
                return False
            if to not in self.VALID_TRANSITIONS.get(session.phase, []):
                return False
            session.phase = to
            session.touch()
            return True

    async def get(self, session_id: str) -> Optional[SessionState]:
        """Get session without creating. Does not touch (read-only)."""
        async with self._lock:
            return self._sessions.get(session_id)

    async def get_info(self, session_id: str) -> Optional[dict]:
        """Return public session info for frontend restore."""
        async with self._lock:
            state = self._sessions.get(session_id)
            if not state:
                return None
            return {
                "session_id": session_id,
                "phase": state.phase.value,
                "robot_count": state.robot_count,
            }


    async def reset(self, session_id: str) -> None:
        """Reset session state to IDLE."""
        async with self._lock:
            state = self._sessions.get(session_id)
            if state:
                state.reset()

    async def create(self, session_id: str, robot_count: int = 3) -> SessionState:
        """Create a new session with a known ID. Raises if ID already exists."""
        async with self._lock:
            if session_id in self._sessions:
                raise RuntimeError(f"Session {session_id} already exists")
            if len(self._sessions) >= MAX_SESSIONS:
                raise RuntimeError("Maximum session limit reached")
            state = SessionState(robot_count=robot_count)
            self._sessions[session_id] = state
            return state

    async def set_phase(self, session_id: str, phase: MissionPhase) -> None:
        """Unconditionally set the phase (used during restore)."""
        async with self._lock:
            state = self._sessions.get(session_id)
            if state:
                state.phase = phase
                state.touch()


# Global singleton
logger = logging.getLogger(__name__)
session_store = SessionStore()
