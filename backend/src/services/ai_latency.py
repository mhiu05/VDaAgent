"""PII-safe request-local latency telemetry for AI workflows.

This is intentionally separate from the general HTTP/SQL timing ledger. It
captures the user-visible AI critical path without retaining a question,
prompt, tool result, source identifier, model output, or provider endpoint.
"""

from __future__ import annotations

import contextvars
import logging
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Iterator

from src.services import perf_telemetry

logger = logging.getLogger("p170.ai_latency")

_latency_context: contextvars.ContextVar["AILatency | None"] = contextvars.ContextVar(
    "p170_ai_latency", default=None
)

_MODEL_STAGES = {
    # qa_router_node records its complete deterministic-or-model decision as
    # one stage so a classifier invocation is not double-counted.
    "qa_router": None,
    "chart_planner": "planner",
    "qa_structured": "final_llm",
    "qa_vector": "final_llm",
    "chart_insight": "final_llm",
    "qa_clarify": "final_llm",
}


@dataclass
class AILatency:
    """Safe counters for exactly one AI request."""

    operation: str
    started: float = field(default_factory=time.perf_counter)
    stage_ms: dict[str, float] = field(default_factory=dict)
    llm_calls: int = 0
    tool_calls: int = 0
    retrieval_calls: int = 0
    db_calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    token_usage_known: bool = False
    retries: int | None = None
    timeouts: int | None = None
    first_validated_output_ms: float | None = None
    first_status_ms: float | None = None
    first_evidence_ms: float | None = None
    execution_path: str | None = None
    intent: str | None = None
    model: str | None = None
    cache_status: str | None = None
    outcome: str | None = None
    stage_spans: list[dict[str, float | str]] = field(default_factory=list)
    budget_category: str | None = None
    budget_configured_ms: float | None = None
    budget_exceeded: bool = False
    fallback_selected: str | None = None
    timeout_stage: str | None = None
    parallel_branches: list[dict[str, float | str | bool]] = field(default_factory=list)

    def add_stage(
        self, stage: str, duration_ms: float, *, started_ms: float | None = None
    ) -> None:
        duration = max(duration_ms, 0.0)
        self.stage_ms[stage] = self.stage_ms.get(stage, 0.0) + duration
        end_ms = (time.perf_counter() - self.started) * 1000
        self.stage_spans.append(
            {
                "stage": stage,
                "started_ms": round(started_ms if started_ms is not None else end_ms - duration, 3),
                "ended_ms": round(end_ms, 3),
                "duration_ms": round(duration, 3),
            }
        )

    def snapshot(self) -> dict[str, Any]:
        total_ms = (time.perf_counter() - self.started) * 1000
        measured = sum(self.stage_ms.values())
        request_perf = perf_telemetry.current()
        return {
            "operation": self.operation,
            "total_ms": round(total_ms, 3),
            "e2e_ms": round(total_ms, 3),
            "router_ms": round(self.stage_ms.get("router", 0.0), 3),
            "planner_ms": round(self.stage_ms.get("planner", 0.0), 3),
            "retrieval_ms": round(self.stage_ms.get("retrieval", 0.0), 3),
            "tools_ms": round(self.stage_ms.get("tools", 0.0), 3),
            "evidence_ms": round(self.stage_ms.get("evidence", 0.0), 3),
            "final_llm_ms": round(self.stage_ms.get("final_llm", 0.0), 3),
            "validation_ms": round(self.stage_ms.get("validation", 0.0), 3),
            "other_ms": round(max(total_ms - measured, 0.0), 3),
            "ttft_ms": (
                round(self.first_validated_output_ms, 3)
                if self.first_validated_output_ms is not None
                else None
            ),
            "ttfs_ms": round(self.first_status_ms, 3) if self.first_status_ms is not None else None,
            "ttfe_ms": round(self.first_evidence_ms, 3) if self.first_evidence_ms is not None else None,
            "ttfva_ms": (
                round(self.first_validated_output_ms, 3)
                if self.first_validated_output_ms is not None
                else None
            ),
            "llm_calls": self.llm_calls,
            "tool_calls": self.tool_calls,
            "retrieval_calls": self.retrieval_calls,
            "db_calls": request_perf.query_count if request_perf is not None else self.db_calls,
            "input_tokens": self.input_tokens if self.token_usage_known else None,
            "output_tokens": self.output_tokens if self.token_usage_known else None,
            "retries": self.retries,
            "timeouts": self.timeouts,
            "execution_path": self.execution_path,
            "intent": self.intent,
            "model": self.model,
            "cache_status": self.cache_status,
            "outcome": self.outcome,
            "budget_category": self.budget_category,
            "budget_configured_ms": self.budget_configured_ms,
            "budget_exceeded": self.budget_exceeded,
            "fallback_selected": self.fallback_selected,
            "timeout_stage": self.timeout_stage,
            "parallel_branches": self.parallel_branches,
            # Individual spans preserve overlap; consumers must use e2e_ms as
            # the critical path rather than summing these durations.
            "stage_spans": self.stage_spans,
        }


