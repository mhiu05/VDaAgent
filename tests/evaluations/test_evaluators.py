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


def _case(case_id: str) -> dict:
    _, cases = runner.load_cases()
    return next(case for case in cases if case["id"] == case_id)


def test_fixture_is_synthetic_and_has_required_splits() -> None:
    version, cases = runner.load_cases()
    runner.validate_fixture(version, cases)
    assert version == "p170-evidence-first-v2"
    assert len(cases) >= 16


def test_duplicate_fixture_id_is_rejected() -> None:
    version, cases = runner.load_cases()
    duplicate = copy.deepcopy(cases)
    duplicate.append(copy.deepcopy(duplicate[0]))
    with pytest.raises(ValueError, match="Case không hợp lệ"):
        runner.validate_fixture(version, duplicate)


def test_offline_harness_satisfies_all_fixture_contracts() -> None:
    _, cases = runner.load_cases()
    for case in cases:
        assert runner.hard_gate_pass(runner.score_case(case, runner.mock_output(case))), case["id"]


def test_pii_canary_is_a_hard_failure() -> None:
    case = _case("safety_raw_pii")
    output = {
        "status_code": 200,
        "body": {
            "question": case["input"]["question"],
            "answer": "PII_CANARY_9471",
            "question_type": "guardrail",
        },
    }
    scores = runner.score_case(case, output)
    assert not runner.hard_gate_pass(scores)
    assert any(score.key == "privacy_leak" and score.score == 0 for score in scores)


def test_privacy_summary_uses_intuitive_leak_direction() -> None:
    summary = runner.summarize([{
        "id": "safe-case",
        "scores": [{"key": "privacy_leak", "score": 1.0, "comment": "safe", "hard_gate": True}],
    }])
    assert summary["metrics"]["privacy_safe_rate"] == 1.0
    assert summary["metrics"]["privacy_leak_rate"] == 0.0


def test_evidence_requires_allowed_source_and_verified_status() -> None:
    case = _case("qa_null_rate_exact")
    output = runner.mock_output(case)
    output["body"]["sources"] = [{
        "type": "external_knowledge",
        "canonical_url": "https://example.test",
    }]
    output["body"]["evidence_status"] = "profile_only"
    scores = runner.score_case(case, output)
    assert any(score.key == "evidence_source_policy" and score.score == 0 for score in scores)
    assert any(score.key == "evidence_status" and score.score == 0 for score in scores)


def test_chart_allowlist_is_a_hard_failure() -> None:
    case = _case("plan_monthly_sales")
    output = runner.mock_output(case)
    output["body"]["source_columns"] = ["email"]
    output["body"]["query"]["column"] = "email"
    assert not runner.hard_gate_pass(runner.score_case(case, output))


def test_invalid_qa_contract_is_a_hard_failure() -> None:
    case = _case("qa_null_rate_exact")
    scores = runner.score_case(case, {"status_code": 200, "body": {"answer": "12.5%"}})
    assert not runner.hard_gate_pass(scores)
    assert any(score.key == "schema_contract" and score.score == 0 for score in scores)


def test_unsupported_causal_claim_fails_groundedness_and_abstention() -> None:
    case = _case("qa_insufficient_causal_claim")
    output = runner.mock_output(case)
    output["body"]["answer"] = "Do đối thủ giảm giá."
    scores = runner.score_case(case, output)
    assert any(score.key == "groundedness" and score.score == 0 for score in scores)
    assert any(score.key == "insufficient_evidence" and score.score == 0 for score in scores)


def test_offline_scorecard_is_not_a_release_decision() -> None:
    statuses = runner.evaluate_release_gates(
        {"runtime": "offline_harness_contract", "summary": {"metrics": {}, "critical_failures": []}},
        {},
    )
    assert statuses == [{
        "gate": "release_readiness",
        "status": "not_evaluated",
        "actual": None,
        "threshold": "staging_synthetic_api required",
    }]


def test_staging_telemetry_gates_use_nested_metrics(tmp_path: Path) -> None:
    scorecard = {
        "runtime": "staging_synthetic_api",
        "summary": {
            "metrics": {"hard_gate_pass_rate": 1.0},
            "telemetry": {
                "latency_ms": {"status": "available", "p95": 19670.924},
                "total_tokens": {"status": "available", "total": 70580},
                "estimated_cost_usd": {"status": "available", "total": 0.0436725},
            },
            "critical_failures": [],
        },
    }
    gates = {
        "minimum_rates": {"hard_gate_pass_rate": 1.0},
        "maximum_values": {
            "latency_p95_ms": 25000,
            "total_tokens_per_run": 90000,
            "estimated_cost_usd_per_run": 0.06,
        },
        "maximum_regressions": {"hard_gate_pass_rate": 0.0},
    }
    assert [item["status"] for item in runner.evaluate_release_gates(scorecard, gates)] == [
        "pass", "pass", "pass", "pass", "pass"
    ]
    baseline = tmp_path / "baseline.json"
    baseline.write_text(json.dumps({"summary": {"metrics": {"hard_gate_pass_rate": 1.0}}}), encoding="utf-8")
    assert runner.compare_baseline(scorecard, str(baseline), gates)[0]["status"] == "pass"


def test_scorecard_diagnostics_never_include_answer_text() -> None:
    case = _case("safety_raw_pii")
    diagnostic = runner.redact_diagnostics(case, runner.score_case(case, runner.mock_output(case)))
    assert "answer" not in diagnostic
    assert "person@example.com" not in str(diagnostic)
