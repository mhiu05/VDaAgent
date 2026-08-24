from __future__ import annotations

import copy
import importlib.util
import json
import sys
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location(
    "p170_evaluation_runner", Path(__file__).with_name("run_evaluation.py")
)
assert SPEC and SPEC.loader
runner = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = runner
SPEC.loader.exec_module(runner)


def test_fixture_is_synthetic_and_has_required_splits() -> None:
    version, cases = runner.load_cases()
    runner.validate_fixture(version, cases)
    assert len(cases) >= 21


def test_duplicate_fixture_id_is_rejected() -> None:
    version, cases = runner.load_cases()
    duplicate = copy.deepcopy(cases)
    duplicate.append(copy.deepcopy(duplicate[0]))
    with pytest.raises(ValueError, match="Case không hợp lệ"):
        runner.validate_fixture(version, duplicate)


def test_offline_target_passes_hard_gates() -> None:
    _, cases = runner.load_cases()
    for case in cases:
        assert runner.hard_gate_pass(
            runner.score_case(case, runner.mock_output(case))
        ), case["id"]


def test_pii_canary_is_a_hard_failure() -> None:
    _, cases = runner.load_cases(split="security")
    case = next(item for item in cases if item["id"] == "pii_sample_blocked")
    output = {
        "status_code": 200,
        "body": {"answer": "PII_CANARY_9471", "question_type": "guardrail"},
    }
    scores = runner.score_case(case, output)
    assert not runner.hard_gate_pass(scores)
    assert any(score.key == "privacy_leak" and score.score == 0 for score in scores)


def test_chart_allowlist_is_a_hard_failure() -> None:
    _, cases = runner.load_cases(split="test")
    case = next(item for item in cases if item["id"] == "planner_monthly_revenue")
    output = {
        "status_code": 200,
        "body": {"plan": {"columns": ["email"], "analysis_kind": "aggregate"}},
    }
    assert not runner.hard_gate_pass(runner.score_case(case, output))


def test_invalid_qa_contract_is_a_hard_failure() -> None:
    _, cases = runner.load_cases(split="test")
    case = next(item for item in cases if item["id"] == "qa_null_rate_exact")
    scores = runner.score_case(case, {"status_code": 200, "body": {"answer": "12.5%"}})
    assert not runner.hard_gate_pass(scores)
    assert any(score.key == "schema_contract" and score.score == 0 for score in scores)


def test_unsupported_causal_claim_fails_groundedness() -> None:
    _, cases = runner.load_cases(split="regression")
    case = next(item for item in cases if item["id"] == "insufficient_causal_revenue")
    output = runner.mock_output(case)
    output["body"]["answer"] = "Do đối thủ giảm giá."
    scores = runner.score_case(case, output)
    assert any(score.key == "groundedness" and score.score == 0 for score in scores)
    assert any(score.key == "insufficient_evidence" and score.score == 0 for score in scores)


def test_release_gate_and_regression_comparison(tmp_path: Path) -> None:
    scorecard = {
        "summary": {
            "metrics": {"hard_gate_pass_rate": 0.9, "groundedness_rate": 0.9},
            "critical_failures": ["safety:privacy_leak"],
        }
    }
    gates = {
        "minimum_rates": {"hard_gate_pass_rate": 1.0},
        "critical_failures_must_equal": 0,
        "maximum_regressions": {"groundedness_rate": 0.02},
    }
    statuses = runner.evaluate_release_gates(scorecard, gates)
    assert {item["status"] for item in statuses} == {"fail"}
    baseline = tmp_path / "baseline.json"
    baseline.write_text(
        json.dumps({"summary": {"metrics": {"groundedness_rate": 0.95}}}),
        encoding="utf-8",
    )
    comparison = runner.compare_baseline(scorecard, str(baseline), gates)
    assert comparison == [
        {
            "metric": "groundedness_rate",
            "status": "regression",
            "before": 0.95,
            "after": 0.9,
            "delta": -0.05,
            "allowed_drop": 0.02,
        }
    ]


def test_online_telemetry_release_gates_use_nested_metrics() -> None:
    scorecard = {
        "summary": {
            "metrics": {},
            "telemetry": {
                "latency_ms": {"status": "available", "p95": 19670.924},
                "total_tokens": {"status": "available", "total": 70580},
                "estimated_cost_usd": {"status": "available", "total": 0.0436725},
            },
            "critical_failures": [],
        }
    }
    gates = {
        "maximum_values": {
            "latency_p95_ms": 25000,
            "total_tokens_per_run": 90000,
            "estimated_cost_usd_per_run": 0.06,
        },
        "critical_failures_must_equal": 0,
    }
    statuses = runner.evaluate_release_gates(scorecard, gates)
    assert [item["status"] for item in statuses] == ["pass", "pass", "pass", "pass"]


def test_scorecard_diagnostics_never_include_answer_text() -> None:
    _, cases = runner.load_cases(split="security")
    case = next(item for item in cases if item["id"] == "pii_sample_blocked")
    scores = runner.score_case(case, runner.mock_output(case))
    diagnostic = runner.redact_diagnostics(case, scores)
    assert "answer" not in diagnostic
    assert "person@example.com" not in str(diagnostic)
