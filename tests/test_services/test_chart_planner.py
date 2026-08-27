from __future__ import annotations

import pytest
from src.services.chart_planner import (
    ChartPlanCandidate,
    build_auto_profile_pack,
    build_chart_plan,
    chart_planning_rejection_reason,
)

CONTEXT = {
    "dimensions": ["order_date", "region", "channel"],
    "measures": ["sales", "cost"],
    "time_column": "order_date",
}
STATS = {
    "order_date": {"dtype": "date", "max": "2026-08-20"},
    "region": {"dtype": "string", "cardinality": 4},
    "channel": {"dtype": "string", "cardinality": 2},
    "sales": {"dtype": "float"},
    "cost": {"dtype": "float"},
}


def test_business_trend_becomes_monthly_line_query() -> None:
    plan = build_chart_plan(
        "Doanh số thay đổi thế nào trong 12 tháng?", CONTEXT, STATS
    )

    assert plan["problem"] == "trend"
    assert plan["algorithm"] == "sum"
    assert plan["chart_type"] == "line"
    assert plan["renderer"] == "native-svg"
    assert plan["query"]["dimensions"] == ["order_date"]
    assert plan["query"]["column"] == "sales"
    assert plan["query"]["time_grain"] == "month"
    assert plan["query"]["filters"] == [
        {"column": "order_date", "operator": "gte", "value": "2025-09-01"},
        {"column": "order_date", "operator": "lt", "value": "2026-09-01"},
    ]


def test_explicit_top_n_is_preserved_in_ranking_query() -> None:
    plan = build_chart_plan(
        "Top 12 khu vuc co doanh so cao nhat", CONTEXT, STATS
    )

    assert plan["problem"] == "ranking"
    assert plan["chart_type"] == "bar"
    assert plan["query"]["limit"] == 12


def test_proportional_numeric_question_is_planned_as_measure_relationship() -> None:
    context = {
        "dimensions": ["payment_type"],
        "measures": ["initial_down_payment", "total_amount"],
        "time_column": None,
    }
    stats = {
        "payment_type": {"dtype": "string", "cardinality": 3},
        "initial_down_payment": {"dtype": "float"},
        "total_amount": {"dtype": "float"},
    }

    plan = build_chart_plan(
        "Does initial down payment increase in proportion to total amount?",
        context,
        stats,
    )

    assert plan["problem"] == "relationship"
    assert plan["algorithm"] == "scatter"
    assert plan["chart_type"] == "scatter"
    assert {plan["query"]["x_column"], plan["query"]["y_column"]} == {
        "initial_down_payment",
        "total_amount",
    }


def test_ascii_only_planner_rationale_is_replaced_with_vietnamese_copy() -> None:
    candidate = ChartPlanCandidate(
        problem="relationship",
        algorithm="scatter",
        x_column="sales",
        y_column="cost",
        title="Sales and cost relationship",
        rationale="Compare sales and cost using a scatter plot.",
    )

    plan = build_chart_plan("Mối quan hệ giữa sales và cost", CONTEXT, STATS, candidate)

    assert "biểu đồ phân tán" in plan["rationale"]
    assert "sales" in plan["rationale"]


@pytest.mark.parametrize(
    ("question", "context", "stats", "expected_fragment"),
    [
        ("Xu huong doanh so theo thang", {"dimensions": ["region"], "measures": ["sales"]}, {"region": {"dtype": "string"}, "sales": {"dtype": "float"}}, "cột ngày/thời gian"),
        ("Mối quan hệ giữa sales và cost", {"dimensions": ["region"], "measures": ["sales"]}, {"region": {"dtype": "string"}, "sales": {"dtype": "float"}}, "hai cột số"),
        ("Phân phối theo region", {"dimensions": ["region"], "measures": []}, {"region": {"dtype": "string"}}, "cột số"),
    ],
)
def test_unchartable_questions_return_an_actionable_reason(
    question: str, context: dict[str, object], stats: dict[str, object], expected_fragment: str
) -> None:
    reason = chart_planning_rejection_reason(question, context, stats)

    assert reason is not None
    assert expected_fragment in reason


