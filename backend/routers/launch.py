"""POST /launch and POST /kill — Mission execution lifecycle."""

import asyncio
import logging

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel

from ..models import MissionPhase
from ..session import session_store
from ..services.process_manager import kill_all, clear_pid_file
from ..services.gazebo import GazeboLauncher
from ..services.dag_executor import DAGExecutor
from .. import persistence

logger = logging.getLogger(__name__)

router = APIRouter()


class LaunchResponse(BaseModel):
    status: str
    robot_count: int
    port: int | None = None


_executor_task: asyncio.Task | None = None
_dag_executor: DAGExecutor | None = None


@router.post("/launch")
async def launch_mission(request: Request):
    """Launch Gazebo with N robots, then execute the DAG in the background.

    State guard: only allowed from DAG_READY phase.
    Returns 409 if already running or no DAG ready.
    """
    global _executor_task, _dag_executor

    sid = request.headers.get("X-Session-Id", "")
    _, session = await session_store.get_or_create(sid)

    if not session.current_dag:
        raise HTTPException(
            400,
            "No DAG generated. Complete /plan and /generate first to create a mission DAG.",
        )

    if not await session_store.transition(
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

        # Transition to RUNNING
        await session_store.transition(
            sid,
            from_phases=[MissionPhase.LAUNCHING],
            to=MissionPhase.RUNNING,
        )

        # Start DAG executor as background task
        async def _progress_callback(event):
            """Forward executor events to persistence / websocket."""
            logger.info("DAG event: %s", event)

        _dag_executor = DAGExecutor(
            dag=session.current_dag,
            robot_count=session.robot_count,
            progress_callback=_progress_callback,
        )
        _executor_task = asyncio.create_task(_run_executor(sid, _dag_executor))

        return LaunchResponse(
            status="launched",
            robot_count=session.robot_count,
            port=port,
        )

    except Exception as e:
        logger.error("Launch failed: %s", e)
        if sid:
            await persistence.append_error(sid, f"Launch failed: {e}")
        await session_store.transition(
            sid,
            from_phases=[MissionPhase.LAUNCHING, MissionPhase.DAG_READY],
            to=MissionPhase.ERROR,
        )
        if sid:
            mock_mode = getattr(request.app.state, "mock_mode", True)
            await persistence.save_session_meta(sid, MissionPhase.ERROR.value, session.robot_count, mock_mode)
        raise HTTPException(500, "Launch failed. Check server logs for details.")


async def _run_executor(sid: str, executor: DAGExecutor) -> None:
    """Run the DAG executor in the background. Handles completion/error."""
    global _executor_task
    try:
        result = await executor.run()
        logger.info("DAG execution complete: %s", result)

        # Transition to COMPLETE if all tasks succeeded
        all_ok = all(
            r.get("status") == "completed"
            for r in result.get("results", {}).values()
            if isinstance(r, dict) and "error" not in r
        )

        if all_ok:
            await session_store.transition(
                sid,
                from_phases=[MissionPhase.RUNNING],
                to=MissionPhase.COMPLETE,
            )
            await persistence.save_session_meta(sid, MissionPhase.COMPLETE.value, 0, False)
        else:
            await session_store.transition(
                sid,
                from_phases=[MissionPhase.RUNNING],
                to=MissionPhase.COMPLETE,
            )
            await persistence.append_error(sid, f"DAG execution finished with errors: {result}")

    except asyncio.CancelledError:
        logger.info("DAG executor cancelled")
    except Exception as e:
        logger.error("DAG executor failed: %s", e)
        try:
            await persistence.append_error(sid, f"DAG executor failed: {e}")
            await session_store.transition(
                sid,
                from_phases=[MissionPhase.RUNNING],
                to=MissionPhase.ERROR,
            )
        except Exception:
            pass
    finally:
        _executor_task = None


@router.post("/kill")
async def kill_mission(request: Request):
    """Kill all subprocesses and reset session.

    Idempotent: safe to call multiple times.
    Visible at all times in the UI header.
    """
    global _executor_task, _dag_executor

    # Cancel running DAG executor
    if _dag_executor:
        _dag_executor.cancel()
    if _executor_task and not _executor_task.done():
        _executor_task.cancel()
        try:
            await _executor_task
        except asyncio.CancelledError:
            pass
    _executor_task = None
    _dag_executor = None

    sid = request.headers.get("X-Session-Id", "")

    # Kill all tracked processes
    kill_all()
    clear_pid_file()

    # Reset session
    if sid:
        await session_store.reset(sid)

    return {"status": "killed", "phase": "idle"}


@router.post("/complete")
async def complete_mission(request: Request):
    """Transition from RUNNING to COMPLETE.

    Called by the fleet coordinator when all tasks are done.
    """
    sid = request.headers.get("X-Session-Id", "")
    if not sid:
        raise HTTPException(400, "X-Session-Id header required")

    if not await session_store.transition(
        sid,
        from_phases=[MissionPhase.RUNNING],
        to=MissionPhase.COMPLETE,
    ):
        session = session_store.get(sid)
        phase = session.phase.value if session else "unknown"
        raise HTTPException(
            409,
            f"Cannot complete from state {phase}. Must be RUNNING.",
        )

    mock_mode = getattr(request.app.state, "mock_mode", True)
    await persistence.save_session_meta(sid, MissionPhase.COMPLETE.value, 0, mock_mode)
    await persistence.append_decision(sid, "Mission completed")

    return {"status": "complete", "phase": "complete"}
