"""Contracts for the additive Data Analyst workspace API."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class AnalysisSessionCreate(BaseModel):
    profile_run_id: str = Field(min_length=1)
    mode: Literal["quick", "deep"] = "quick"
    goal: str = Field(min_length=3, max_length=2000)
    decision: str | None = Field(default=None, max_length=2000)
    audience: str | None = Field(default=None, max_length=255)
    output: Literal["answer", "report", "chart"] = "answer"
    time_scope: dict[str, Any] | None = None
    population: dict[str, Any] | None = None
    baseline: dict[str, Any] | None = None

    @field_validator("goal")
    @classmethod
    def strip_goal(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Mục tiêu phân tích không được để trống.")
        return value


class ContextCreate(BaseModel):
    row_grain: str | None = Field(default=None, max_length=255)
    entity: str | None = Field(default=None, max_length=255)
    keys: list[str] = Field(default_factory=list, max_length=20)
    time_column: str | None = Field(default=None, max_length=255)
    timezone: str | None = Field(default=None, max_length=64)
    dimensions: list[str] = Field(default_factory=list, max_length=100)
    measures: list[str] = Field(default_factory=list, max_length=100)
    ignored_columns: list[str] = Field(default_factory=list, max_length=100)
    limitations: list[str] = Field(default_factory=list, max_length=50)


class ContextApprove(BaseModel):
    """Empty body: approver attribution comes from the verified JWT."""


class QualityAcknowledge(BaseModel):
    resolution_note: str = Field(min_length=3, max_length=1000)


class FilterSpec(BaseModel):
    column: str = Field(min_length=1, max_length=255)
    operator: Literal[
        "eq", "ne", "gt", "gte", "lt", "lte", "in", "not_in", "is_null", "not_null"
    ]
    value: Any = None


class QuerySpec(BaseModel):
    aggregate: Literal["count", "count_distinct", "sum", "mean", "median"]
    column: str | None = Field(default=None, max_length=255)
    dimensions: list[str] = Field(default_factory=list, max_length=3)
    filters: list[FilterSpec] = Field(default_factory=list, max_length=20)
    limit: int = Field(default=100, ge=1, le=500)
    sort: Literal["asc", "desc"] = "desc"


class ExecutionCreate(BaseModel):
    query: QuerySpec
    expected_context_version_id: str = Field(min_length=1)


class PreviewCreate(BaseModel):
    query: QuerySpec
    idempotency_key: str | None = Field(default=None, max_length=255)


class PreviewPromote(BaseModel):
    expected_context_version_id: str = Field(min_length=1)
    idempotency_key: str | None = Field(default=None, max_length=255)


class AnalysisOut(BaseModel):
    model_config = {"extra": "allow"}
    id: str
    mode: str
    status: str
    goal: str
