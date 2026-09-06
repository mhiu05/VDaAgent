from __future__ import annotations

import time
import sys
from pathlib import Path
from threading import Event
from types import SimpleNamespace
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from run_production_benchmark import Production, _local_auth_identity, _missing_datasets


def test_ask_enforces_hard_wall_clock_deadline() -> None:
    client = object.__new__(Production)
    release_worker = Event()

    def blocked_stream(*args: Any, **kwargs: Any) -> dict[str, Any]:
        release_worker.wait(timeout=1.0)
        return {"status_code": 200}

    client._ask_stream = blocked_stream
    started = time.perf_counter()
    try:
        result = client.ask("question", "profile-run", case_timeout=0.02)
    finally:
        release_worker.set()

    assert time.perf_counter() - started < 0.25
    assert result["status_code"] == 504
    assert result["response"] == {"detail": "benchmark_case_timeout"}
    assert result["telemetry"]["hard_deadline_enforced"] is True


def test_partial_reuse_reports_only_missing_required_datasets() -> None:
    selected = [
        {"dataset": "profiling_base"},
        {"dataset": "profiling_edge_cases"},
        {"dataset": "drift_v2"},
    ]
    mappings = {
        "profiling_base": {"profile_run_id": "base"},
        "drift_v1": {"profile_run_id": "drift-base"},
        "drift_v2": {"profile_run_id": "drift-current"},
    }

    assert _missing_datasets(selected, mappings) == ["profiling_edge_cases"]


def test_local_auth_identity_is_preserved_explicitly() -> None:
    previous = {"local_auth_identity": "run-origin"}

    assert _local_auth_identity(previous, "run-middle", "run-new") == "run-origin"


def test_local_auth_identity_migrates_legacy_workspace_name() -> None:
    previous = {"workspace_name": "benchmark-run-20260904T074020-4cb1b7ec"}

    assert (
        _local_auth_identity(previous, "run-middle", "run-new")
        == "run-20260904T074020-4cb1b7ec"
    )


def test_reused_profile_preflight_uses_lightweight_summary() -> None:
    client = object.__new__(Production)
    calls: list[tuple[str, str]] = []

    def request(method: str, path: str, **_kwargs: Any) -> Any:
        calls.append((method, path))
        return SimpleNamespace(
            status_code=200,
            raise_for_status=lambda: None,
            json=lambda: {"status": "completed"},
        )

    client.request = request

    ready = client.advance_profile(
        "profiling_base.csv",
        {"profile_run_id": "run-1"},
        auto_confirm=False,
        missing_is_error=True,
    )

    assert ready is True
    assert calls == [("GET", "/profile/run-1/summary")]