def begin(operation: str) -> contextvars.Token:
    """Start an isolated AI-latency ledger for a request."""

    return _latency_context.set(AILatency(operation=operation))


def current() -> AILatency | None:
    """Return the active ledger, if this code is running in an AI request."""

    return _latency_context.get()


def reset(token: contextvars.Token) -> None:
    _latency_context.reset(token)


@contextmanager
def timed(stage: str) -> Iterator[None]:
    """Add the duration of one safe, named AI stage to the active ledger."""

    context = current()
    if context is None:
        yield
        return
    started = time.perf_counter()
    started_ms = (started - context.started) * 1000
    try:
        yield
    finally:
        context.add_stage(
            stage,
            (time.perf_counter() - started) * 1000,
            started_ms=started_ms,
        )


def record_model(
    prompt_id: str,
    duration_ms: float,
    *,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
) -> None:
    """Record one model call using a stable internal stage name."""

    context = current()
    if context is None:
        return
    context.llm_calls += 1
    stage = _MODEL_STAGES.get(prompt_id, "final_llm")
    if stage:
        context.add_stage(stage, duration_ms)
    if input_tokens is not None or output_tokens is not None:
        context.token_usage_known = True
        context.input_tokens += int(input_tokens or 0)
        context.output_tokens += int(output_tokens or 0)


def record_tool(duration_ms: float) -> None:
    context = current()
    if context is None:
        return
    context.tool_calls += 1
    context.add_stage("tools", duration_ms)


def add_stage(stage: str, duration_ms: float) -> None:
    """Record a stage when a call site has already measured its boundaries."""

    context = current()
    if context is not None:
        context.add_stage(stage, duration_ms)


def record_retrieval(duration_ms: float) -> None:
    context = current()
    if context is None:
        return
    context.retrieval_calls += 1
    context.add_stage("retrieval", duration_ms)


def record_timeout() -> None:
    context = current()
    if context is not None:
        context.timeouts = (context.timeouts or 0) + 1


def set_budget(category: str, configured_seconds: float) -> None:
    """Record the selected P1 product budget without storing question data."""

    context = current()
    if context is not None:
        context.budget_category = category[:32]
        context.budget_configured_ms = round(max(configured_seconds, 0.0) * 1000, 3)


def mark_budget_exceeded(*, stage: str, fallback: str | None = None) -> None:
    context = current()
    if context is not None:
        context.budget_exceeded = True
        context.timeout_stage = stage[:64]
        context.fallback_selected = fallback[:64] if fallback else None
    record_timeout()


