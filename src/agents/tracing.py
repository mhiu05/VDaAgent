"""Persistent trace and run service for agent observability.

Events contain PII-safe summaries only. The underlying repository writes each
run and span to SQLite so monitoring data survives backend restarts.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import UTC, datetime
from time import perf_counter
from uuid import uuid4

from src.agents.persistence import AgentRepository, agent_repository
from src.models.schemas import AgentRun, AgentTraceEvent


class TraceStore:
    def __init__(self, repository: AgentRepository | None = None) -> None:
        self.repository = repository or agent_repository

    def start_run(self, source_name: str, source_type: str) -> AgentRun:
        now = _now()
        run = AgentRun(
            run_id=str(uuid4()),
            source_name=source_name,
            source_type=source_type,
            status="running",
            started_at=now,
            updated_at=now,
        )
        return self.repository.save_run(run)

    def finish_run(self, run_id: str, status: str, metrics: dict[str, float | int | str | None]) -> AgentRun:
        run = self.repository.get_run(run_id)
        if run is None:
            raise KeyError(f"Agent run not found: {run_id}")
        run.status = status
        run.updated_at = _now()
        run.metrics = metrics
        return self.repository.save_run(run)

    def add_event(
        self,
        run_id: str,
        event_type: str,
        component: str,
        tool_name: str | None,
        input_summary: str,
        output_summary: str = "",
        status: str = "success",
        error_message: str | None = None,
        metadata: dict[str, object] | None = None,
        duration_ms: int = 0,
        parent_span_id: str | None = None,
    ) -> AgentTraceEvent:
        event = AgentTraceEvent(
            run_id=run_id,
            trace_id=run_id,
            span_id=str(uuid4()),
            parent_span_id=parent_span_id,
            event_type=event_type,
            component=component,
            tool_name=tool_name,
            input_summary=input_summary,
            output_summary=output_summary,
            status=status,
            started_at=_now(),
            ended_at=_now(),
            duration_ms=duration_ms,
            error_message=error_message,
            metadata=metadata or {},
        )
        return self.repository.save_trace_event(event)

    @contextmanager
    def span(self, run_id: str, component: str, tool_name: str, input_summary: str):
        started = perf_counter()
        try:
            yield
            duration = int((perf_counter() - started) * 1000)
            self.add_event(run_id, "tool_call", component, tool_name, input_summary, "completed", "success", duration_ms=duration)
        except Exception as exc:
            duration = int((perf_counter() - started) * 1000)
            self.add_event(run_id, "tool_call", component, tool_name, input_summary, "failed", "error", str(exc), duration_ms=duration)
            raise

    def list_runs(self, limit: int = 100, offset: int = 0) -> list[AgentRun]:
        return self.repository.list_runs(limit=limit, offset=offset)

    def get_run(self, run_id: str) -> AgentRun | None:
        return self.repository.get_run(run_id)

    def list_events(
        self,
        run_id: str | None = None,
        limit: int = 500,
        offset: int = 0,
    ) -> list[AgentTraceEvent]:
        return self.repository.list_trace_events(run_id=run_id, limit=limit, offset=offset)


trace_store = TraceStore()


def _now() -> str:
    return datetime.now(UTC).isoformat()
