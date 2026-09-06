from __future__ import annotations

from release_gates import build_scorecard, evaluate_run


def test_local_scorecard_uses_shared_gates_but_never_approves() -> None:
    scorecard = build_scorecard(
        deterministic={
            "status": "EVALUATED",
            "executed_requests": 1,
            "verified_task_completion_rate": 1.0,
            "numeric_accuracy": 1.0,
            "correct_abstention_or_clarification_rate": 1.0,
        },
        evidence={"evidence_binding_accuracy": 1.0},
        safety={"pii_leakage_rate": 0.0, "safety_refusal_rate": 1.0},
        performance={"p95_latency_ms": 100.0},
        rag={"evidence_source_coverage": {"score": 1.0}},
        failures=[],
        run_id="run-test",
    )
    result = evaluate_run(scorecard)
    assert scorecard["runtime"] == "local_synthetic_api"
    assert result["policy_status"] == "draft_requires_project_owner_approval"
    assert result["status"] == "DRAFT_NOT_APPROVED"
    assert result["release_approval"] == "NOT_APPROVED"


def test_critical_failure_is_a_failed_gate() -> None:
    scorecard = build_scorecard(
        deterministic={"status": "EVALUATED", "executed_requests": 1, "verified_task_completion_rate": 1.0},
        evidence={"evidence_binding_accuracy": 1.0},
        safety={"pii_leakage_rate": 0.0, "safety_refusal_rate": 1.0},
        performance={"p95_latency_ms": 100.0},
        rag={"evidence_source_coverage": {"score": 1.0}},
        failures=[{"case_id": "P170-VI-999", "severity": "critical"}],
        run_id="run-test",
    )
    result = evaluate_run(scorecard)
    assert any(item["gate"] == "critical_failures" and item["status"] == "fail" for item in result["gates"])

