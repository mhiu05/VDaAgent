import json
from pathlib import Path

from judge_rubric import JudgeResult, RUBRIC_VERSION


ROOT = Path(__file__).resolve().parent


def test_judge_schema_is_versioned_and_forbids_extra_fields() -> None:
    result = JudgeResult(
        helpfulness=5,
        groundedness=5,
        tone=4,
        uncertainty_calibration=5,
        safety=5,
        decision="pass",
        reason_codes=["direct_and_grounded"],
    )
    assert RUBRIC_VERSION == "p170-llm-judge-rubric-v1"
    assert result.model_dump()["decision"] == "pass"


def test_calibration_fixture_is_synthetic_and_has_five_cases() -> None:
    fixture = json.loads((ROOT / "fixtures" / "judge_calibration_v1.json").read_text(encoding="utf-8"))
    assert fixture["rubric_version"] == RUBRIC_VERSION
    assert fixture["data_classification"] == "synthetic_only"
    assert len(fixture["cases"]) == 5
    assert {case["expected_decision"] for case in fixture["cases"]} == {"pass", "needs_review"}
