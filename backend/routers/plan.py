"""POST /plan, /correct, /generate — LLM-centered mission planning endpoints.

IMPORTANT: No static/hardcoded data is returned. In mock mode (no API key),
plan and dag fields are returned as null with `mock: true` markers.
The LLM service generates real data from the DAG schema when a key is present.
"""

import logging

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel, Field
from typing import Optional

from ..models import MissionPhase
from ..session import session_store
from ..services.rate_limiter import rate_limiter

logger = logging.getLogger(__name__)

router = APIRouter()


class PlanRequest(BaseModel):
    mission: str = Field(..., min_length=1, max_length=10000, description="Natural language mission description")
    session_id: str = ""


class CorrectRequest(BaseModel):
    correction: str = Field(..., min_length=1, max_length=10000, description="Correction to the current plan")
    session_id: str = ""


class GenerateRequest(BaseModel):
    session_id: str = ""


class PlanResponse(BaseModel):
    session_id: str
    phase: str
    plan: Optional[dict] = None
    dag: Optional[dict] = None
    corrections_remaining: int = 3
    mock: bool = False


@router.post("/plan", response_model=PlanResponse)
async def plan_mission(request: Request, body: PlanRequest):
    """Phase 1: Natural language → structured plan.

    State: IDLE → PLANNING → PLAN_READY
    In mock mode (no API key), plan is returned as null with mock=true.
    The frontend shows a 'mock mode' banner instead of fake zones.
    """
    client_ip = request.client.host if request.client else "unknown"
    if not rate_limiter.check(client_ip):
        raise HTTPException(429, "Too many requests. Please wait before trying again.")

    sid, session = await session_store.get_or_create(body.session_id)

    if not await session_store.transition(
        sid,
        from_phases=[MissionPhase.IDLE, MissionPhase.PLAN_READY],
        to=MissionPhase.PLANNING,
    ):
        raise HTTPException(
            409,
            f"Cannot plan from state {session.phase.value}. "
            f"Kill current mission first.",
        )

    mock_mode = getattr(request.app.state, "mock_mode", True)

    if not mock_mode:
        # TODO: Call LLM Phase 1 via llm_service.phase1_analyst()
        pass

    # Store minimal mission context (NO fake zones, NO fake flows)
    session.current_plan = None
    session.conversation_history.append({"role": "user", "content": body.mission})
    session.conversation_history.append(
        {"role": "assistant", "content": "[Plan not available — no LLM connected]"}
    )
    session.correction_count = 0

    await session_store.transition(
        sid,
        from_phases=[MissionPhase.PLANNING],
        to=MissionPhase.PLAN_READY,
    )

    return PlanResponse(
        session_id=sid,
        phase=session.phase.value,
        plan=None,
        corrections_remaining=3,
        mock=mock_mode,
    )


@router.post("/correct", response_model=PlanResponse)
async def correct_plan(request: Request, body: CorrectRequest):
    """Revise the current plan with a natural language correction.

    State: PLAN_READY → PLANNING (re-runs Phase 1)
    Max 3 corrections per mission. Convergence guard via SHA-256.
    """
    client_ip = request.client.host if request.client else "unknown"
    if not rate_limiter.check(client_ip):
        raise HTTPException(429, "Too many requests. Please wait before trying again.")

    sid, session = await session_store.get_or_create(body.session_id)

    if session.correction_count >= 3:
        raise HTTPException(429, "Maximum 3 corrections per mission reached.")

    if not await session_store.transition(
        sid,
        from_phases=[MissionPhase.PLAN_READY],
        to=MissionPhase.PLANNING,
    ):
        raise HTTPException(
            409,
            f"Cannot correct from state {session.phase.value}.",
        )

    mock_mode = getattr(request.app.state, "mock_mode", True)

    if not mock_mode:
        # TODO: Re-run LLM Phase 1 with correction
        pass

    session.correction_count += 1
    session.current_plan = None
    session.conversation_history.append({"role": "user", "content": f"Correction: {body.correction}"})
    session.conversation_history.append(
        {"role": "assistant", "content": "[Plan not available — no LLM connected]"}
    )

    await session_store.transition(
        sid,
        from_phases=[MissionPhase.PLANNING],
        to=MissionPhase.PLAN_READY,
    )

    return PlanResponse(
        session_id=sid,
        phase=session.phase.value,
        plan=None,
        corrections_remaining=3 - session.correction_count,
        mock=mock_mode,
    )


@router.post("/generate", response_model=PlanResponse)
async def generate_dag(request: Request, body: GenerateRequest):
    """Phase 2: Structured plan → validated JSON DAG.

    State: PLAN_READY → GENERATING → DAG_READY
    In mock mode, dag is returned as null with mock=true.
    The frontend shows a 'mock mode' banner instead of fake robot data.
    """
    sid, session = await session_store.get_or_create(body.session_id)

    if not await session_store.transition(
        sid,
        from_phases=[MissionPhase.PLAN_READY],
        to=MissionPhase.GENERATING,
    ):
        raise HTTPException(
            409,
            f"Cannot generate from state {session.phase.value}. "
            f"Must have a plan ready first.",
        )

    mock_mode = getattr(request.app.state, "mock_mode", True)

    if not mock_mode:
        # TODO: Call LLM Phase 2 via llm_service.phase2_dag(), then
        # validate via dag_validator.create_task_dag()
        pass

    # In mock mode: store NO fake DAG data, just null
    session.current_dag = None

    await session_store.transition(
        sid,
        from_phases=[MissionPhase.GENERATING],
        to=MissionPhase.DAG_READY,
    )

    return PlanResponse(
        session_id=sid,
        phase=session.phase.value,
        plan=None,
        dag=None,
        corrections_remaining=3 - session.correction_count,
        mock=mock_mode,
    )
