from __future__ import annotations

import pytest
from src.services.chart_planner import (
    ChartPlanCandidate,
    build_auto_profile_pack,
    build_chart_plan,
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


def test_restricted_context_columns_are_removed_before_planning() -> None:
    context = {
        **CONTEXT,
        "dimensions": ["order_date", "email", "region"],
        "ignored_columns": ["email"],
    }
    stats = {**STATS, "email": {"dtype": "string", "pii_masked": True}}

    plan = build_chart_plan("Vẽ doanh số theo email", context, stats)

    assert "email" not in plan["source_columns"]
    assert "email" not in str(plan["query"])
    assert set(plan["query"]["dimensions"]) <= {"order_date", "region"}
    assert plan["query"]["analysis_kind"] == "aggregate"
    assert plan["query"]["aggregate"] == "sum"
    assert plan["query"]["time_grain"] == "month"


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


def test_future_product_ranking_uses_quantity_forecast_per_product() -> None:
    context = {
        "dimensions": [
            "Date", "Branch", "Region", "Sales_Channel", "Product_Category", "Product",
        ],
        "measures": ["Quantity", "Unit_Price_VND"],
        "time_column": "Date",
    }
    stats = {
        "Date": {
            "dtype": "datetime64[us]",
            "cardinality": 31,
            "top_k_values": [
                {"label": "min", "value": "2026-01-01T00:00:00"},
                {"label": "max", "value": "2026-01-31T00:00:00"},
            ],
        },
        "Product": {"dtype": "string", "cardinality": 16},
        "Product_Category": {"dtype": "string", "cardinality": 4},
        "Quantity": {"dtype": "int64", "mean": 10},
        "Unit_Price_VND": {"dtype": "int64", "mean": 100},
    }

    plan = build_chart_plan(
        "top 5 s\u1ea3n ph\u1ea9m c\u00f3 xu h\u01b0\u1edbng \u0111\u01b0\u1ee3c mua nhi\u1ec1u trong t\u01b0\u01a1ng lai",
        context,
        stats,
    )

    assert plan["problem"] == "forecast"
    assert plan["algorithm"] == "drift"
    assert plan["x_column"] == "Product"
    assert plan["y_column"] == "Quantity"
    assert plan["second_dimension"] == "Date"
    assert plan["time_grain"] == "day"
    assert plan["chart_type"] == "bar"
    assert plan["query"]["analysis_kind"] == "forecast_ranking"
    assert plan["query"]["dimensions"] == ["Product", "Date"]
    assert plan["query"]["limit"] == 5


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

