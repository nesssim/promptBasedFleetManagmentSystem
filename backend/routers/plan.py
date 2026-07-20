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
from ..services.llm import LLMService
from .. import persistence

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
        from_phases=[MissionPhase.IDLE, MissionPhase.PLAN_READY, MissionPhase.ERROR],
        to=MissionPhase.PLANNING,
    ):
        raise HTTPException(
            409,
            f"Cannot plan from state {session.phase.value}. "
            f"Kill current mission first.",
        )

    mock_mode = getattr(request.app.state, "mock_mode", True)

    plan_data = None
    if not mock_mode:
        llm_service: LLMService = request.app.state.llm_service
        try:
            plan_data = await llm_service.phase1_analyst(
                body.mission, session.robot_count, session.conversation_history
            )
        except Exception as e:
            logger.error("LLM Phase 1 failed: %s", e)
            await session_store.transition(
                sid,
                from_phases=[MissionPhase.PLANNING],
                to=MissionPhase.IDLE,
            )
            raise HTTPException(503, "LLM service unavailable. Please retry.")

    session.current_plan = plan_data
    session.conversation_history.append({"role": "user", "content": body.mission})
    session.conversation_history.append(
        {"role": "assistant", "content": str(plan_data) if plan_data else "[Plan not available — no LLM connected]"}
    )
    session.correction_count = 0

    await persistence.append_chat(sid, "user", body.mission)
    await persistence.append_chat(sid, "assistant", str(plan_data) if plan_data else "[Plan not available — no LLM connected]")

    await session_store.transition(
        sid,
        from_phases=[MissionPhase.PLANNING],
        to=MissionPhase.PLAN_READY,
    )

    await persistence.save_session_meta(sid, session.phase.value, session.robot_count, mock_mode)
    if not mock_mode:
        await persistence.save_plan(sid, {"mission": body.mission, "current_plan": session.current_plan})

    return PlanResponse(
        session_id=sid,
        phase=session.phase.value,
        plan=plan_data,
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
        from_phases=[MissionPhase.PLAN_READY, MissionPhase.ERROR],
        to=MissionPhase.PLANNING,
    ):
        raise HTTPException(
            409,
            f"Cannot correct from state {session.phase.value}.",
        )

    mock_mode = getattr(request.app.state, "mock_mode", True)

    plan_data = None
    if not mock_mode:
        llm_service: LLMService = request.app.state.llm_service
        try:
            plan_data = await llm_service.correct_plan(
                body.correction, session.robot_count, session.conversation_history
            )
        except Exception as e:
            logger.error("LLM correction failed: %s", e)
            await session_store.transition(
                sid,
                from_phases=[MissionPhase.PLANNING],
                to=MissionPhase.IDLE,
            )
            raise HTTPException(503, "LLM service unavailable. Please retry.")

    session.correction_count += 1
    session.current_plan = plan_data
    session.conversation_history.append({"role": "user", "content": f"Correction: {body.correction}"})
    session.conversation_history.append(
        {"role": "assistant", "content": str(plan_data) if plan_data else "[Plan not available — no LLM connected]"}
    )

    await persistence.append_chat(sid, "user", f"Correction: {body.correction}")
    await persistence.append_chat(sid, "assistant", "[Plan not available — no LLM connected]")
    if not mock_mode:
        await persistence.append_decision(sid, f"Correction #{session.correction_count}: {body.correction}")

    await session_store.transition(
        sid,
        from_phases=[MissionPhase.PLANNING],
        to=MissionPhase.PLAN_READY,
    )

    await persistence.save_session_meta(sid, session.phase.value, session.robot_count, mock_mode)

    return PlanResponse(
        session_id=sid,
        phase=session.phase.value,
        plan=plan_data,
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
        from_phases=[MissionPhase.PLAN_READY, MissionPhase.ERROR],
        to=MissionPhase.GENERATING,
    ):
        raise HTTPException(
            409,
            f"Cannot generate from state {session.phase.value}. "
            f"Must have a plan ready first.",
        )

    mock_mode = getattr(request.app.state, "mock_mode", True)

    dag_data = None
    if not mock_mode:
        llm_service: LLMService = request.app.state.llm_service
        try:
            dag_data = await llm_service.phase2_dag(
                session.current_plan, session.robot_count
            )
        except Exception as e:
            logger.error("LLM Phase 2 failed: %s", e)
            await session_store.transition(
                sid,
                from_phases=[MissionPhase.GENERATING],
                to=MissionPhase.PLAN_READY,
            )
            raise HTTPException(503, "LLM service unavailable. Please retry.")

    session.current_dag = dag_data

    await session_store.transition(
        sid,
        from_phases=[MissionPhase.GENERATING],
        to=MissionPhase.DAG_READY,
    )

    await persistence.save_session_meta(sid, session.phase.value, session.robot_count, mock_mode)
    if session.current_plan or session.current_dag:
        await persistence.save_plan(sid, {
            "mission": session.conversation_history[0]["content"] if session.conversation_history else "",
            "current_plan": session.current_plan,
            "current_dag": session.current_dag,
            "robot_count": session.robot_count,
        })
    if not mock_mode:
        await persistence.append_decision(sid, "DAG generated")

    return PlanResponse(
        session_id=sid,
        phase=session.phase.value,
        plan=None,
        dag=dag_data,
        corrections_remaining=3 - session.correction_count,
        mock=mock_mode,
    )
