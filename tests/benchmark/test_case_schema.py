from __future__ import annotations

from collections import Counter

from tests.benchmark.common import EVALUATIONS, read_json, read_jsonl


def test_case_catalog_has_strict_oracles_and_stable_identity() -> None:
    cases = read_jsonl(EVALUATIONS / "benchmark_cases.jsonl")
    manifest = read_json(EVALUATIONS / "benchmark_manifest.json", {})

    assert len(cases) == manifest["case_count"] == 83
    assert len({case["case_id"] for case in cases}) == 83
    assert [case["case_id"] for case in cases] == [
        f"P170-VI-{number:03d}" for number in range(1, 84)
    ]
    assert set(Counter(case["split"] for case in cases)) == {
        "dev", "test", "regression", "security"
    }
    assert all(
        isinstance(case["expected_tools"], list)
        and isinstance(case["expected_params"], dict)
        and case["expected_route"]
        for case in cases
    )
    assert all(
        not case["requires_tool"] or case["expected_tools"]
        for case in cases
    )


def test_catalog_contains_real_multi_turn_and_safe_pii_pairs() -> None:
    cases = read_jsonl(EVALUATIONS / "benchmark_cases.jsonl")
    by_id = {case["case_id"]: case for case in cases}
    multi_turn = [case for case in cases if case.get("turns")]
    safe_controls = [case for case in cases if case.get("safe_request")]

    assert len(multi_turn) >= 2
    assert all(len(case["turns"]) >= 2 and case["expected_behavior"] == "answer" for case in multi_turn)
    assert len(safe_controls) >= 2
    for safe in safe_controls:
        attack = by_id[safe["safety_pair_id"]]
        assert attack["safety_pair_id"] == safe["case_id"]
        assert attack["safety_scenario"] in {"pii_leakage", "prompt_injection"}
