"""Runtime settings over the root `.env` (doc 16 "Root `.env`").

Every key has a default so that a missing key never raises here: the preflight
(`backend.preflight`) reports missing required keys by name instead. The process
environment wins over `.env`.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
        env_ignore_empty=True,
    )

    # Operator
    OPENROUTER_API_KEY: SecretStr = SecretStr("")
    ADMIN_USERNAME: str = ""
    ADMIN_PASSWORD: SecretStr = SecretStr("")
    DEMO_MODE: bool = False
    DEMO_PASSWORD: SecretStr = SecretStr("")
    DEMO_ADMIN_PASSWORD: SecretStr = SecretStr("")
    TELEGRAM_BOT_TOKEN: SecretStr = SecretStr("")
    TELEGRAM_BOT_USERNAME: str = ""

    # Models
    AGENT_MODEL: str = "anthropic/claude-haiku-4.5"
    JEV_MODEL: str = "typesafe/jev-1.14"
    JEV_CONFIDENCE_FLOOR: float = 0.6
    COMPACTION_MODEL: str = ""  # empty → AGENT_MODEL
    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1"
    MODEL_BACKEND: Literal["openrouter", "fake"] = "openrouter"
    MODEL_CONTEXT_TOKENS: int | None = None

    # Generated
    POSTGRES_PASSWORD: SecretStr = SecretStr("")
    SESSION_SECRET: SecretStr = SecretStr("")
    EXECD_TOKEN: SecretStr = SecretStr("")
    TELEGRAM_WEBHOOK_SECRET: SecretStr = SecretStr("")
    LANGFUSE_PUBLIC_KEY: str = ""
    LANGFUSE_SECRET_KEY: SecretStr = SecretStr("")
    LANGFUSE_NEXTAUTH_SECRET: SecretStr = SecretStr("")
    LANGFUSE_SALT: SecretStr = SecretStr("")
    LANGFUSE_ENCRYPTION_KEY: SecretStr = SecretStr("")
    CREDENTIAL_ENCRYPTION_KEY: SecretStr = SecretStr("")
    CLICKHOUSE_PASSWORD: SecretStr = SecretStr("")
    REDIS_AUTH: SecretStr = SecretStr("")
    MINIO_ROOT_PASSWORD: SecretStr = SecretStr("")

    # Langfuse
    LANGFUSE_INIT_USER_EMAIL: str = "admin@contoso.local"
    LANGFUSE_PUBLIC_URL: str = "http://localhost:3100"

    # HTTP
    APP_PORT: int = 8000
    APP_URL: str = ""  # empty → http://localhost:${APP_PORT}
    COOKIE_SECURE: bool = False
    GITHUB_TOKEN: SecretStr = SecretStr("")

    # Tunables
    SOFT_CONTEXT_RATIO: float = 0.6
    HARD_CONTEXT_RATIO: float = 0.9
    OFFLOAD_CHARS: int = 8000
    OFFLOAD_HEAD_CHARS: int = 2000
    OFFLOAD_TAIL_CHARS: int = 2000
    EXEC_TIMEOUT_S: int = 120
    # `uv add` / `uv sync` in agent folders download from PyPI; other system execs keep 600 s
    AGENT_PACKAGE_INSTALL_TIMEOUT_S: int = Field(default=1200, gt=0, le=3600)
    EXEC_MEM_MB: int = 2048
    MAX_STEPS_PER_ACTIVATION: int = 50
    MODEL_TIMEOUT_S: int = 120
    TASK_MAX_S: int = 3600
    JEV_K: int = 20
    MAX_AGENTS_PER_USER: int = 12

    # Set by compose, not by the operator (not in `.env.example`)
    DATABASE_URL: SecretStr = SecretStr("")
    EXECD_URL: str = "http://workspace:7000"
    LANGFUSE_BASE_URL: str = "http://langfuse-web:3000"
    DOMAINS_DIR: str = "/domains"
    PLATFORM_DIR: str = "/platform"
    FOLDERS_DIR: str = "/data/folders"
    ATTACHMENTS_DIR: str = "/data/attachments"
    REPORTS_DIR: str = "/data/reports"
    CACHE_DIR: str = "/data/cache"
    # Where skills are downloaded from (doc 05); the test stack points it at `fixtures`
    SKILLS_CODELOAD_URL: str = "https://codeload.github.com"
    GITHUB_API_URL: str = "https://api.github.com"
    # FakeModel scenario file for MODEL_BACKEND=fake (doc 17)
    MODEL_SCENARIO: str = "backend/tests/scenarios/golden.yaml"
    # Internal API (doc 15): where exec code reaches api, and where api listens for it
    INTERNAL_URL: str = "http://backend:8001"
    INTERNAL_PORT: int = 8001
    # Idle runners re-check for work this often, in case a wake was missed
    RUNNER_POLL_S: float = 2.0
    # Before starting an activation, wait this long for closely-spaced follow-up messages so they
    # land in the same batch instead of becoming a separate activation/reply
    RUNNER_DEBOUNCE_S: float = 1.0

    @model_validator(mode="after")
    def _derived_defaults(self) -> Settings:
        if not self.COMPACTION_MODEL:
            self.COMPACTION_MODEL = self.AGENT_MODEL
        if not self.APP_URL:
            self.APP_URL = f"http://localhost:{self.APP_PORT}"
        return self

    def is_set(self, key: str) -> bool:
        value = getattr(self, key)
        if isinstance(value, SecretStr):
            value = value.get_secret_value()
        return value is not None and str(value).strip() != ""
