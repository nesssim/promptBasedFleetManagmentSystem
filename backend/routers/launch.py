"""POST /launch and POST /kill — Mission execution lifecycle."""

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel

from backend.models import MissionPhase
from backend.session import session_store
from backend.services.process_manager import kill_all, clear_pid_file
from backend.services.gazebo import GazeboLauncher

router = APIRouter()


class LaunchResponse(BaseModel):
    status: str
    robot_count: int
    port: int | None = None


@router.post("/launch")
async def launch_mission(request: Request):
    """Launch Gazebo with N robots and send DAG to FleetCoordinator.

    State guard: only allowed from DAG_READY phase.
    Returns 409 if already running or no DAG ready.
    """
    sid = request.headers.get("X-Session-Id", "")
    _, session = session_store.get_or_create(sid)

    if not session_store.transition(
        sid,
        from_phases=[MissionPhase.DAG_READY, MissionPhase.IDLE],
        to=MissionPhase.LAUNCHING,
    ):
        raise HTTPException(
            409,
            f"Invalid state transition from {session.phase.value}. "
            f"Must be in dag_ready or idle. Kill current mission first.",
        )

    try:
        # Launch Gazebo + robots
        launcher = GazeboLauncher()
        port = await launcher.launch(session.robot_count)

        # TODO: Send DAG via ros2 param set (Phase 3)

        session_store.transition(
            sid,
            from_phases=[MissionPhase.LAUNCHING],
            to=MissionPhase.RUNNING,
        )

        return LaunchResponse(
            status="launched",
            robot_count=session.robot_count,
            port=port,
        )

    except Exception as e:
        session_store.transition(
            sid,
            from_phases=[MissionPhase.LAUNCHING, MissionPhase.DAG_READY],
            to=MissionPhase.ERROR,
        )
        raise HTTPException(500, f"Launch failed: {str(e)}")


@router.post("/kill")
async def kill_mission(request: Request):
    """Kill all subprocesses and reset session.

    Idempotent: safe to call multiple times.
    Visible at all times in the UI header.
    """
    sid = request.headers.get("X-Session-Id", "")

    # Kill all tracked processes
    kill_all()
    clear_pid_file()

    # Reset session
    if sid:
        session_store.reset(sid)

    return {"status": "killed", "phase": "idle"}
