from __future__ import annotations

import time

import pytest

from tests.benchmark.graders.rag import (
    _safe_error,
    _with_hard_timeout,
    claim_support_ratios,
    context_precision,
    merge_grounded_evaluation,
)


def test_evaluator_hard_timeout_does_not_wait_for_blocked_sdk_call() -> None:
    started = time.perf_counter()

    with pytest.raises(TimeoutError):
        _with_hard_timeout(lambda: time.sleep(1), 0.02)

    assert time.perf_counter() - started < 0.5


def test_evaluator_timeout_has_specific_safe_reason() -> None:
    assert _safe_error(TimeoutError("socket stalled")) == "VOYAGE_EMBEDDING_TIMEOUT"


def test_context_precision_is_relevant_fraction() -> None:
    assert context_precision([True, False, False, True]) == 0.5
    assert context_precision([]) is None


def test_evidence_grounded_faithfulness_requires_support_and_citation() -> None:
    faithfulness, grounded = claim_support_ratios(
        [
            {"supported_by_context": True, "evidence_grounded": True},
            {"supported_by_context": True, "evidence_grounded": False},
            {"supported_by_context": False, "evidence_grounded": True},
        ]
    )

    assert faithfulness == 2 / 3
    assert grounded == 1 / 3


def test_grounded_metrics_survive_general_rag_grading() -> None:
    payload = {"status": "PARTIALLY_EVALUATED", "answer_relevancy": {"score": 0.4}}
    grounded = {
        "status": "EVALUATED",
        "scope": "focused_synthetic_rag",
        "case_count": 5,
        "model": "judge-model",
        "store": False,
        "aggregation": "macro mean",
        "metrics": {
            "faithfulness": 0.0,
            "context_recall": 1 / 3,
            "context_precision": 0.5,
            "evidence_grounded_faithfulness": 0.0,
        },
        "conservative_metrics": {
            "faithfulness": 0.7,
            "context_recall": 0.2,
            "context_precision": 0.3,
            "evidence_grounded_faithfulness": 0.0,
        },
        "confidence": {
            "faithfulness": {"ci95": [0.7, 1.0]},
        },
    }

    result = merge_grounded_evaluation(payload, grounded, artifact="scores/rag.json")

    assert result["status"] == "EVALUATED"
    assert result["answer_relevancy"]["score"] == 0.4
    assert result["context_recall"]["score"] == 1 / 3
    assert result["context_precision"]["eligible_cases"] == 5
    assert result["faithfulness"]["conservative_score"] == 0.7
    assert result["faithfulness"]["ci95"] == [0.7, 1.0]
    assert result["grounded_evaluator"]["store"] is False
