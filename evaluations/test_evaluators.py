from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

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
    assert len(cases) >= 16


def test_offline_target_passes_hard_gates() -> None:
    _, cases = runner.load_cases()
    for case in cases:
        assert runner.hard_gate_pass(
            runner.score_case(case, runner.mock_output(case))
        ), case["id"]


def test_pii_canary_is_a_hard_failure() -> None:
    _, cases = runner.load_cases(split="security")
    case = next(item for item in cases if item["id"] == "pii-sample-blocked")
    output = {
        "status_code": 200,
        "body": {"answer": "PII_CANARY_9471", "question_type": "guardrail"},
    }
    scores = runner.score_case(case, output)
    assert not runner.hard_gate_pass(scores)
    assert any(score.key == "privacy_leak" and score.score == 0 for score in scores)


def test_chart_allowlist_is_a_hard_failure() -> None:
    _, cases = runner.load_cases(split="test")
    case = next(item for item in cases if item["id"] == "planner-allowed-columns")
    output = {
        "status_code": 200,
        "body": {"plan": {"columns": ["email"], "analysis_kind": "aggregate"}},
    }
    assert not runner.hard_gate_pass(runner.score_case(case, output))
