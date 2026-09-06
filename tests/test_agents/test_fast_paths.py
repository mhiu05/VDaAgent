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


def test_chart_recommendation_does_not_become_an_outlier_metric_fast_path() -> None:
    question = "Đề xuất biểu đồ để phát hiện outlier của doanh_thu."

    assert fast_paths.is_fast_path_question(question, ["doanh_thu"]) is False
    assert fast_paths.execute_fast_path(
        question=question,
        profile_run_id="run-1",
        workspace_id="workspace-1",
        mentioned_columns=["doanh_thu"],
    ) is None


def test_verifiable_numeric_pair_insight_uses_correlation_fast_path(
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
                "column_a": "doanh_thu",
                "column_b": "giam_gia",
                "pearson_r": -0.42,
            },
            "evidence": [{"artifact": "correlations"}],
            "is_approximate": False,
        }

    monkeypatch.setattr(fast_paths, "run_tool", fake_run_tool)
    question = (
        "So sánh doanh_thu và giam_gia: insight nào có thể kiểm chứng từ Profile Run?"
    )

    result = fast_paths.execute_fast_path(
        question=question,
        profile_run_id="run-1",
        workspace_id="workspace-1",
        mentioned_columns=["doanh_thu", "giam_gia"],
    )

    assert result is not None
    assert result["intent"] == "column_correlation"
    assert calls == [
        (
            "get_correlation",
            {"column_a": "doanh_thu", "column_b": "giam_gia"},
            "run-1",
        )
    ]
    assert "-0.42" in result["answer"]


def test_fast_path_returns_bound_evidence_for_a_named_column(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        fast_paths,
        "run_tool",
        lambda name, args, profile_run_id=None: {
            "tool": name,
            "profile_run_id": profile_run_id,
            "data": {"column_name": "gia_tri_rong", "null_count": 40},
            "evidence": [{"artifact": "column_stats"}],
            "is_approximate": False,
            "limitations": [],
        },
    )

    result = fast_paths.execute_fast_path(
        question="Hãy chỉ ra Profile Run/bằng chứng cho nhận định về cột gia_tri_rong.",
        profile_run_id="run-1",
        workspace_id="workspace-1",
        mentioned_columns=["gia_tri_rong"],
    )

    assert result is not None
    assert result["intent"] == "column_evidence"
    assert result["sources"][0]["tool"] == "get_column_profile"
    assert "40" in result["answer"]


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
            "evidence": [{"artifact": "correlation_matrix" if name == "get_correlation" else "column_stats"}],
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
                    {"value": "1", "count": 42},
                    {"value": "2", "count": 35},
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


@pytest.mark.parametrize(
    ("question", "columns", "expected_tool", "expected_args", "data", "needle"),
    [
        (
            "Doanh thu trung bình của cột doanh_thu là bao nhiêu?",
            ["doanh_thu"],
            "get_column_profile",
            {"column_name": "doanh_thu", "fields": ["mean"]},
            {"column_name": "doanh_thu", "mean": 1250000.5},
            "1,250,000",
        ),
        (
            "Hãy dùng dữ liệu đã profile để kiểm tra missingness của tuoi và dẫn evidence.",
            ["tuoi"],
            "get_column_profile",
            {"column_name": "tuoi", "fields": ["null_count"]},
            {"column_name": "tuoi", "null_count": 3},
            "3",
        ),
        (
            "Tương quan giữa so_don_hang và doanh_thu là bao nhiêu?",
            ["so_don_hang", "doanh_thu"],
            "get_correlation",
            {"column_a": "so_don_hang", "column_b": "doanh_thu"},
            {"column_a": "so_don_hang", "column_b": "doanh_thu", "pearson_r": 0.82},
            "0.82",
        ),
        (
            "Cột doanh_thu có bao nhiêu giá trị bất thường?",
            ["doanh_thu"],
            "get_outlier_summary",
            {"column_name": "doanh_thu"},
            {"column_name": "doanh_thu", "outlier_count": 7, "outlier_method": "IQR"},
            "7",
        ),
        (
            "Có dấu hiệu doanh_thu cực trị cần kiểm tra không?",
            ["doanh_thu"],
            "get_outlier_summary",
            {"column_name": "doanh_thu"},
            {
                "column_name": "doanh_thu",
                "outlier_count": 7,
                "outlier_method": "IQR",
            },
            "7",
        ),
    ],
)
def test_fast_path_answers_explicit_persisted_column_metrics(
    monkeypatch: pytest.MonkeyPatch,
    question: str,
    columns: list[str],
    expected_tool: str,
    expected_args: dict[str, Any],
    data: dict[str, Any],
    needle: str,
) -> None:
    calls: list[tuple[str, dict[str, Any], str | None]] = []

    def fake_run_tool(
        name: str, args: dict[str, Any], profile_run_id: str | None = None
    ) -> dict[str, Any]:
        calls.append((name, args, profile_run_id))
        return {
            "tool": name,
            "profile_run_id": profile_run_id,
            "data": data,
            "evidence": [
                {
                    "artifact": "correlation_matrix"
                    if name == "get_correlation"
                    else "column_stats"
                }
            ],
            "is_approximate": False,
            "limitations": [],
        }

    monkeypatch.setattr(fast_paths, "run_tool", fake_run_tool)
    result = fast_paths.execute_fast_path(
        question=question,
        profile_run_id="run-1",
        workspace_id="workspace-1",
        mentioned_columns=columns,
    )

    assert result is not None
    assert calls == [(expected_tool, expected_args, "run-1")]
    assert needle in result["answer"]
    assert validate_answer_evidence(
        question=question,
        profile_run_id="run-1",
        workspace_id="workspace-1",
        sources=result["sources"],
        tool_results=result["tool_results"],
        answer=result["answer"],
    ).valid


