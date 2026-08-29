"""Focused unit coverage for the durable, workspace-scoped profiling stream."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

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

    async def no_wait(_: float) -> None:
        return None

    monkeypatch.setattr(routes, "get_repository", lambda: Repository())
    monkeypatch.setattr(routes, "get_rate_limiter", lambda: SimpleNamespace(check=lambda _: None))
    monkeypatch.setattr(routes.asyncio, "sleep", no_wait)

    async def collect() -> str:
        response = await routes.profiling_job_events(
            "run-1", context=SimpleNamespace(user_id="user-1", workspace_id="workspace-1")
        )
        chunks: list[str] = []
        async for chunk in response.body_iterator:
            chunks.append(chunk.decode() if isinstance(chunk, bytes) else chunk)
        return "".join(chunks)

    payload = asyncio.run(collect())

    assert payload.count("event: queued") == 1
    assert payload.count("event: ready") == 1
    assert "evidence" not in payload
    assert calls == [("run-1", "workspace-1")] * 3
