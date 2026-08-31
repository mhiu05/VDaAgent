"""Focused unit coverage for the durable, workspace-scoped profiling stream."""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from typing import Callable

import pytest
from fastapi import HTTPException

from src.api import routes


def _summary(*, status: str, job_status: str) -> dict[str, object]:
    return {
        "profile_run_id": "run-1",
        "dataset_id": "dataset-1",
        "dataset_name": "Orders",
        "status": status,
        "job_status": job_status,
        "scan_mode": "full",
        "row_count": 12,
        "column_count": 2,
        "warning_count": 0,
        "pending_proposals": 0,
        "context_version_id": None,
    }


class _FakeClock:
    def __init__(self) -> None:
        self.now = 0.0
        self.sleeps: list[float] = []

    async def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


class _FakeRequest:
    def __init__(self, disconnected: Callable[[], bool] | None = None) -> None:
        self._disconnected = disconnected or (lambda: False)

    async def is_disconnected(self) -> bool:
        return self._disconnected()


async def _stream_payload(
    monkeypatch, repository: object, request: _FakeRequest, clock: _FakeClock
) -> str:
    monkeypatch.setattr(routes, "get_repository", lambda: repository)
    monkeypatch.setattr(
        routes, "get_rate_limiter", lambda: SimpleNamespace(check=lambda _: None)
    )
    monkeypatch.setattr(routes.asyncio, "sleep", clock.sleep)
    monkeypatch.setattr(routes.time, "monotonic", lambda: clock.now)
    response = await routes.profiling_job_events(
        "run-1",
        request,
        context=SimpleNamespace(user_id="user-1", workspace_id="workspace-1"),
    )
    chunks: list[str] = []
    async for chunk in response.body_iterator:
        chunks.append(chunk.decode() if isinstance(chunk, bytes) else chunk)
    return "".join(chunks)


def test_profile_event_stream_emits_changed_durable_milestones_in_workspace(monkeypatch) -> None:
    states = [
        _summary(status="queued", job_status="queued"),
        _summary(status="queued", job_status="queued"),
        _summary(status="completed", job_status="succeeded"),
    ]
    calls: list[tuple[str, str | None]] = []

    class Repository:
        def get_profile_summary(self, job_id: str, *, workspace_id: str | None = None):
            calls.append((job_id, workspace_id))
            return states.pop(0)

    clock = _FakeClock()
    payload = asyncio.run(_stream_payload(monkeypatch, Repository(), _FakeRequest(), clock))

    assert payload.count("event: queued") == 1
    assert payload.count("event: ready") == 1
    assert "evidence" not in payload
    assert calls == [("run-1", "workspace-1")] * 3
    assert clock.sleeps == [1.0, 2.0]


def test_profile_event_stream_backs_off_while_summary_is_unchanged(monkeypatch) -> None:
    calls: list[float] = []
    clock = _FakeClock()

    class Repository:
        def get_profile_summary(self, _job_id: str, *, workspace_id: str | None = None):
            assert workspace_id == "workspace-1"
            calls.append(clock.now)
            if clock.now >= 11:
                return _summary(status="completed", job_status="succeeded")
            return _summary(status="queued", job_status="queued")

    payload = asyncio.run(_stream_payload(monkeypatch, Repository(), _FakeRequest(), clock))

    assert calls == [0.0, 1.0, 3.0, 6.0, 11.0]
    assert payload.count("event: queued") == 1
    assert payload.count("event: ready") == 1
    assert payload.count(": keep-alive") == 1


def test_profile_event_stream_benchmark_reduces_60_second_unchanged_trajectory(
    monkeypatch,
) -> None:
    """Compare the old 2-second schedule with the stream's fake-clock trajectory."""
    calls: list[float] = []
    clock = _FakeClock()

    class Repository:
        def get_profile_summary(self, _job_id: str, *, workspace_id: str | None = None):
            calls.append(clock.now)
            if clock.now >= 60:
                return _summary(status="completed", job_status="succeeded")
            return _summary(status="queued", job_status="queued")

    payload = asyncio.run(_stream_payload(monkeypatch, Repository(), _FakeRequest(), clock))

    # Before: one connection read followed by the pre-change 2-second loop.
    before_calls = 1 + len(range(2, 61, 2))
    assert before_calls == 31
    assert calls == [0.0, 1.0, 3.0, 6.0, *[float(t) for t in range(11, 57, 5)], 61.0]
    assert len(calls) == 15
    assert payload.count("event: ready") == 1