def test_fast_path_answers_boolean_column_uniqueness_without_llm(
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
                "column_name": "ma_khach_hang",
                "uniqueness_ratio": 1.0,
                "null_count": 0,
            },
            "evidence": [{"artifact": "column_stats"}],
            "is_approximate": False,
            "limitations": [],
        }

    monkeypatch.setattr(fast_paths, "run_tool", fake_run_tool)
    question = "Cột ma_khach_hang có duy nhất cho từng dòng không?"
    result = fast_paths.execute_fast_path(
        question=question,
        profile_run_id="run-1",
        workspace_id="workspace-1",
        mentioned_columns=["ma_khach_hang"],
    )

    assert result is not None
    assert result["intent"] == "column_is_unique"
    assert result["answer"].startswith("Có.")
    assert calls == [
        (
            "get_column_profile",
            {
                "column_name": "ma_khach_hang",
                "fields": ["uniqueness_ratio", "null_count"],
            },
            "run-1",
        )
    ]
    assert validate_answer_evidence(
        question=question,
        profile_run_id="run-1",
        workspace_id="workspace-1",
        sources=result["sources"],
        tool_results=result["tool_results"],
        answer=result["answer"],
    ).valid


def test_fast_path_renders_persisted_drift_change(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_run_tool(name: str, args: dict[str, Any], profile_run_id: str | None = None) -> dict[str, Any]:
        assert name == "get_drift_findings"
        return {
            "tool": name,
            "profile_run_id": profile_run_id,
            "data": {"findings": [{"column_name": "gia_tri_giao_dich", "metric": "mean", "before": 100.0, "after": 125.0}]},
            "evidence": [{"artifact": "drift_reports"}],
            "is_approximate": False,
            "limitations": [],
        }

    monkeypatch.setattr(fast_paths, "run_tool", fake_run_tool)
    result = fast_paths.execute_fast_path(
        question="Trung bình gia_tri_giao_dich thay đổi bao nhiêu giữa hai phiên bản?",
        profile_run_id="run-1",
        workspace_id="workspace-1",
        mentioned_columns=["gia_tri_giao_dich"],
    )
    assert result is not None
    assert result["intent"] == "drift_metric_change"
    assert "25" in result["answer"]


def test_fast_path_renders_persisted_median_drift_change(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_run_tool(name: str, args: dict[str, Any], profile_run_id: str | None = None) -> dict[str, Any]:
        assert name == "get_drift_findings"
        return {
            "tool": name,
            "profile_run_id": profile_run_id,
            "data": {
                "findings": [
                    {
                        "column_name": "gia_tri_giao_dich",
                        "metric": "mean",
                        "before": 100.0,
                        "after": 125.0,
                    },
                    {
                        "column_name": "gia_tri_giao_dich",
                        "metric": "median",
                        "before": 1_762_500.0,
                        "after": 3_155_000.0,
                    },
                ]
            },
            "evidence": [{"artifact": "drift_reports"}],
            "is_approximate": False,
            "limitations": [],
        }

    monkeypatch.setattr(fast_paths, "run_tool", fake_run_tool)
    question = "Trung vi gia_tri_giao_dich thay doi bao nhieu giua hai phien ban?"
    result = fast_paths.execute_fast_path(
        question=question,
        profile_run_id="run-1",
        workspace_id="workspace-1",
        mentioned_columns=["gia_tri_giao_dich"],
    )
    assert result is not None
    assert result["intent"] == "drift_metric_change"
    assert "1,392,500" in result["answer"]
    assert validate_answer_evidence(
        question=question,
        profile_run_id="run-1",
        workspace_id="workspace-1",
        sources=result["sources"],
        tool_results=result["tool_results"],
        answer=result["answer"],
    ).valid


def test_fast_path_renders_versioned_top_category_from_drift_evidence(
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
                "findings": [
                    {
                        "column_name": "kenh_ban",
                        "metric": "top_category",
                        "before": "Website",
                        "after": "Ứng dụng",
                    }
                ]
            },
            "evidence": [{"artifact": "drift_reports"}],
            "is_approximate": False,
            "limitations": [],
        }

    monkeypatch.setattr(fast_paths, "run_tool", fake_run_tool)
    result = fast_paths.execute_fast_path(
        question="Kênh bán phổ biến nhất ở drift_v1 là gì?",
        profile_run_id="run-2",
        workspace_id="workspace-1",
        mentioned_columns=["kenh_ban"],
    )

    assert result is not None
    assert "Website" in result["answer"]
    assert "Ứng dụng" not in result["answer"]
    assert calls == [
        (
            "get_drift_findings",
            {"column_name": "kenh_ban"},
            "run-2",
        )
    ]


def test_drift_wording_takes_precedence_over_plain_row_count(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_run_tool(name: str, args: dict[str, Any], profile_run_id: str | None = None) -> dict[str, Any]:
        assert name == "get_drift_findings"
        assert args == {}
        return {
            "tool": name,
            "profile_run_id": profile_run_id,
            "data": {
                "findings": [
                    {
                        "column_name": "__dataset__",
                        "metric": "row_count",
                        "before": 80,
                        "after": 100,
                    }
                ]
            },
            "evidence": [{"artifact": "drift_reports"}],
            "is_approximate": False,
            "limitations": [],
        }

    monkeypatch.setattr(fast_paths, "run_tool", fake_run_tool)
    result = fast_paths.execute_fast_path(
        question="Số dòng thay đổi bao nhiêu từ drift_v1 sang drift_v2?",
        profile_run_id="run-2",
        workspace_id="workspace-1",
        mentioned_columns=[],
    )
    assert result is not None
    assert result["intent"] == "drift_metric_change"
    assert "20" in result["answer"]