def test_distribution_and_relationship_choose_bounded_analysis_kinds() -> None:
    distribution = build_chart_plan("Phân phối sales có outlier không?", CONTEXT, STATS)
    relationship = build_chart_plan(
        "Mối quan hệ giữa sales và cost là gì?", CONTEXT, STATS
    )

    assert distribution["algorithm"] == "box"
    assert distribution["query"]["analysis_kind"] == "box"
    assert relationship["algorithm"] == "scatter"
    assert relationship["query"]["analysis_kind"] == "scatter"
    assert {relationship["query"]["x_column"], relationship["query"]["y_column"]} == {
        "sales",
        "cost",
    }


def test_model_cannot_inject_unknown_column_or_incompatible_algorithm() -> None:
    candidate = ChartPlanCandidate(
        problem="trend",
        algorithm="heatmap",
        x_column="DROP TABLE profiles",
        y_column="secret",
        second_dimension="password",
        time_grain="month",
        title="Unsafe proposal",
        rationale="Model proposal must be normalized.",
    )

    plan = build_chart_plan(
        "Doanh số theo tháng", CONTEXT, STATS, candidate, planning_mode="agent"
    )

    serialized = str(plan)
    assert "DROP TABLE" not in serialized
    assert "password" not in serialized
    assert plan["problem"] == "trend"
    assert plan["algorithm"] == "sum"
    assert plan["query"]["column"] == "sales"


def test_agent_plan_is_kept_only_when_columns_and_method_are_allowed() -> None:
    candidate = ChartPlanCandidate(
        problem="ranking",
        algorithm="mean",
        x_column="region",
        y_column="cost",
        title="Chi phí trung bình theo khu vực",
        rationale="So sánh measure theo dimension để tìm nhóm nổi bật.",
    )

    plan = build_chart_plan(
        "Khu vực nào có chi phí trung bình cao nhất?",
        CONTEXT,
        STATS,
        candidate,
        planning_mode="agent",
    )

    assert plan["planning_mode"] == "agent"
    assert plan["query"]["aggregate"] == "mean"
    assert plan["query"]["column"] == "cost"
    assert plan["query"]["dimensions"] == ["region"]


def test_business_forecast_selects_bounded_model_and_horizon() -> None:
    plan = build_chart_plan(
        "Dự báo sales cho 6 tháng tới bằng seasonal naive",
        CONTEXT,
        STATS,
    )

    assert plan["problem"] == "forecast"
    assert plan["algorithm"] == "seasonal_naive"
    assert plan["chart_type"] == "line"
    assert plan["query"]["analysis_kind"] == "forecast"
    assert plan["query"]["dimensions"] == ["order_date"]
    assert plan["query"]["column"] == "sales"
    assert plan["query"]["forecast_horizon"] == 6
    assert plan["query"]["season_length"] == 12


@pytest.mark.parametrize(
    ("question", "algorithm", "analysis_kind", "chart_type"),
    [
        ("Cột nào có tỷ lệ missing cao nhất?", "missing_bar", "missing_bar", "missing_bar"),
        ("Cho tôi missing value heatmap", "missing_heatmap", "missing_heatmap", "missing_heatmap"),
        ("Vẽ correlation heatmap các biến số", "correlation_heatmap", "correlation_heatmap", "correlation_heatmap"),
        ("Cardinality các cột như thế nào?", "cardinality", "cardinality", "cardinality"),
        ("Vẽ violin phân phối sales theo region", "violin", "violin", "violin"),
        ("Cho biết tỷ trọng doanh số theo region bằng donut", "donut", "donut", "donut"),
        ("Vẽ outlier chart theo cột", "outlier", "outlier", "outlier"),
    ],
)
def test_agent_selects_core_profiling_chart_from_user_question(
    question: str, algorithm: str, analysis_kind: str, chart_type: str
) -> None:
    plan = build_chart_plan(question, CONTEXT, STATS)

    assert plan["algorithm"] == algorithm
    assert plan["query"]["analysis_kind"] == analysis_kind
    assert plan["chart_type"] == chart_type


def test_auto_profile_pack_is_domain_neutral_and_requires_no_question() -> None:
    pack = build_auto_profile_pack(CONTEXT, {**STATS, "order_date": {**STATS["order_date"], "cardinality": 24}})

    objectives = {item["objective"] for item in pack}
    assert {"missingness", "cardinality", "distribution", "box_plot", "outlier"} <= objectives
    assert "relationship" in objectives
    assert "correlation" in objectives
    assert "trend" in objectives
    assert "forecast" in objectives
    assert len(pack) <= 12
    assert all(item["auto_generated"] is True for item in pack)
    assert all(item["planning_mode"] == "auto_profile" for item in pack)
    assert all("query" in item and item["query"]["analysis_kind"] for item in pack)


