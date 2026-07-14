"""Application configuration loaded from environment variables."""

import logging
from pydantic_settings import BaseSettings

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    """Single source of truth for all configurable parameters.

    Loaded from .env file at project root or environment variables.
    The backend runs in mock mode if ANTHROPIC_API_KEY is not set —
    plan/generate endpoints return stub data without calling Claude.
    """

    anthropic_api_key: str = ""  # Empty = mock mode (stub responses)
    api_key: str = ""  # Optional auth key for /launch and /kill
    host: str = "0.0.0.0"
    port: int = 5000
    cors_origin: str = "http://localhost:5173"
    log_level: str = "info"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    @property
    def mock_mode(self) -> bool:
        """True when no API key is configured — returns stub data."""
        return not bool(self.anthropic_api_key)


def validate_settings() -> Settings:
    """Load and validate settings. Warns if key missing, but does NOT exit."""
    settings = Settings()
    if settings.mock_mode:
        logger.warning("MOCK MODE: ANTHROPIC_API_KEY is not set.")
        logger.warning("Plan/Generate endpoints will return stub data.")
        logger.warning("Set ANTHROPIC_API_KEY=sk-ant-... in .env for real LLM calls.")
    return settings
