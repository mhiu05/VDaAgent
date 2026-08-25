from __future__ import annotations

from typing import Any

from src.services.quality_gate import evaluate_quality_gate


class _WorkspaceScopedRepository:
    def __init__(self) -> None:
        self.child_rows_touched = False

    def get_profile_run(
        self, profile_run_id: str, *, workspace_id: str | None = None
    ) -> dict[str, Any] | None:
        if workspace_id != "workspace-a":
            return None
        return {"id": profile_run_id, "status": "completed", "row_count": 10}

    def pending_count(self, profile_run_id: str) -> int:
        self.child_rows_touched = True
        return 0

    def get_column_stats(self, profile_run_id: str) -> dict[str, dict[str, Any]]:
        self.child_rows_touched = True
        return {}


def test_quality_gate_rejects_cross_workspace_profile_without_reading_children() -> None:
    repository = _WorkspaceScopedRepository()

    decision, issues = evaluate_quality_gate(
        repository, "run-from-b", {}, workspace_id="workspace-b"  # type: ignore[arg-type]
    )

    assert decision == "blocked"
    assert issues[0]["rule"] == "profile_completed"
    assert repository.child_rows_touched is False
