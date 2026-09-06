from __future__ import annotations

from typing import Any

from src.agents.runtime import trace


class _TraceRepository:
    def __init__(self) -> None:
        self.finished: list[dict[str, Any]] = []

    def begin_agent_step(self, *args: Any, **kwargs: Any) -> tuple[str, str]:
        return "step-id", "attempt-id"

    def finish_agent_step(self, attempt_id: str, **kwargs: Any) -> bool:
        self.finished.append({"attempt_id": attempt_id, **kwargs})
        return True

    def append_agent_trace(self, *args: Any, **kwargs: Any) -> None:
        raise AssertionError("duration must share the step-completion transaction")


def test_traced_node_persists_duration_with_completion(monkeypatch: Any) -> None:
    repository = _TraceRepository()
    monkeypatch.setattr(trace, "trace_enabled", lambda: True)
    monkeypatch.setattr(trace, "durable_step_trace_enabled", lambda: True)
    monkeypatch.setattr(trace, "get_repository", lambda: repository)
    wrapped = trace.traced_node("qa_router", lambda state: {"answer": "ok"}, 10)

    result = wrapped(
        {
            "agent_run_id": "run-id",
            "workspace_id": "workspace-id",
            "requested_by": "user-id",
            "profile_run_id": "profile-id",
            "question": "question",
        }
    )

    assert result == {"answer": "ok"}
    assert len(repository.finished) == 1
    assert repository.finished[0]["status"] == "succeeded"
    assert isinstance(repository.finished[0]["duration_ms"], int)


def test_shadow_trace_keeps_context_without_durable_step_transactions(
    monkeypatch: Any,
) -> None:
    repository = _TraceRepository()
    observed: dict[str, Any] = {}

    def node(state: dict[str, Any]) -> dict[str, Any]:
        observed["context"] = trace.get_execution_context()
        return {"answer": "ok"}

    monkeypatch.setattr(trace, "trace_enabled", lambda: True)
    monkeypatch.setattr(trace, "durable_step_trace_enabled", lambda: False)
    monkeypatch.setattr(trace, "get_repository", lambda: repository)
    wrapped = trace.traced_node("qa_router", node, 10)

    result = wrapped(
        {
            "agent_run_id": "run-id",
            "workspace_id": "workspace-id",
            "requested_by": "user-id",
        }
    )

    assert result == {"answer": "ok"}
    assert observed["context"].agent_run_id == "run-id"
    assert repository.finished == []