def record_parallel_branch(name: str, duration_ms: float, *, required: bool, outcome: str) -> None:
    """Keep branch timing distinct from critical-path timing."""

    context = current()
    if context is not None:
        context.parallel_branches.append(
            {
                "branch": name[:64],
                "duration_ms": round(max(duration_ms, 0.0), 3),
                "required": required,
                "outcome": outcome[:32],
            }
        )


def record_retry() -> None:
    context = current()
    if context is not None:
        context.retries = (context.retries or 0) + 1


def mark_first_validated_output() -> None:
    """Mark when the server first emits validated answer content to SSE."""

    context = current()
    if context is not None and context.first_validated_output_ms is None:
        context.first_validated_output_ms = (time.perf_counter() - context.started) * 1000


def mark_first_status() -> None:
    """Mark the first meaningful server status delivered to a chat client."""

    context = current()
    if context is not None and context.first_status_ms is None:
        context.first_status_ms = (time.perf_counter() - context.started) * 1000


def mark_first_evidence() -> None:
    """Mark when verified, user-visible provenance first becomes available."""

    context = current()
    if context is not None and context.first_evidence_ms is None:
        context.first_evidence_ms = (time.perf_counter() - context.started) * 1000


def set_dimensions(
    *,
    execution_path: str | None = None,
    intent: str | None = None,
    model: str | None = None,
    cache_status: str | None = None,
) -> None:
    """Attach safe aggregation dimensions; never put prompts or source data here."""

    context = current()
    if context is None:
        return
    if execution_path is not None:
        context.execution_path = execution_path[:64]
    if intent is not None:
        context.intent = intent[:64]
    if model is not None:
        context.model = model[:128]
    if cache_status is not None:
        context.cache_status = cache_status[:32]


def set_outcome(outcome: str) -> None:
    context = current()
    if context is not None:
        context.outcome = outcome[:32]


def emit() -> dict[str, Any] | None:
    """Log one safe record and return it for local benchmark/test consumers."""

    context = current()
    if context is None:
        return None
    values = context.snapshot()
    logger.info(
        "ai_latency operation=%s total_ms=%s router_ms=%s planner_ms=%s "
        "retrieval_ms=%s tools_ms=%s evidence_ms=%s final_llm_ms=%s "
        "validation_ms=%s other_ms=%s ttft_ms=%s ttfs_ms=%s ttfe_ms=%s ttfva_ms=%s "
        "execution_path=%s intent=%s outcome=%s llm_calls=%s tool_calls=%s "
        "retrieval_calls=%s db_calls=%s input_tokens=%s output_tokens=%s "
        "retries=%s timeouts=%s budget_category=%s budget_configured_ms=%s "
        "budget_exceeded=%s fallback_selected=%s timeout_stage=%s parallel_branches=%s",
        values["operation"], values["total_ms"], values["router_ms"],
        values["planner_ms"], values["retrieval_ms"], values["tools_ms"],
        values["evidence_ms"], values["final_llm_ms"], values["validation_ms"],
        values["other_ms"], values["ttft_ms"], values["ttfs_ms"], values["ttfe_ms"],
        values["ttfva_ms"], values["execution_path"], values["intent"], values["outcome"], values["llm_calls"],
        values["tool_calls"], values["retrieval_calls"], values["db_calls"],
        values["input_tokens"], values["output_tokens"], values["retries"],
        values["timeouts"], values["budget_category"], values["budget_configured_ms"],
        values["budget_exceeded"], values["fallback_selected"], values["timeout_stage"],
        len(values["parallel_branches"]),
    )
    return values


__all__ = [
    "AILatency",
    "add_stage",
    "begin",
    "current",
    "emit",
    "mark_first_validated_output",
    "mark_first_evidence",
    "mark_first_status",
    "record_model",
    "record_retrieval",
    "record_retry",
    "record_parallel_branch",
    "record_timeout",
    "set_budget",
    "mark_budget_exceeded",
    "record_tool",
    "reset",
    "set_dimensions",
    "set_outcome",
    "timed",
]
