"""Application configuration loaded from environment variables."""

import sys
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Single source of truth for all configurable parameters.

    Loaded from .env file at project root or environment variables.
    FastAPI refuses to start if ANTHROPIC_API_KEY is missing.
    """

    anthropic_api_key: str = ""  # No default — validated on startup
    host: str = "0.0.0.0"
    port: int = 5000
    cors_origin: str = "http://localhost:5173"
    log_level: str = "info"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


def validate_settings() -> Settings:
    """Load and validate settings. Exits with clear message if key missing."""
    settings = Settings()
    if not settings.anthropic_api_key:
        print("FATAL: ANTHROPIC_API_KEY is not set.", file=sys.stderr)
        print("Create a .env file with: ANTHROPIC_API_KEY=sk-ant-...", file=sys.stderr)
        sys.exit(1)
    return settings
