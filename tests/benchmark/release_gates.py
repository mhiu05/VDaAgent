"""Evaluate the benchmark run against the versioned release-gate policy.

The benchmark runner is intentionally local-first, but it still uses the same
gate evaluator as the staging scorecard.  Missing telemetry is reported as
``not_available`` instead of being treated as a zero or a pass.  The policy is
draft-only until a project owner approves it, so this module never emits a
production approval.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any


_EVALUATIONS_CODE = Path(__file__).resolve().parents[1] / "evaluations"
if str(_EVALUATIONS_CODE) not in sys.path:
    sys.path.insert(0, str(_EVALUATIONS_CODE))

from run_evaluation import compare_baseline, evaluate_release_gates  # noqa: E402

from common import EVALUATIONS, read_json  # noqa: E402


GATES_PATH = EVALUATIONS.parent / "tests" / "evaluations" / "release_gates.json"


def _available(value: Any) -> float | int | None:
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _inverse_rate(value: Any) -> float | None:
    numeric = _available(value)
    return round(1.0 - float(numeric), 6) if numeric is not None else None


def build_scorecard(
    *,
    deterministic: dict[str, Any],
    evidence: dict[str, Any],
    safety: dict[str, Any],
    performance: dict[str, Any],
    rag: dict[str, Any],
    failures: list[dict[str, Any]],
    run_id: str,
) -> dict[str, Any]:
    """Project benchmark artifacts into the shared scorecard gate schema."""

    metrics = {
        "hard_gate_pass_rate": _available(deterministic.get("verified_task_completion_rate")),
        "schema_contract_rate": (
            1.0 if deterministic.get("status") == "EVALUATED" and deterministic.get("executed_requests", 0) else None
        ),
        "privacy_safe_rate": _inverse_rate(safety.get("pii_leakage_rate")),
        "safety_outcome_rate": _available(safety.get("safety_refusal_rate")),
        "evidence_binding_rate": _available(evidence.get("evidence_binding_accuracy")),
        "evidence_source_policy_rate": _available(rag.get("evidence_source_coverage", {}).get("score")),
        "evidence_status_rate": _available(evidence.get("evidence_binding_accuracy")),
        "numeric_grounding_rate": _available(deterministic.get("numeric_accuracy")),
        "approximation_rate": _available(deterministic.get("numeric_accuracy")),
        "insufficient_evidence_rate": _available(deterministic.get("correct_abstention_or_clarification_rate")),
        "forecast_calibration_rate": None,
        "planner_allowlist_rate": None,
        "planner_kind_rate": None,
    }
    critical_failures = [
        item.get("case_id", "unknown")
        for item in failures
        if str(item.get("severity", "")).casefold() == "critical"
    ]
    return {
        "schema_version": "p170-benchmark-scorecard-v1",
        "run_id": run_id,
        "runtime": "local_synthetic_api",
        "dataset_version": "p170-vi-v2",
        "summary": {
            "metrics": metrics,
            "critical_failures": critical_failures,
            "failed_cases": [item.get("case_id", "unknown") for item in failures],
            "telemetry": {
                "latency_ms": {
                    "status": "available" if _available(performance.get("p95_latency_ms")) is not None else "not_available",
                    "p95": _available(performance.get("p95_latency_ms")),
                }
            },
        },
    }


def evaluate_run(
    scorecard: dict[str, Any],
    *,
    baseline_path: str | None = None,
) -> dict[str, Any]:
    """Return gate and regression results with an explicit draft-only status."""

    gates = read_json(GATES_PATH, {})
    gate_results = evaluate_release_gates(scorecard, gates)
    regressions = compare_baseline(scorecard, baseline_path, gates)
    return {
        "status": "DRAFT_NOT_APPROVED",
        "policy_status": gates.get("status", "draft_requires_project_owner_approval"),
        "approval_scope": gates.get("approval_scope"),
        "gate_version": gates.get("version"),
        "runtime": scorecard.get("runtime"),
        "all_gates_pass": bool(gate_results) and all(item.get("status") == "pass" for item in gate_results),
        "gates": gate_results,
        "regressions": regressions,
        "release_approval": "NOT_APPROVED",
    }

