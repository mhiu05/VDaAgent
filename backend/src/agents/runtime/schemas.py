"""Typed, public-safe contracts for execution-runtime records.

These models deliberately exclude raw prompts, source paths, row values and
model reasoning.  Detailed internal state belongs in its bounded producer,
not in a generic trace payload.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

AgentRunType = Literal["profile", "qa", "analysis", "report"]
AgentRunStatus = Literal[
    "created",
    "running",
    "awaiting_approval",
    "completed",
    "failed",
    "cancelled",
    "rejected",
    "needs_reconciliation",
]
StepStatus = Literal[
    "pending",
    "ready",
    "awaiting_approval",
    "running",
    "retry_wait",
    "succeeded",
    "failed",
    "skipped",
    "cancelled",
    "needs_reconciliation",
]


class UsageBudget(BaseModel):
    """A server-side budget snapshot; all values are finite when provided."""

    model_config = ConfigDict(extra="forbid")

    max_steps: int | None = Field(default=None, ge=0)
    max_tool_calls: int | None = Field(default=None, ge=0)
    max_model_calls: int | None = Field(default=None, ge=0)
    max_input_tokens: int | None = Field(default=None, ge=0)
    max_output_tokens: int | None = Field(default=None, ge=0)
    max_cost: float | None = Field(default=None, ge=0)
    deadline_at: datetime | None = None


class UsageSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    steps_used: int = Field(default=0, ge=0)
    tool_calls_used: int = Field(default=0, ge=0)
    model_calls_used: int = Field(default=0, ge=0)
    retrieval_calls_used: int = Field(default=0, ge=0)
    input_tokens_used: int = Field(default=0, ge=0)
    output_tokens_used: int = Field(default=0, ge=0)
    cost_used: float = Field(default=0, ge=0)
    currency: str = "USD"
    usage_status: Literal["exact", "estimated", "unknown"] = "unknown"


class CanonicalEvidence(BaseModel):
    """A bounded fact produced by a registered, server-scoped operation."""

    model_config = ConfigDict(extra="forbid")

    evidence_id: str
    workspace_id: str
    profile_run_id: str | None = None
    context_version_id: str | None = None
    execution_id: str | None = None
    artifact_type: str = Field(min_length=1, max_length=64)
    artifact_id: str = Field(min_length=1, max_length=128)
    field_path: str = Field(min_length=1, max_length=512)
    value: Any = None
    unit: str | None = Field(default=None, max_length=64)
    is_approximate: bool = False
    limitations: list[str] = Field(default_factory=list, max_length=20)
    source_hash: str = Field(min_length=8, max_length=128)
    source_version: str | None = Field(default=None, max_length=255)
    producer_invocation_id: str | None = None


class AgentRunRecord(BaseModel):
    """Tenant-scoped projection returned by the generic run endpoint."""

    model_config = ConfigDict(extra="forbid")

    id: str
    run_type: AgentRunType
    status: AgentRunStatus
    workspace_id: str
    actor_user_id: str | None = None
    resource_bindings: dict[str, str] = Field(default_factory=dict)
    correlation_id: str | None = None
    runtime_version: str
    policy_version: str
    version_snapshot: dict[str, Any] = Field(default_factory=dict)
    budget: dict[str, Any] = Field(default_factory=dict)
    usage: dict[str, Any] = Field(default_factory=dict)
    trace_sequence: int = Field(default=0, ge=0)
    error_code: str | None = None
    error_summary: str | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None
    created_at: datetime


class TraceEventRecord(BaseModel):
    """Append-only, redacted event suitable for a UI timeline or SSE replay."""

    model_config = ConfigDict(extra="forbid")

    id: str
    agent_run_id: str
    sequence: int = Field(ge=1)
    event_type: str = Field(min_length=1, max_length=64)
    status: str | None = Field(default=None, max_length=64)
    reason_code: str | None = Field(default=None, max_length=64)
    reason_summary: str | None = Field(default=None, max_length=240)
    payload: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class TraceSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_count: int = Field(default=0, ge=0)
    latest_sequence: int = Field(default=0, ge=0)
    terminal: bool = False
    status: str | None = None


__all__ = [
    "AgentRunRecord",
    "AgentRunStatus",
    "AgentRunType",
    "CanonicalEvidence",
    "StepStatus",
    "TraceEventRecord",
    "TraceSummary",
    "UsageBudget",
    "UsageSnapshot",
]
