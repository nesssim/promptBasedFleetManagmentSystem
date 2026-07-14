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

# Load settings early so CORS middleware can reference them
settings = Settings()

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI lifespan: startup tasks, shutdown cleanup."""
    setup_logging()
    # ── Startup ──
    validate_settings()
    app.state.settings = settings
    app.state.session_store = session_store
    app.state.mock_mode = settings.mock_mode
    logger.info("Listening on %s:%s", settings.host, settings.port)
    logger.info("CORS origin: %s", settings.cors_origin)
    logger.info("LLM mode: %s", "MOCK (no API key)" if settings.mock_mode else "LIVE")

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
    allow_methods=["GET", "POST", "OPTIONS"],
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

app.include_router(config_router.router)
app.include_router(plan_router.router)
app.include_router(launch_router.router, dependencies=[Depends(verify_api_key)])
app.include_router(status_router.router)
app.include_router(health_router.router)


# ── Startup safety — register atexit + signal handlers ──
atexit_register()


@app.get("/")
async def root():
    return {
        "service": "MissionSwarm R2",
        "version": "1.0.0",
        "docs": "/docs",
    }