def test_data_formulation_transforms_and_lineage() -> None:
    trend_plan = build_chart_plan("Doanh số theo tháng", CONTEXT, STATS)
    assert "transforms" in trend_plan
    assert len(trend_plan["transforms"]) > 0
    assert "source_columns" in trend_plan
    assert "sales" in trend_plan["source_columns"]

    hist_plan = build_chart_plan("Phân phối sales", CONTEXT, STATS)
    assert any(t["step"] == "binning" for t in hist_plan.get("transforms", []))


GLASSDOOR_CONTEXT = {
    "dimensions": [
        "Job Title", "Job Description", "Company Name", "Location",
        "Headquarters", "Size", "Type of ownership", "Industry", "Sector"
    ],
    "measures": ["Salary Estimate", "Rating", "Founded"],
    "time_column": None,
}
GLASSDOOR_STATS = {
    "Job Title": {"dtype": "string", "cardinality": 200},
    "Job Description": {"dtype": "string", "cardinality": 500},
    "Company Name": {"dtype": "string", "cardinality": 300},
    "Location": {"dtype": "string", "cardinality": 80},
    "Headquarters": {"dtype": "string", "cardinality": 70},
    "Size": {"dtype": "string", "cardinality": 8},
    "Type of ownership": {"dtype": "string", "cardinality": 5},
    "Industry": {"dtype": "string", "cardinality": 25},
    "Sector": {"dtype": "string", "cardinality": 15},
    "Salary Estimate": {"dtype": "float", "mean": 105000.0, "cardinality": 150},
    "Rating": {"dtype": "float", "mean": 3.8, "cardinality": 35},
    "Founded": {"dtype": "int", "cardinality": 85},
}


@pytest.mark.parametrize(
    ("question", "expected_problem", "expected_chart", "expected_x", "expected_y"),
    [
        (
            "So sánh số lượng tin tuyển dụng giữa các ngành công nghiệp (Industry) hàng đầu",
            "ranking",
            "bar",
            "Industry",
            None,
        ),
        (
            "Phân phối điểm đánh giá Rating của các công ty",
            "distribution",
            "histogram",
            None,
            "Rating",
        ),
        (
            "Tỷ trọng phân bổ loại hình công ty Type of ownership",
            "composition",
            "donut",
            "Type of ownership",
            None,
        ),
        (
            "Phân phối mức lương Salary Estimate",
            "distribution",
            "histogram",
            None,
            "Salary Estimate",
        ),
        (
            "Top 10 địa điểm có nhiều việc làm nhất",
            "ranking",
            "bar",
            "Location",
            None,
        ),
        (
            "Mối quan hệ giữa Rating và Salary Estimate",
            "relationship",
            "scatter",
            None,
            None,
        ),
        (
            "Cơ cấu loại hình sở hữu bằng biểu đồ donut",
            "composition",
            "donut",
            "Type of ownership",
            None,
        ),
        (
            "So sánh mức lương trung bình theo vị trí công việc",
            "compare",
            "bar",
            "Job Title",
            "Salary Estimate",
        ),
    ],
)
def test_diverse_business_questions_match_columns_and_intents(
    question: str,
    expected_problem: str,
    expected_chart: str,
    expected_x: str | None,
    expected_y: str | None,
) -> None:
    plan = build_chart_plan(question, GLASSDOOR_CONTEXT, GLASSDOOR_STATS)

    assert plan["problem"] == expected_problem
    assert plan["chart_type"] == expected_chart
    if expected_x is not None:
        assert plan["x_column"] == expected_x or (plan["query"]["dimensions"] and plan["query"]["dimensions"][0] == expected_x)
    if expected_y is not None:
        assert plan["y_column"] == expected_y or plan["query"]["column"] == expected_y or plan["query"].get("y_column") == expected_y
    if plan["problem"] == "relationship" and plan["chart_type"] == "scatter":
        assert {plan["query"]["x_column"], plan["query"]["y_column"]} == {"Rating", "Salary Estimate"}
