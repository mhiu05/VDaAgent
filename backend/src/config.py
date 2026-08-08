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
from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# `src` is now hosted under `backend/src`, while the runtime config and data
# volumes remain at repository root.  Keep the package usable from both
# `src.main` (the compatibility import) and `backend.src.main`.
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
_REPO_ROOT = _BACKEND_ROOT.parent
PROJECT_ROOT = (
    _REPO_ROOT
    if any((_REPO_ROOT / marker).exists() for marker in (".env", ".env.example", "README.md", "docs"))
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

ProviderName = Literal["openai", "openrouter", "gemini", "groq", "together", "ollama", "custom"]


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
    stats_fdr_method: Literal["benjamini_hochberg", "bonferroni", "none"] = "benjamini_hochberg"
    stats_max_tests_per_request: int = Field(default=20, ge=1)

    # --- retrieval (ADR-007) ----------------------------------------------
    retrieval_index_dir: str = "./data/index"
    retrieval_top_k: int = Field(default=5, ge=1, le=50)
    retrieval_candidate_k: int = Field(default=20, ge=1, le=200)
    retrieval_embedding_provider: Literal["local", "openai", "none"] = "local"
    retrieval_embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    retrieval_rerank_model: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"
    retrieval_enable_rerank: bool = False
    embedding_api_key: str = ""

    # --- security ----------------------------------------------------------
    security_require_api_token: bool = False
    security_user_rate_per_minute: int = Field(default=30, ge=1)
    security_max_upload_mb: int = Field(default=500, ge=1)
    security_allow_raw_export: bool = False
    security_mask_pii_in_answers: bool = True
    security_audit_log: str = "./data/audit.jsonl"
    api_token: str = ""

    # --- deterministic agent guardrails ----------------------------------
    guardrails_max_tool_calls_per_request: int = Field(default=10, ge=1, le=50)
    guardrails_max_context_chars: int = Field(default=24_000, ge=1_000, le=200_000)
    guardrails_max_output_chars: int = Field(default=12_000, ge=500, le=100_000)
    guardrails_audit_question_content: bool = False

    # --- database (ADR-009) ------------------------------------------------
    database_url: str = "sqlite:///./data/app.db"
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
            self.database_url = "sqlite:///./data/app.db"

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
        """Nơi chứa file Analyst upload — nằm trong data_dir để mount volume là xong."""
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
        """DSN cho LangGraph checkpointer — mặc định SQLite cạnh app.db (L2)."""
        if self.database_checkpointer_url:
            return self.database_checkpointer_url
        if self.database_url.startswith("postgres"):
            return self.database_url
        return f"sqlite:///{(self.data_path / 'checkpoints.sqlite').as_posix()}"

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
        if self.retrieval_embedding_provider == "openai" and not (
            self.embedding_api_key or self.llm_api_key
        ):
            missing.append("EMBEDDING_API_KEY")
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
    defaults = {key: value for key, value in yaml_defaults.items() if key.lower() not in env_keys}

    return Settings(**defaults)


__all__ = ["LLM_PROVIDERS", "PROJECT_ROOT", "Settings", "get_settings"]
