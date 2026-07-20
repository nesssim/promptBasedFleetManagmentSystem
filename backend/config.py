"""Application configuration loaded from environment variables."""

import logging
from pydantic_settings import BaseSettings

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    """Single source of truth for all configurable parameters.

    Loaded from .env file at project root or environment variables.
    Provider priority: ANTHROPIC_API_KEY > GOOGLE_API_KEY > LOCAL_LLM_URL > mock
    """

    anthropic_api_key: str = ""
    google_api_key: str = ""
    local_llm_url: str = ""
    local_llm_model: str = ""
    api_key: str = ""
    host: str = "0.0.0.0"
    port: int = 5000
    cors_origin: str = "http://localhost:5173"
    log_level: str = "info"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}

    @property
    def provider(self) -> str:
        """Returns 'claude', 'gemini', 'local', or 'mock'."""
        if self.anthropic_api_key:
            return "claude"
        if self.google_api_key:
            return "gemini"
        if self.local_llm_url:
            return "local"
        return "mock"

    @property
    def mock_mode(self) -> bool:
        """True when no LLM backend is configured — returns stub data."""
        return self.provider == "mock"


def validate_settings() -> Settings:
    """Load and validate settings. Warns if key missing, but does NOT exit."""
    settings = Settings()
    if settings.mock_mode:
        logger.warning("MOCK MODE: No LLM backend configured.")
        logger.warning("Plan/Generate endpoints will return stub data.")
        logger.warning("Set ANTHROPIC_API_KEY, GOOGLE_API_KEY, or LOCAL_LLM_URL in .env")
    else:
        logger.info("LLM provider: %s", settings.provider.upper())
    return settings
