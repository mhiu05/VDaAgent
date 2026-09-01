"""Regression coverage for bounded, deterministic profile QA fast paths."""

from __future__ import annotations

from typing import Any

import pytest

from src.agents import fast_paths
from src.services.qa_validation import validate_answer_evidence


@pytest.mark.parametrize(
    ("question", "expected_tool", "data", "expected_intent"),
    [
        (
            "How many rows are in this dataset?",
            "get_profile_overview",
            {"row_count": 1_250, "column_count": 8},
            "row_count",
        ),
        (
            "Cột nào có null cao nhất?",
            "get_missingness_patterns",
            {"per_column": [{"column_name": "email", "null_pct": 12.5}]},
            "missingness_ranking",
        ),
        (
            "How many duplicate rows are there?",
            "get_duplicate_analysis",
            {"duplicate_row_count": 7},
            "duplicate_rows",
        ),
    ],
)
def test_fast_paths_are_bounded_and_evidence_validated(
    monkeypatch: pytest.MonkeyPatch,
    question: str,
    expected_tool: str,
    data: dict[str, Any],
    expected_intent: str,
) -> None:
    calls: list[tuple[str, dict[str, Any], str | None]] = []

    def fake_run_tool(
        name: str, args: dict[str, Any], profile_run_id: str | None = None
    ) -> dict[str, Any]:
        calls.append((name, args, profile_run_id))
        artifact = "column_stats" if name == "get_missingness_patterns" else "profile_runs"
        return {
            "tool": name,
            "profile_run_id": profile_run_id,
            "data": data,
            "evidence": [{"artifact": artifact}],
            "is_approximate": False,
            "limitations": [],
        }

    monkeypatch.setattr(fast_paths, "run_tool", fake_run_tool)
    result = fast_paths.execute_fast_path(
        question=question,
        profile_run_id="run-1",
        workspace_id="workspace-1",
    )

    assert result is not None
    assert result["intent"] == expected_intent
    assert calls == [(expected_tool, result["sources"][0]["args"], "run-1")]
    validation = validate_answer_evidence(
        question=question,
        profile_run_id="run-1",
        workspace_id="workspace-1",
        sources=result["sources"],
        tool_results=result["tool_results"],
        answer=result["answer"],
    )
    assert validation.valid
    assert validation.evidence_status == "verified"


def test_fast_path_requires_exact_intent_match() -> None:
    assert fast_paths.resolve_fast_path("Give me a business insight") is None


def test_fast_path_answers_the_highest_frequency_category_from_profile_evidence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, dict[str, Any], str | None]] = []

    def fake_run_tool(
        name: str, args: dict[str, Any], profile_run_id: str | None = None
    ) -> dict[str, Any]:
        calls.append((name, args, profile_run_id))
        return {
            "tool": name,
            "profile_run_id": profile_run_id,
            "data": {
                "column_name": "region",
                "kind": "top_categories",
                "values": [
                    {"value": "North", "count": 42},
                    {"value": "South", "count": 35},
                ],
            },
            "evidence": [{"artifact": "column_stats"}],
            "is_approximate": False,
            "limitations": [],
        }

    monkeypatch.setattr(fast_paths, "run_tool", fake_run_tool)
    result = fast_paths.execute_fast_path(
        question="region nào có số lượng cao nhất?",
        profile_run_id="run-1",
        workspace_id="workspace-1",
        mentioned_columns=["region"],
    )

    assert result is not None
    assert result["intent"] == "highest_frequency_category"
    assert calls == [("get_distribution", {"column_name": "region", "limit": 1}, "run-1")]
    assert "North" in result["answer"]
    assert "42" in result["answer"]
    validation = validate_answer_evidence(
        question="region nào có số lượng cao nhất?",
        profile_run_id="run-1",
        workspace_id="workspace-1",
        sources=result["sources"],
        tool_results=result["tool_results"],
        answer=result["answer"],
    )
    assert validation.valid


def test_fast_path_answers_a_column_distribution_in_vietnamese(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, dict[str, Any], str | None]] = []

    def fake_run_tool(
        name: str, args: dict[str, Any], profile_run_id: str | None = None
    ) -> dict[str, Any]:
        calls.append((name, args, profile_run_id))
        return {
            "tool": name,
            "profile_run_id": profile_run_id,
            "data": {
                "column_name": "Quantity",
                "kind": "top_categories",
                "values": [
                    {"value": 1, "count": 42},
                    {"value": 2, "count": 35},
                ],
            },
            "evidence": [{"artifact": "column_stats"}],
            "is_approximate": False,
            "limitations": ["Only persisted top categories are available."],
        }

    monkeypatch.setattr(fast_paths, "run_tool", fake_run_tool)
    result = fast_paths.execute_fast_path(
        question="Show the distribution of Quantity.",
        profile_run_id="run-1",
        workspace_id="workspace-1",
        mentioned_columns=["Quantity"],
    )

    assert result is not None
    assert result["intent"] == "column_distribution"
    assert calls == [("get_distribution", {"column_name": "Quantity", "limit": 5}, "run-1")]
    assert "Phân phối đã lưu" in result["answer"]
    assert "42" in result["answer"]
    validation = validate_answer_evidence(
        question="Show the distribution of Quantity.",
        profile_run_id="run-1",
        workspace_id="workspace-1",
        sources=result["sources"],
        tool_results=result["tool_results"],
        answer=result["answer"],
    )
    assert validation.valid
