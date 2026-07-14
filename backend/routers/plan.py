"""POST /plan, /correct, /generate — LLM-centered mission planning endpoints.

These are stubs until Phase 2 (dag_validator.py + LLM service) is implemented.
"""

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel, Field
from typing import Optional

from backend.models import MissionPhase
from backend.session import session_store

router = APIRouter()


class PlanRequest(BaseModel):
    mission: str = Field(..., min_length=1, description="Natural language mission description")
    session_id: str = ""


class CorrectRequest(BaseModel):
    correction: str = Field(..., min_length=1, description="Correction to the current plan")
    session_id: str = ""


class GenerateRequest(BaseModel):
    session_id: str = ""


class PlanResponse(BaseModel):
    session_id: str
    phase: str
    plan: Optional[dict] = None
    dag: Optional[dict] = None
    corrections_remaining: int = 3


@router.post("/plan", response_model=PlanResponse)
async def plan_mission(request: Request, body: PlanRequest):
    """Phase 1: Natural language → structured plan.

    State: IDLE → PLANNING → PLAN_READY
    """
    sid, session = session_store.get_or_create(body.session_id)

    if not session_store.transition(
        sid,
        from_phases=[MissionPhase.IDLE, MissionPhase.PLAN_READY],
        to=MissionPhase.PLANNING,
    ):
        raise HTTPException(
            409,
            f"Cannot plan from state {session.phase.value}. "
            f"Kill current mission first.",
        )

    # Stub: will call LLM Phase 1 via llm_service.phase1_analyst()
    session.current_plan = {
        "mission": body.mission,
        "robot_count": session.robot_count,
        "flows": [
            {
                "id": "flow_1",
                "description": f"Process: {body.mission}",
                "tasks_count": 4,
                "estimated_duration_s": 120,
            }
        ],
    }
    session.conversation_history.append({"role": "user", "content": body.mission})
    session.conversation_history.append(
        {"role": "assistant", "content": str(session.current_plan)}
    )
    session.correction_count = 0

    session_store.transition(
        sid,
        from_phases=[MissionPhase.PLANNING],
        to=MissionPhase.PLAN_READY,
    )

    return PlanResponse(
        session_id=sid,
        phase=session.phase.value,
        plan=session.current_plan,
        corrections_remaining=3,
    )


@router.post("/correct", response_model=PlanResponse)
async def correct_plan(request: Request, body: CorrectRequest):
    """Revise the current plan with a natural language correction.

    State: PLAN_READY → PLANNING (re-runs Phase 1)
    Max 3 corrections per mission. Convergence guard via SHA-256.
    """
    sid, session = session_store.get_or_create(body.session_id)

    if session.correction_count >= 3:
        raise HTTPException(429, "Maximum 3 corrections per mission reached.")

    if not session_store.transition(
        sid,
        from_phases=[MissionPhase.PLAN_READY],
        to=MissionPhase.PLANNING,
    ):
        raise HTTPException(
            409,
            f"Cannot correct from state {session.phase.value}.",
        )

    # Stub: will append correction and re-run LLM Phase 1
    session.correction_count += 1
    session.conversation_history.append({"role": "user", "content": f"Correction: {body.correction}"})

    session_store.transition(
        sid,
        from_phases=[MissionPhase.PLANNING],
        to=MissionPhase.PLAN_READY,
    )

    return PlanResponse(
        session_id=sid,
        phase=session.phase.value,
        plan=session.current_plan,
        corrections_remaining=3 - session.correction_count,
    )


@router.post("/generate", response_model=PlanResponse)
async def generate_dag(request: Request, body: GenerateRequest):
    """Phase 2: Structured plan → validated JSON DAG.

    State: PLAN_READY → GENERATING → DAG_READY
    """
    sid, session = session_store.get_or_create(body.session_id)

    if not session_store.transition(
        sid,
        from_phases=[MissionPhase.PLAN_READY],
        to=MissionPhase.GENERATING,
    ):
        raise HTTPException(
            409,
            f"Cannot generate from state {session.phase.value}. "
            f"Must have a plan ready first.",
        )

    if not session.current_plan:
        session_store.transition(
            sid, from_phases=[MissionPhase.GENERATING], to=MissionPhase.ERROR
        )
        raise HTTPException(400, "No plan to generate from. Call /plan first.")

    # Stub: will call LLM Phase 2 via llm_service.phase2_dag(), then
    # validate via dag_validator.create_task_dag()
    session.current_dag = {
        "mission_id": "stub-mission-id",
        "robot_count": session.robot_count,
        "robots": [
            {"id": f"robot_{i}", "type": "burger", "home": "dock_1"}
            for i in range(1, session.robot_count + 1)
        ],
        "tasks": [
            {
                "id": "t1",
                "type": "navigate",
                "location": "zone_A",
                "depends_on": [],
                "duration_s": 30,
                "assigned_to": "robot_1",
            }
        ],
        "locations": {
            "dock_1": {"x": -4.0, "y": 0.0},
            "zone_A": {"x": 2.0, "y": -3.0},
        },
        "metadata": {"generated_by": "stub"},
    }

    session_store.transition(
        sid,
        from_phases=[MissionPhase.GENERATING],
        to=MissionPhase.DAG_READY,
    )

    return PlanResponse(
        session_id=sid,
        phase=session.phase.value,
        plan=session.current_plan,
        dag=session.current_dag,
        corrections_remaining=3 - session.correction_count,
    )
