"""Shared, intentionally small contracts for read-only agent tools.

The models are also useful to callers which do not use LangChain: tool results
always have the same envelope and errors are machine-readable.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class ErrorCode(StrEnum):
    NOT_FOUND = "not_found"
    INVALID_ARGUMENT = "invalid_argument"
    NO_EVIDENCE = "no_evidence"
    FORBIDDEN_SCOPE = "forbidden_scope"
    RESULT_TOO_LARGE = "result_too_large"
    INTERNAL_ERROR = "internal_error"


class Page(BaseModel):
    limit: int = Field(default=20, ge=1, le=100)
    cursor: int = Field(default=0, ge=0)
    next_cursor: int | None = None
    total: int | None = None


class ToolEnvelope(BaseModel):
    tool: str
    profile_run_id: str
    data: Any = None
    evidence: list[dict[str, Any]] = Field(default_factory=list)
    is_approximate: bool = False
    limitations: list[str] = Field(default_factory=list)
    page: Page | None = None
    error_code: ErrorCode | None = None
    error: str | None = None


DEFAULT_LIMIT = 20
MAX_LIMIT = 100
