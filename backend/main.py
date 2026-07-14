"""FastAPI application entry point.

Start with:  uvicorn backend.main:app --reload
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.config import validate_settings
from backend.session import session_store
from backend.services.process_manager import kill_all, atexit_register


@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI lifespan: startup tasks, shutdown cleanup."""
    # ── Startup ──
    settings = validate_settings()
    app.state.settings = settings
    app.state.session_store = session_store
    print(f"[startup] Listening on {settings.host}:{settings.port}")
    print(f"[startup] CORS origin: {settings.cors_origin}")

    yield

    # ── Shutdown ──
    print("[shutdown] Cleaning up processes...")
    kill_all()
    print("[shutdown] Done.")


app = FastAPI(
    title="MissionSwarm R2",
    version="1.0.0",
    lifespan=lifespan,
)

# ── CORS (allow Vite dev server) ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Register routers ──
from backend.routers import config as config_router
from backend.routers import plan as plan_router
from backend.routers import launch as launch_router
from backend.routers import status as status_router
from backend.routers import health as health_router

app.include_router(config_router.router)
app.include_router(plan_router.router)
app.include_router(launch_router.router)
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
