from __future__ import annotations

from tests.benchmark.graders import agentic, rag


def test_validated_semantic_cache_replay_preserves_logical_route() -> None:
    case = {
        "case_id": "P170-VI-001",
        "expected_route": "deterministic_profile",
        "expected_tools": ["get_profile_overview"],
        "expected_params": {},
        "requires_tool": True,
    }
    result = {
        "status": "OK",
        "route": "semantic_cache",
        "sources": [{"tool": "get_profile_overview", "status": "ok"}],
        "provenance": {"evidence_status": "verified"},
    }

    scored = agentic.score(case, result)

    assert scored["routing_pass"] is True
    assert scored["route"] == "semantic_cache"


def test_source_coverage_only_counts_cases_that_require_evidence(monkeypatch) -> None:
    monkeypatch.setattr(
        rag,
        "_answer_relevancy",
        lambda _cases, _results: {"status": "NOT_EVALUATED", "score": None},
    )
    cases = {
        "required": {"expected_evidence": {"required": True}},
        "abstain": {"expected_evidence": {"required": False}},
    }
    results = [
        {
            "case_id": "required",
            "status": "OK",
            "sources": [{"tool": "get_profile_overview"}],
            "provenance": {"evidence_status": "verified"},
        },
        {
            "case_id": "abstain",
            "status": "OK",
            "sources": [],
            "provenance": {"evidence_status": "no_evidence"},
        },
    ]

    scored = rag.score(cases, results, {}, {})["evidence_source_coverage"]

    assert scored["status"] == "EVALUATED"
    assert scored["eligible_requests"] == 1
    assert scored["observed_requests"] == 1
    assert scored["score"] == 1.0


def test_tool_selection_is_order_independent_and_params_bind_to_right_tool() -> None:
    case = {
        "case_id": "candidate-key",
        "expected_route": "deterministic_tool",
        "expected_tools": ["get_candidate_keys", "get_column_profile"],
        "expected_params": {"column_name": "customer_id"},
        "requires_tool": True,
    }
    result = {
        "status": "OK",
        "route": "deterministic_tool",
        "sources": [
            {"tool": "get_candidate_keys", "args": {"limit": 10}, "status": "ok"},
            {
                "tool": "get_column_profile",
                "args": {"column_name": "customer_id"},
                "status": "ok",
            },
        ],
    }
    trace = {
        "actual_route": "deterministic_tool",
        "tools": [
            {"tool_name": "get_column_profile", "status": "completed"},
            {"tool_name": "get_candidate_keys", "status": "completed"},
        ],
    }

    scored = agentic.score(case, result, trace)

    assert scored["tool_selection_pass"] is True
    assert scored["parameter_accuracy_pass"] is True


def test_public_sources_win_over_duplicate_observability_spans() -> None:
    case = {
        "case_id": "candidate-key",
        "expected_route": "deterministic_tool",
        "expected_tools": ["get_candidate_keys", "get_column_profile"],
        "expected_params": {"column_name": "customer_id"},
        "requires_tool": True,
    }
    result = {
        "status": "OK",
        "route": "deterministic_tool",
        "sources": [
            {"tool": "get_candidate_keys", "args": {"limit": 10}, "status": "ok"},
            {
                "tool": "get_column_profile",
                "args": {"column_name": "customer_id"},
                "status": "ok",
            },
        ],
    }
    trace = {
        "actual_route": "deterministic_tool",
        "tools": [
            {"tool_name": "get_candidate_keys", "status": "completed"},
            {"tool_name": "get_column_profile", "status": "completed"},
            {"tool_name": "get_column_profile", "status": "completed"},
        ],
    }

    scored = agentic.score(case, result, trace)

    assert scored["tool_selection_pass"] is True


def test_correlation_parameter_pair_is_symmetric() -> None:
    case = {
        "case_id": "correlation",
        "expected_route": "deterministic_profile",
        "expected_tools": ["get_correlation"],
        "expected_params": {"column_a": "sales", "column_b": "orders"},
        "requires_tool": True,
    }
    result = {
        "status": "OK",
        "route": "deterministic_profile",
        "sources": [
            {
                "tool": "get_correlation",
                "args": {"column_a": "orders", "column_b": "sales"},
                "status": "ok",
            }
        ],
    }

    scored = agentic.score(case, result)

    assert scored["parameter_accuracy_pass"] is True
