"""Session store with state machine guards.

The backend is the single source of truth for mission phase.
The browser reflects backend state via WebSocket phase_change messages.
"""

import uuid
from backend.models import MissionPhase, SessionState


class SessionStore:
    """In-memory session storage keyed by UUID.

    Known limitation: lost on backend restart. Mission history in
    data/missions.json survives restarts.
    """

    def __init__(self):
        self._sessions: dict[str, SessionState] = {}

    def get_or_create(self, session_id: str | None = None) -> tuple[str, SessionState]:
        """Retrieve existing session or create a new one.

        Returns (session_id, SessionState).
        """
        if not session_id or session_id not in self._sessions:
            session_id = str(uuid.uuid4())
            self._sessions[session_id] = SessionState()
        return session_id, self._sessions[session_id]

    def transition(
        self, session_id: str, from_phases: list[MissionPhase], to: MissionPhase
    ) -> bool:
        """Attempt a state transition with guard.

        Returns True if transition succeeded, False if current phase
        is not in from_phases (caller should return 409).
        """
        session = self._sessions.get(session_id)
        if not session or session.phase not in from_phases:
            return False
        session.phase = to
        return True

    def get(self, session_id: str) -> SessionState | None:
        """Get session by ID without creating."""
        return self._sessions.get(session_id)

    def reset(self, session_id: str) -> bool:
        """Reset session to IDLE. Returns False if session not found."""
        session = self._sessions.get(session_id)
        if not session:
            return False
        session.reset()
        return True


# Global singleton
session_store = SessionStore()
