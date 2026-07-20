"""FastAPI application entry point.

Start from project root:
    uvicorn backend.main:app --reload --port 5000
"""

import logging
import os
from contextlib import asynccontextmanager
from typing import Optional
from fastapi import FastAPI, Depends, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware

from .config import Settings, validate_settings
from .log_setup import setup_logging
from .session import session_store
from .services.process_manager import kill_all, atexit_register
from .services.llm import LLMService

# Load settings early so CORS middleware can reference them
settings = Settings()

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI lifespan: startup tasks, shutdown cleanup."""
    setup_logging(settings.log_level)
    # ── Startup ──
    validate_settings()
    app.state.settings = settings
    app.state.session_store = session_store
    app.state.mock_mode = settings.mock_mode
    app.state.llm_service = LLMService(settings) if not settings.mock_mode else None
    session_store.start_cleanup()

    # ── Startup connectivity check for local LLM ──
    if settings.provider == "local" and settings.local_llm_url:
        import httpx
        from urllib.parse import urlparse
        parsed = urlparse(settings.local_llm_url)
        base = f"{parsed.scheme}://{parsed.hostname}"
        if parsed.port:
            base = f"{base}:{parsed.port}"
        for path in ["/api/v1/models", "/v1/models"]:
            probe_url = f"{base}{path}"
            try:
                resp = httpx.get(probe_url, timeout=3.0)
                if resp.status_code == 200:
                    data = resp.json()
                    models = data.get("data") or data.get("models") or []
                    model_name = models[0].get("id") or models[0].get("model") if models else "unknown"
                    logger.info("Local LLM reachable at %s — model: %s", probe_url, model_name)
                    break
                else:
                    logger.warning("Local LLM at %s responded HTTP %d", probe_url, resp.status_code)
            except Exception as e:
                logger.debug("Local LLM probe %s failed: %s", probe_url, e)
        else:
            logger.warning("Local LLM at %s is NOT reachable on /api/v1/models or /v1/models", base)

    logger.info("Listening on %s:%s", settings.host, settings.port)
    logger.info("CORS origin: %s", settings.cors_origin)
    logger.info("LLM provider: %s", settings.provider.upper())

    yield

    # ── Shutdown ──
    logger.info("Cleaning up processes...")
    kill_all()
    logger.info("Done.")


app = FastAPI(
    title="MissionSwarm R2",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs" if os.getenv("MISSION_DEBUG") else None,
    openapi_url="/openapi.json" if os.getenv("MISSION_DEBUG") else None,
)

# ── CORS ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.cors_origin],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "OPTIONS"],
    allow_headers=["Content-Type", "X-Session-Id"],
)


# ── Auth guard for process-modifying endpoints ──
async def verify_api_key(x_api_key: Optional[str] = Header(None)):
    if settings.api_key and x_api_key != settings.api_key:
        raise HTTPException(401, "Invalid or missing API key")
    return x_api_key

# ── Register routers ──
from .routers import config as config_router
from .routers import plan as plan_router
from .routers import launch as launch_router
from .routers import status as status_router
from .routers import health as health_router
from .routers import history as history_router
from .routers import locations as locations_router
from .routers import system as system_router

app.include_router(config_router.router)
app.include_router(plan_router.router)
app.include_router(launch_router.router, dependencies=[Depends(verify_api_key)])
app.include_router(status_router.router)
app.include_router(health_router.router)
app.include_router(history_router.router)
app.include_router(locations_router.router)
app.include_router(system_router.router)


# ── Startup safety — register atexit + signal handlers ──
atexit_register()


@app.get("/")
async def root():
    return {
        "service": "MissionSwarm R2",
        "version": "1.0.0",
        "docs": "/docs",
    }
