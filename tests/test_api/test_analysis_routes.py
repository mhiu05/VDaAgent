"""Contract tests for the Phase-1 bounded analysis workspace."""

from __future__ import annotations


def test_quick_analysis_lifecycle_and_evidence(client, reviewed_profile_run: dict) -> None:
    created = client.post("/api/v1/analysis-sessions", json={
        "profile_run_id": reviewed_profile_run["profile_run_id"],
        "mode": "quick",
        "goal": "Compare salary totals by city",
    })
    assert created.status_code == 201, created.text
    session = created.json()
    assert session["status"] == "needs_context"

    context = client.post(f"/api/v1/analysis-sessions/{session['id']}/context-versions", json={
        "row_grain": "one user", "dimensions": ["city"], "measures": ["salary"],
        "keys": ["user_id"], "ignored_columns": ["email", "phone"], "limitations": [],
    })
    assert context.status_code == 201, context.text
    context_id = context.json()["id"]
    approved = client.post(f"/api/v1/analysis-sessions/{session['id']}/context-versions/{context_id}/approve", json={"approved_by": "analyst"})
    assert approved.status_code == 200, approved.text
    gate = client.post(f"/api/v1/analysis-sessions/{session['id']}/quality-gate")
    assert gate.status_code == 200, gate.text
    assert gate.json()["decision"] in {"passed", "warning"}

    execution = client.post(f"/api/v1/analysis-sessions/{session['id']}/executions", json={
        "expected_context_version_id": context_id,
        "query": {"aggregate": "sum", "column": "salary", "dimensions": ["city"], "filters": [], "limit": 10},
    })
    assert execution.status_code == 201, execution.text
    body = execution.json()
    assert body["result"]["row_count"] == 3
    assert body["evidence"]["execution_id"] == body["id"]
    assert len(body["result_hash"]) == 64


def test_analysis_blocks_pii_grouping(client, reviewed_profile_run: dict) -> None:
    session = client.post("/api/v1/analysis-sessions", json={
        "profile_run_id": reviewed_profile_run["profile_run_id"], "mode": "quick", "goal": "Unsafe grouping"
    }).json()
    context = client.post(f"/api/v1/analysis-sessions/{session['id']}/context-versions", json={
        "dimensions": ["email"], "measures": [], "keys": [], "ignored_columns": [], "limitations": []
    }).json()
    client.post(f"/api/v1/analysis-sessions/{session['id']}/context-versions/{context['id']}/approve", json={"approved_by": "analyst"})
    client.post(f"/api/v1/analysis-sessions/{session['id']}/quality-gate")
    response = client.post(f"/api/v1/analysis-sessions/{session['id']}/executions", json={
        "expected_context_version_id": context["id"],
        "query": {"aggregate": "count", "dimensions": ["email"], "filters": [], "limit": 10},
    })
    assert response.status_code == 422
    assert "PII" in response.json()["detail"]


def test_combined_report_is_bounded_and_masks_pending_or_confirmed_pii(
    client, reviewed_profile_run: dict
) -> None:
    response = client.get(
        f"/api/v1/profile/{reviewed_profile_run['profile_run_id']}/report"
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["export_policy"]["raw_rows"] is False
    assert "source_ref" not in body["profile"]["dataset"]
    email = next(item for item in body["profile"]["column_stats"] if item["column_name"] == "email")
    assert email["top_k_values"] is None
    assert all("executions" in session for session in body["analysis_sessions"])
