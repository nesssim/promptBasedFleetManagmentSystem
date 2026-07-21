"""POST /config — Set robot count for the session."""

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel, Field

from ..session import session_store

router = APIRouter()


class ConfigRequest(BaseModel):
    robot_count: int = Field(default=3, ge=1, le=6)
    session_id: str = ""


class ConfigResponse(BaseModel):
    session_id: str
    robot_count: int
    phase: str
    mock: bool = False


@router.post("/config", response_model=ConfigResponse)
async def set_config(request: Request, body: ConfigRequest):
    """Set the robot count for this session.

    Idempotent: calling multiple times with the same value is safe.
    The API key is set via backend .env file, not via this endpoint.
    """
    sid, session = await session_store.get_or_create(body.session_id)
    session.robot_count = body.robot_count

    mock_mode = getattr(request.app.state, "mock_mode", True)

    return ConfigResponse(
        session_id=sid,
        robot_count=session.robot_count,
        phase=session.phase.value,
        mock=mock_mode,
    )


class SessionRestore(BaseModel):
    session_id: str
    phase: str
    robot_count: int


@router.get("/session/{session_id}", response_model=SessionRestore)
async def restore_session(session_id: str):
    """Return current session state for frontend page-reload restore.

    Returns 404 if session expired or never existed.
    """
    info = await session_store.get_info(session_id)
    if not info:
        raise HTTPException(404, "Session not found or expired")
    return SessionRestore(**info)
