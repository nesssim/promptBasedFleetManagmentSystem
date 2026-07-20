"""GET /health and GET /robots — System health and robot status stubs."""

import logging
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Request

from ..config import validate_settings

router = APIRouter()
logger = logging.getLogger(__name__)

PROBE_TIMEOUT = 3.0


async def _probe_local_llm(url: str) -> tuple[bool, str | None]:
    """Quick probe of a local LLM endpoint. Returns (reachable, model_name)."""
    parsed = urlparse(url)
    base = f"{parsed.scheme}://{parsed.hostname}"
    if parsed.port:
        base = f"{base}:{parsed.port}"

    for path in ["/api/v1/models", "/v1/models"]:
        probe_url = f"{base}{path}"
        try:
            async with httpx.AsyncClient(timeout=PROBE_TIMEOUT) as client:
                resp = await client.get(probe_url)
                if resp.status_code == 200:
                    data = resp.json()
                    models = data.get("data") or data.get("models") or []
                    if models:
                        m0 = models[0] if isinstance(models[0], dict) else {}
                        model_name = m0.get("id") or m0.get("model") or m0.get("key") or str(models[0])
                        return True, model_name
                    return True, None
        except Exception:
            continue
    return False, None


@router.get("/health")
async def health_check(request: Request):
    """Return system health status with LLM reachability.

    During the first 30s after launch, health checks are suppressed
    (Gazebo cold start grace period). After 30s, standard 2s ping / 10s timeout.
    """
    settings = validate_settings()
    mock_mode = getattr(request.app.state, "mock_mode", True)

    llm_reachable = False
    llm_error: str | None = None
    llm_model: str | None = None

    if settings.provider in ("claude", "gemini"):
        llm_reachable = True
    elif settings.provider == "local" and settings.local_llm_url:
        llm_reachable, llm_model = await _probe_local_llm(settings.local_llm_url)
        if not llm_reachable:
            llm_error = f"Local LLM at {settings.local_llm_url} is not reachable"

    return {
        "status": "ok",
        "service": "MissionSwarm R2",
        "version": "1.0.0",
        "mock_mode": mock_mode,
        "provider": settings.provider,
        "llm_reachable": llm_reachable,
        "llm_error": llm_error,
        "llm_model": llm_model,
    }


@router.get("/robots")
async def get_robots(request: Request):
    """Return current robot states from FleetCoordinator (via latest WS message cache)."""
    # Stub — will be populated from ros_bridge cache
    return {"robots": [], "source": "ros_bridge_cache"}
