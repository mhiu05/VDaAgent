"""Cấu hình tập trung cho AI Data Profiling Agent.

Nguyên tắc:
    - `config.yaml` chứa tuỳ chọn KHÔNG bí mật, commit vào repo.
    - `.env` chứa secret (API key, DB password), KHÔNG commit.
    - Biến môi trường luôn thắng `config.yaml` để override khi deploy.

Mọi module khác import qua ``get_settings()`` — hàm được cache nên file chỉ đọc
đúng một lần cho cả process.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import yaml
from dotenv import load_dotenv
from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# `src` is hosted under `backend/src`, while the runtime config and data
# volumes remain at repository root. Run Uvicorn with `--app-dir backend`
# so the existing absolute `src.*` imports resolve consistently.
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
_REPO_ROOT = _BACKEND_ROOT.parent
PROJECT_ROOT = (
    _REPO_ROOT
    if any(
        (_REPO_ROOT / marker).exists()
        for marker in (".env", ".env.example", "README.md", "docs")
    )
    else _BACKEND_ROOT
)

# --------------------------------------------------------------------------- #
# Multi-provider LLM
# --------------------------------------------------------------------------- #
# Mọi provider dưới đây đều nói giao thức OpenAI-compatible, nên chỉ cần đổi
# base_url + api key là chuyển provider mà không phải sửa code gọi LLM.
LLM_PROVIDERS: dict[str, dict[str, str]] = {
    "openai": {
        "base_url": "https://api.openai.com/v1",
        "key_env": "OPENAI_API_KEY",
        "example_model": "gpt-4o-mini",
    },
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "key_env": "OPENROUTER_API_KEY",
        "example_model": "anthropic/claude-3.7-sonnet",
    },
    "gemini": {
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "key_env": "GEMINI_API_KEY",
        "example_model": "gemini-2.0-flash",
    },
    "groq": {
        "base_url": "https://api.groq.com/openai/v1",
        "key_env": "GROQ_API_KEY",
        "example_model": "llama-3.3-70b-versatile",
    },
    "together": {
        "base_url": "https://api.together.xyz/v1",
        "key_env": "TOGETHER_API_KEY",
        "example_model": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    },
    "ollama": {
        "base_url": "http://localhost:11434/v1",
        "key_env": "OLLAMA_API_KEY",
        "example_model": "llama3.1",
    },
    "custom": {
        "base_url": "",
        "key_env": "LLM_API_KEY",
        "example_model": "",
    },
}

ProviderName = Literal[
    "openai", "openrouter", "gemini", "groq", "together", "ollama", "custom"
]


def _load_yaml(root: Path) -> dict[str, Any]:
    """Đọc config.yaml. Thiếu file thì trả dict rỗng — code vẫn chạy bằng default."""
    path = root / "config.yaml"
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


def _flatten(raw: dict[str, Any]) -> dict[str, Any]:
    """Đổi YAML lồng nhau thành khoá phẳng `<section>_<key>` khớp field Settings."""
    flat: dict[str, Any] = {}
    for section, values in raw.items():
        if isinstance(values, dict):
            for key, value in values.items():
                flat[f"{section}_{key}"] = value
        else:
            flat[section] = values
    return flat


class Settings(BaseSettings):
    """Toàn bộ cấu hình runtime. Tên field = khoá phẳng của config.yaml."""

    model_config = SettingsConfigDict(
        env_file=str(PROJECT_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- app ---------------------------------------------------------------
    app_name: str = "AI Data Profiling Agent"
    app_env: Literal["development", "production", "test"] = "development"
    app_host: str = "0.0.0.0"
    app_port: int = Field(default=8000, ge=1, le=65535)
    app_log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    app_data_dir: str = "./data"

    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    # --- llm ---------------------------------------------------------------
    llm_provider: ProviderName = "openai"
    llm_model: str = "gpt-4o-mini"
    llm_temperature: float = Field(default=0.2, ge=0.0, le=2.0)
    llm_max_tool_rounds: int = Field(default=6, ge=1, le=30)
    llm_reasoning_effort: str = ""
    llm_base_url: str = ""
    llm_api_key: str = ""

    # --- profiling ---------------------------------------------------------
    profiling_default_scan_mode: Literal["full", "sample"] = "sample"
    profiling_sample_size: int = Field(default=10_000, ge=100)
    profiling_sample_strategy: Literal["reservoir", "tablesample"] = "reservoir"
    profiling_random_seed: int = 42
    profiling_top_k_values: int = Field(default=10, ge=1, le=100)
    profiling_outlier_method: Literal["iqr", "zscore", "both"] = "iqr"
    profiling_max_columns: int = Field(default=200, ge=1)

    # --- hitl (ADR-004: tiered review) ------------------------------------
    hitl_auto_confirm: bool = True
    hitl_confidence_threshold: float = Field(default=0.95, ge=0.0, le=1.0)
    hitl_low_risk_types: list[str] = Field(default_factory=lambda: ["semantic_type"])
    hitl_max_deep_analysis: int = Field(default=5, ge=1, le=50)

    # --- stats -------------------------------------------------------------
    stats_alpha: float = Field(default=0.05, gt=0.0, lt=1.0)
    stats_fdr_method: Literal["benjamini_hochberg", "bonferroni", "none"] = (
        "benjamini_hochberg"
    )
    stats_max_tests_per_request: int = Field(default=20, ge=1)

    # --- retrieval (ADR-007) ----------------------------------------------
    retrieval_index_dir: str = "./data/index"
    retrieval_top_k: int = Field(default=5, ge=1, le=50)
    retrieval_candidate_k: int = Field(default=20, ge=1, le=200)
    retrieval_embedding_provider: Literal["local", "openai", "voyage", "none"] = "local"
    retrieval_embedding_model: str = (
        "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    )
    retrieval_local_fallback_model: str = (
        "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    )
    retrieval_rerank_model: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"
    retrieval_enable_rerank: bool = False
    # External corpus is deliberately opt-in: turning this off is the safe
    # rollback path to the original profile-only QA behaviour.
    retrieval_external_knowledge_enabled: bool = False
    retrieval_profile_top_k: int = Field(default=1, ge=1, le=50)
    retrieval_knowledge_top_k: int = Field(default=4, ge=1, le=50)
    retrieval_max_chunks_per_source: int = Field(default=2, ge=1, le=20)
    retrieval_profile_context_chars: int = Field(default=12_000, ge=500, le=100_000)
    retrieval_knowledge_context_chars: int = Field(default=12_000, ge=500, le=100_000)
    embedding_api_key: str = ""
    voyage_api_key: str = ""

    # --- security ----------------------------------------------------------
    # ``dual`` exists only for the migration window.  It maps the old shared
    # token to a bootstrap workspace; production should move to ``supabase``.
    auth_mode: Literal["dual", "supabase"] = "dual"
    auth_allow_signup: bool = False
    auth_allow_guest: bool = False
    # Guest trials use a bounded, shared demo storage backend. Authenticated
    # workspaces keep using the provider configured by STORAGE_PROVIDER.
    guest_storage_provider: Literal["supabase", "local"] = "supabase"
    guest_max_upload_mb: int = Field(default=25, ge=1, le=100)
    guest_retention_hours: int = Field(default=24, ge=1, le=168)
    auth_require_email_confirmed: bool = True
    auth_issuer: str = Field(
        default="",
        validation_alias=AliasChoices(
            "SUPABASE_AUTH_ISSUER", "AUTH_ISSUER", "auth_issuer"
        ),
    )
    auth_audience: str = Field(
        default="authenticated",
        validation_alias=AliasChoices(
            "SUPABASE_AUTH_AUDIENCE", "AUTH_AUDIENCE", "auth_audience"
        ),
    )
    auth_jwks_cache_ttl_seconds: int = Field(default=300, ge=30, le=3600)
    auth_jwks_timeout_seconds: float = Field(default=3.0, ge=0.5, le=30.0)
    auth_jwt_algorithms: tuple[str, ...] = ("ES256", "RS256")
    # Used only by AUTH_MODE=dual.  It is a stable, valid UUID so legacy data
    # can be backfilled into a real membership instead of becoming unscoped.
    auth_bootstrap_user_id: str = Field(
        default="00000000-0000-0000-0000-000000000001",
        validation_alias=AliasChoices(
            "P170_BOOTSTRAP_USER_ID",
            "P170_BOOTSTRAP_OWNER_USER_ID",
            "AUTH_BOOTSTRAP_OWNER_USER_ID",
            "auth_bootstrap_user_id",
        ),
    )
    security_require_api_token: bool = False
    security_user_rate_per_minute: int = Field(default=30, ge=1)
    security_max_upload_mb: int = Field(default=500, ge=1)
    security_allow_raw_export: bool = False
    security_mask_pii_in_answers: bool = True
    # Empty means audit events are persisted in the metadata database.  A
    # JSONL path remains available only for isolated tests/legacy local runs.
    security_audit_log: str = ""
    api_token: str = ""

    # --- deterministic agent guardrails ----------------------------------
    guardrails_max_tool_calls_per_request: int = Field(default=10, ge=1, le=50)
    guardrails_max_context_chars: int = Field(default=24_000, ge=1_000, le=200_000)
    guardrails_max_output_chars: int = Field(default=12_000, ge=500, le=100_000)
    guardrails_audit_question_content: bool = False

    # --- Agent runtime rollout -------------------------------------------
    # New runtime layers are deliberately opt-in.  ``shadow`` persists a
    # redacted trace without changing the compatibility workflow; ``required``
    # makes a trace persistence failure fail the request closed.
    agent_trace_mode: Literal["off", "shadow", "required"] = "off"
    agent_verifier_mode: Literal["off", "shadow", "enforce"] = "off"
    agent_planner_enabled: bool = False
    agent_jobs_enabled: bool = False
    agent_workspace_memory_enabled: bool = False
    agent_personal_memory_enabled: bool = False
    agent_runtime_version: str = "2.0.0"
    agent_trace_event_limit: int = Field(default=500, ge=1, le=2_000)

    # --- UX Command Center rollout ---------------------------------------
    # The backend flag is independent from the frontend flag: a browser must
    # never reach the additive API before the backend contract is enabled.
    ux_command_center_enabled: bool = False
    ux_preview_timeout_seconds: int = Field(default=10, ge=1, le=60)
    ux_preview_row_budget: int = Field(default=50_000, ge=1_000, le=5_000_000)
    ux_preview_result_limit: int = Field(default=50, ge=1, le=50)
    ux_official_result_limit: int = Field(default=500, ge=1, le=500)

    # --- Supabase / database (ADR-009) ------------------------------------
    # The backend connects directly to Supabase PostgreSQL; the service-role
    # key is backend-only and must never be exposed to Next.js.
    supabase_url: str = ""
    supabase_publishable_key: str = ""
    supabase_secret_key: str = ""
    # Deprecated one-release Storage fallback.  Never expose either value to
    # the frontend; ``supabase_secret_key`` takes precedence.
    supabase_service_role_key: str = ""
    supabase_storage_bucket: str = "p170-dataset"
    supabase_storage_prefix: str = "datasets"
    # Uploads can be large; storage3 defaults to a 20-second request timeout.
    # Keep this configurable so a slow connection does not turn a valid upload
    # into the generic "Không thể lưu file" error.
    supabase_storage_timeout_seconds: int = Field(default=300, ge=20, le=1800)
    supabase_storage_resumable_threshold_mb: int = Field(default=6, ge=1, le=100)
    supabase_storage_chunk_mb: int = Field(default=6, ge=1, le=20)
    storage_provider: Literal["supabase", "google_drive", "local"] = "supabase"
    google_drive_client_id: str = ""
    google_drive_client_secret: str = ""
    google_drive_redirect_uri: str = (
        "http://localhost:8000/api/v1/google-drive/callback"
    )
    google_drive_folder_id: str = ""
    google_drive_token_encryption_key: str = ""
    google_drive_frontend_url: str = "http://localhost:3000"
    google_drive_oauth_state_ttl_seconds: int = Field(default=600, ge=60, le=1800)
    google_drive_chunk_mb: int = Field(default=8, ge=1, le=64)
    database_url: str = ""
    database_migration_url: str = ""
    database_checkpointer_url: str = ""

    # --- nguồn dữ liệu ngoài ----------------------------------------------
    gcp_project_id: str = ""
    bigquery_dataset: str = ""

    # ------------------------------------------------------------------ #
    @model_validator(mode="after")
    def _resolve_secrets(self) -> Settings:
        """Điền base_url theo provider và tìm API key ở đúng biến môi trường."""
        provider = LLM_PROVIDERS[self.llm_provider]

        if not self.llm_base_url:
            self.llm_base_url = provider["base_url"]

        # LLM_API_KEY (dùng chung) thắng; trống thì lấy key riêng của provider.
        if not self.llm_api_key:
            self.llm_api_key = os.getenv(provider["key_env"], "")

        if not self.database_url:
            raise ValueError("DATABASE_URL bắt buộc phải trỏ tới PostgreSQL.")
        if not self.database_url.startswith(
            ("postgresql://", "postgresql+psycopg://", "postgres://")
        ):
            raise ValueError(
                "DATABASE_URL phải là PostgreSQL (postgresql:// hoặc postgresql+psycopg://)."
            )

        if not self.auth_issuer and self.supabase_url:
            self.auth_issuer = f"{self.supabase_url.rstrip('/')}/auth/v1"
        if self.auth_mode == "supabase":
            if not self.supabase_url:
                raise ValueError("AUTH_MODE=supabase yêu cầu SUPABASE_URL.")
            if not self.auth_issuer:
                raise ValueError("AUTH_MODE=supabase yêu cầu SUPABASE_AUTH_ISSUER.")
        # The planner/verifier/queue switches are intentionally fail-closed
        # until their capability registry, deterministic evaluation and durable
        # execution phases have shipped. A truthy flag must never expose an
        # unfinished SQL/code-capable path by accident.
        if self.agent_planner_enabled:
            raise ValueError(
                "AGENT_PLANNER_ENABLED chưa khả dụng: cần capability registry, "
                "verifier và durable executor đã qua deterministic eval gate."
            )
        if self.agent_verifier_mode == "enforce":
            raise ValueError(
                "AGENT_VERIFIER_MODE=enforce chưa khả dụng trước khi deterministic verifier được phát hành."
            )
        if (
            self.agent_jobs_enabled
            or self.agent_workspace_memory_enabled
            or self.agent_personal_memory_enabled
        ):
            raise ValueError(
                "Agent jobs và long-term memory chưa được phát hành; giữ các feature flag AGENT_*_ENABLED=false."
            )
        return self

    # ------------------------------------------------------------------ #
    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def data_path(self) -> Path:
        return self._resolve(self.app_data_dir)

    @property
    def index_path(self) -> Path:
        return self._resolve(self.retrieval_index_dir)

    @property
    def upload_path(self) -> Path:
        """Legacy local upload path used only by local/test compatibility."""
        return self.data_path / "uploads"

    @property
    def audit_log_path(self) -> Path:
        return self._resolve(self.security_audit_log)

    @property
    def llm_configured(self) -> bool:
        """Ollama chạy local nên không cần key; provider khác thì cần."""
        return bool(self.llm_api_key) or self.llm_provider == "ollama"

    @property
    def checkpointer_url(self) -> str:
        """DSN cho LangGraph checkpointer — Supabase PostgreSQL in production."""
        value = self.database_checkpointer_url or self.database_url
        if value.startswith("postgresql+psycopg://"):
            # SQLAlchemy's driver-qualified URL is not a libpq DSN.  LangGraph
            # PostgresSaver expects the plain PostgreSQL form.
            value = value.replace("postgresql+psycopg://", "postgresql://", 1)
        if not value:
            raise ValueError(
                "DATABASE_URL hoặc DATABASE_CHECKPOINTER_URL bắt buộc cho PostgreSQL checkpointer."
            )
        if not value.startswith(("postgresql://", "postgres://")):
            raise ValueError("DATABASE_CHECKPOINTER_URL phải là PostgreSQL.")
        return value

    @property
    def supabase_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_backend_key)

    @property
    def google_drive_configured(self) -> bool:
        return bool(
            self.google_drive_client_id
            and self.google_drive_client_secret
            and self.google_drive_redirect_uri
            and self.google_drive_folder_id
            and self.google_drive_token_encryption_key
        )

    @property
    def supabase_backend_key(self) -> str:
        """Backend-only key; the legacy service-role fallback is temporary."""
        return self.supabase_secret_key or self.supabase_service_role_key

    def _resolve(self, value: str) -> Path:
        """Đường dẫn tương đối tính từ gốc project, không phụ thuộc cwd."""
        path = Path(value)
        return path if path.is_absolute() else (PROJECT_ROOT / path).resolve()

    def missing_required(self) -> list[str]:
        """Biến người dùng còn phải điền tay — in ra lúc khởi động app."""
        missing: list[str] = []
        if not self.llm_configured:
            missing.append(LLM_PROVIDERS[self.llm_provider]["key_env"])
        if self.security_require_api_token and not self.api_token:
            missing.append("API_TOKEN")
        if not self.database_url:
            missing.append("DATABASE_URL")
        if self.app_env == "production":
            if not self.supabase_url:
                missing.append("SUPABASE_URL")
            if self.storage_provider == "supabase" and not self.supabase_backend_key:
                missing.append("SUPABASE_SECRET_KEY")
            if self.auth_mode != "supabase":
                missing.append("AUTH_MODE=supabase")
            if not self.supabase_publishable_key:
                missing.append("SUPABASE_PUBLISHABLE_KEY")
            if (
                self.storage_provider == "google_drive"
                and not self.google_drive_configured
            ):
                missing.append("GOOGLE_DRIVE_* (storage provider google_drive)")
            if self.auth_allow_guest:
                if (
                    self.guest_storage_provider == "supabase"
                    and not self.supabase_backend_key
                ):
                    missing.append("SUPABASE_SECRET_KEY (guest trial storage)")
                if self.guest_storage_provider == "local":
                    missing.append("GUEST_STORAGE_PROVIDER=supabase")
        if self.retrieval_embedding_provider == "openai" and not (
            self.embedding_api_key or self.llm_api_key
        ):
            missing.append("EMBEDDING_API_KEY")
        if self.retrieval_embedding_provider == "voyage" and not self.voyage_api_key:
            missing.append("VOYAGE_API_KEY")
        return missing


@lru_cache
def get_settings() -> Settings:
    """Settings singleton: .env  ->  config.yaml  ->  default trong code.

    Giá trị truyền vào `Settings(**kwargs)` được pydantic-settings coi là *init
    source*, và init source có ưu tiên CAO HƠN biến môi trường. Nếu truyền
    thẳng YAML vào init thì `config.yaml` sẽ đè lên `.env` — ngược hẳn thứ tự ưu
    tiên mà file này và `config.yaml` cùng ghi. Hệ quả thực tế: đặt
    `DATABASE_URL` để trỏ sang DB tạm sẽ bị bỏ qua, và test/script sẽ ghi vào DB
    thật.

    Vì vậy chỉ lấy từ YAML những khoá mà môi trường KHÔNG nói gì. Khoá nào đã có
    trong env (hoặc trong `.env` vừa nạp) thì để pydantic tự đọc theo đúng thứ tự
    ưu tiên của nó.
    """
    load_dotenv(PROJECT_ROOT / ".env")
    yaml_defaults = _flatten(_load_yaml(PROJECT_ROOT))

    # `case_sensitive=False` nên so khớp tên field với env var không phân biệt hoa thường.
    env_keys = {key.lower() for key in os.environ}
    defaults = {
        key: value
        for key, value in yaml_defaults.items()
        if key.lower() not in env_keys
    }

    return Settings(**defaults)


__all__ = ["LLM_PROVIDERS", "PROJECT_ROOT", "Settings", "get_settings"]