def test_profile_event_stream_resets_backoff_after_meaningful_state_change(monkeypatch) -> None:
    states = [
        _summary(status="queued", job_status="queued"),
        _summary(status="queued", job_status="queued"),
        _summary(status="queued", job_status="queued"),
        _summary(status="resuming", job_status="running"),
        _summary(status="completed", job_status="succeeded"),
    ]
    calls: list[float] = []
    clock = _FakeClock()

    class Repository:
        def get_profile_summary(self, _job_id: str, *, workspace_id: str | None = None):
            assert workspace_id == "workspace-1"
            calls.append(clock.now)
            return states.pop(0)

    payload = asyncio.run(_stream_payload(monkeypatch, Repository(), _FakeRequest(), clock))

    assert calls == [0.0, 1.0, 3.0, 6.0, 7.0]
    assert "event: resuming" in payload
    assert "event: ready" in payload


def test_profile_event_stream_observes_state_change_within_maximum_interval(monkeypatch) -> None:
    calls: list[float] = []
    clock = _FakeClock()

    class Repository:
        def get_profile_summary(self, _job_id: str, *, workspace_id: str | None = None):
            calls.append(clock.now)
            if clock.now < 7:
                return _summary(status="queued", job_status="queued")
            if clock.now < 12:
                return _summary(status="resuming", job_status="running")
            return _summary(status="completed", job_status="succeeded")

    payload = asyncio.run(_stream_payload(monkeypatch, Repository(), _FakeRequest(), clock))

    # The projection changes at t=7. Its first possible observation follows
    # the current 5-second bounded interval at t=11 (4 seconds later).
    assert calls == [0.0, 1.0, 3.0, 6.0, 11.0, 12.0]
    assert "event: resuming" in payload
    assert "event: ready" in payload


def test_profile_event_stream_stops_after_terminal_event(monkeypatch) -> None:
    states = [
        _summary(status="queued", job_status="queued"),
        _summary(status="completed", job_status="succeeded"),
    ]
    calls: list[float] = []
    clock = _FakeClock()

    class Repository:
        def get_profile_summary(self, _job_id: str, *, workspace_id: str | None = None):
            calls.append(clock.now)
            return states.pop(0)

    payload = asyncio.run(_stream_payload(monkeypatch, Repository(), _FakeRequest(), clock))

    assert calls == [0.0, 1.0]
    assert payload.count("event: ready") == 1


def test_profile_event_stream_stops_before_polling_after_disconnect(monkeypatch) -> None:
    calls: list[float] = []
    clock = _FakeClock()

    class Repository:
        def get_profile_summary(self, _job_id: str, *, workspace_id: str | None = None):
            calls.append(clock.now)
            return _summary(status="queued", job_status="queued")

    payload = asyncio.run(
        _stream_payload(
            monkeypatch,
            Repository(),
            _FakeRequest(lambda: clock.now >= 1.0),
            clock,
        )
    )

    assert calls == [0.0]
    assert payload.count("event: queued") == 1


def test_profile_event_stream_preserves_sse_contract(monkeypatch) -> None:
    clock = _FakeClock()

    class Repository:
        def get_profile_summary(self, _job_id: str, *, workspace_id: str | None = None):
            return _summary(status="completed", job_status="succeeded")

    payload = asyncio.run(_stream_payload(monkeypatch, Repository(), _FakeRequest(), clock))

    lines = dict(line.split(": ", 1) for line in payload.strip().splitlines())
    assert lines["event"] == "ready"
    assert len(lines["id"]) == 24
    assert json.loads(lines["data"])["profile_run_id"] == "run-1"


def test_profile_event_stream_keeps_workspace_isolation(monkeypatch) -> None:
    calls: list[tuple[str, str | None]] = []

    class Repository:
        def get_profile_summary(self, job_id: str, *, workspace_id: str | None = None):
            calls.append((job_id, workspace_id))
            return None

    monkeypatch.setattr(routes, "get_repository", lambda: Repository())
    monkeypatch.setattr(
        routes, "get_rate_limiter", lambda: SimpleNamespace(check=lambda _: None)
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            routes.profiling_job_events(
                "run-other-workspace",
                _FakeRequest(),
                context=SimpleNamespace(user_id="user-1", workspace_id="workspace-1"),
            )
        )

    assert exc_info.value.status_code == 404
    assert calls == [("run-other-workspace", "workspace-1")]
