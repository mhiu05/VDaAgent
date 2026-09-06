from __future__ import annotations

from graders.statistics import binomial_ci


def test_wilson_interval_does_not_collapse_at_all_pass() -> None:
    result = binomial_ci(83, 83)

    assert result["mean"] == 1.0
    assert 0.95 < result["ci95"][0] < 1.0
    assert result["ci95"][1] == 1.0
    assert result["ci_method"] == "wilson_score_95"


def test_wilson_interval_does_not_collapse_at_zero_pass() -> None:
    result = binomial_ci(0, 83)

    assert result["ci95"][0] == 0.0
    assert 0.0 < result["ci95"][1] < 0.05


def test_empty_sample_remains_not_evaluated() -> None:
    assert binomial_ci(0, 0) == {"status": "NOT_EVALUATED"}
