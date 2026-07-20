"""History and session persistence endpoints."""

import logging
import uuid

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel, Field
from typing import Optional

from ..models import MissionPhase
from ..session import session_store
from .. import persistence

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Session listing ──


class SessionSummary(BaseModel):
    session_id: str
    phase: str
    robot_count: int
    created_at: str
    mock: bool = False


class SessionListResponse(BaseModel):
    sessions: list[SessionSummary]


@router.get("/sessions", response_model=SessionListResponse)
async def list_sessions():
    """List all persisted sessions, newest first."""
    raw = persistence.list_sessions()
    return SessionListResponse(sessions=[SessionSummary(**s) for s in raw])


# ── Full session detail ──


class FullSessionResponse(BaseModel):
    meta: dict
    chat: list
    plan: Optional[dict] = None
    decisions: list
    errors: list


@router.get("/sessions/{session_id}", response_model=FullSessionResponse)
async def get_session_detail(session_id: str):
    """Return full session detail (chat, plan, decisions, errors)."""
    data = persistence.load_full_session(session_id)
    if not data:
        raise HTTPException(404, "Session not found")
    return FullSessionResponse(**data)


# ── Restore ──


class RestoreResponse(BaseModel):
    session_id: str
    phase: str
    robot_count: int
    plan: Optional[dict] = None
    dag: Optional[dict] = None
    mock: bool = False


@router.post("/sessions/{session_id}/restore")
async def restore_workflow(request: Request, session_id: str):
    """Restore an archived session's plan/DAG into the current (or new) session.

    Does NOT create a duplicate — reuses the active session ID when possible,
    or the archived session ID itself.
    """
    archived = persistence.load_full_session(session_id)
    if not archived:
        raise HTTPException(404, "Archived session not found")

    archived_plan = archived.get("plan") or {}
    robot_count = archived_plan.get("robot_count") or archived["meta"].get("robot_count", 3)

    # Reuse the archived session_id itself as the target (no duplicate)
    target_sid = session_id

    # Create or reset + populate the session in the store
    try:
        session = await session_store.create(target_sid, robot_count=int(robot_count))
    except RuntimeError:
        # Session already exists in store — reset and reuse it
        await session_store.reset(target_sid)
        session_obj = await session_store.get(target_sid)
        if session_obj is None:
            raise HTTPException(500, "Failed to access session after reset")
        session_obj.robot_count = int(robot_count)
        session = session_obj
    session.current_plan = archived_plan.get("current_plan")
    session.current_dag = archived_plan.get("current_dag")

    for msg in archived.get("chat", []):
        session.conversation_history.append({
            "role": msg.get("role", "user"),
            "content": msg.get("content", ""),
        })

    # Set phase based on what was restored
    if session.current_dag:
        phase = MissionPhase.DAG_READY
    elif session.current_plan:
        phase = MissionPhase.PLAN_READY
    else:
        phase = MissionPhase.IDLE
    await session_store.set_phase(target_sid, phase)

    mock_mode = getattr(request.app.state, "mock_mode", True)

    # Clear stale data, then persist (overwrite, no duplicate)
    await persistence.clear_session_data(target_sid)
    await persistence.save_session_meta(target_sid, phase.value, session.robot_count, mock_mode)
    for msg in archived.get("chat", []):
        await persistence.append_chat(target_sid, msg.get("role", "user"), msg.get("content", ""))
    if session.current_plan:
        await persistence.save_plan(target_sid, {
            "current_plan": session.current_plan,
            "current_dag": session.current_dag,
            "robot_count": session.robot_count,
        })
    await persistence.append_decision(target_sid, f"Restored session {session_id}")

    return RestoreResponse(
        session_id=target_sid,
        phase=phase.value,
        robot_count=session.robot_count,
        plan=session.current_plan,
        dag=session.current_dag,
        mock=mock_mode,
    )


# ── Chat history for a session ──


class ChatHistoryResponse(BaseModel):
    messages: list


@router.get("/sessions/{session_id}/chat", response_model=ChatHistoryResponse)
async def get_chat_history(session_id: str):
    """Return chat messages for an archived session."""
    msgs = persistence.get_chat(session_id)
    return ChatHistoryResponse(messages=msgs)


# ── Preferences ──


class PrefsResponse(BaseModel):
    default_robot_count: int = 3


class PrefsUpdate(BaseModel):
    default_robot_count: int = Field(default=3, ge=1, le=6)


@router.get("/config/prefs", response_model=PrefsResponse)
async def get_prefs():
    """Return persistent user preferences."""
    prefs = persistence.load_prefs()
    return PrefsResponse(**prefs)


@router.put("/config/prefs", response_model=PrefsResponse)
async def update_prefs(body: PrefsUpdate):
    """Update persistent user preferences."""
    await persistence.save_prefs({"default_robot_count": body.default_robot_count})
    return PrefsResponse(default_robot_count=body.default_robot_count)
