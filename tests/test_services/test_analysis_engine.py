from __future__ import annotations

from pathlib import Path

import pytest
from src.mcp_server import _query_from_chart_spec
from src.services.analysis_engine import AnalysisEngine
from src.services.report_draft_repository import ReportDraftRepository


class _Repository:
    def __init__(self, source: Path) -> None:
        self.source = source

    def get_profile_run(self, profile_run_id: str):
        return {
            "id": profile_run_id,
            "dataset_id": "dataset-1",
            "row_count": 5,
            "is_approximate": False,
            "correlation_matrix": {
                "sales": {"sales": 1.0, "cost": 0.99},
                "cost": {"sales": 0.99, "cost": 1.0},
            },
        }

    def get_dataset(self, dataset_id: str):
        return {"id": dataset_id, "source_ref": str(self.source)}

    def get_column_stats(self, profile_run_id: str):
        return {
            "order_date": {"dtype": "date", "null_pct": 0, "cardinality": 5},
            "sales": {"dtype": "float", "mean": 20, "null_pct": 0, "cardinality": 5, "outlier_count": 1},
            "cost": {"dtype": "float", "mean": 12, "null_pct": 0, "cardinality": 5, "outlier_count": 0},
            "region": {"dtype": "string", "null_pct": 0, "cardinality": 2},
            "channel": {"dtype": "string", "null_pct": 20, "null_count": 1, "cardinality": 2},
        }

    def confirmed_pii_columns(self, profile_run_id: str):
        return set()


def test_time_series_is_chronological_and_drops_invalid_dates(tmp_path: Path) -> None:
    source = tmp_path / "sales.csv"
    source.write_text(
        "order_date,sales,region\n"
        "2026-03-03,30,South\n"
        "invalid,999,Unknown\n"
        "2026-01-10,10,North\n"
        "2026-02-20,20,North\n",
        encoding="utf-8",
    )
    engine = AnalysisEngine(_Repository(source))  # type: ignore[arg-type]

    output = engine.execute(
        profile_run_id="run-1",
        context={"dimensions": ["order_date", "region"], "measures": ["sales"]},
        query={
            "aggregate": "sum",
            "column": "sales",
            "dimensions": ["order_date"],
            "filters": [],
            "time_grain": "month",
            "limit": 50,
            # A trend remains chronological even if a caller supplies desc.
            "sort": "desc",
        },
    )

    assert [row["value"] for row in output["result"]["data"]] == [10, 20, 30]
    assert len(output["result"]["data"]) == 3


def test_reviewed_chart_insight_is_bounded() -> None:
    assert ReportDraftRepository._validated_chart_insight(
        {"insight": "  Doanh số tăng trong quý 1.  ", "insight_reviewed": True}
    ) == {"insight": "Doanh số tăng trong quý 1.", "insight_reviewed": True}

    with pytest.raises(ValueError, match="reviewed"):
        ReportDraftRepository._validated_chart_insight(
            {"insight": "Chưa duyệt", "insight_reviewed": False}
        )

    with pytest.raises(ValueError, match="unsupported"):
        ReportDraftRepository._validated_chart_insight(
            {"insight": "Nội dung", "insight_reviewed": True, "html": "<script>"}
        )


@pytest.fixture()
def sales_engine(tmp_path: Path) -> AnalysisEngine:
    source = tmp_path / "sales.csv"
    source.write_text(
        "order_date,sales,cost,region,channel\n"
        "2026-01-01,10,4,North,Online\n"
        "2026-01-02,20,8,North,Store\n"
        "2026-01-03,30,18,South,Online\n"
        "2026-01-04,40,25,South,Store\n"
        "2026-01-05,50,31,South,Online\n",
        encoding="utf-8",
    )
    return AnalysisEngine(_Repository(source))  # type: ignore[arg-type]


def _context() -> dict[str, list[str]]:
    return {
        "dimensions": ["order_date", "region", "channel"],
        "measures": ["sales", "cost"],
    }


def test_histogram_returns_only_bounded_bin_counts(
    sales_engine: AnalysisEngine,
) -> None:
    output = sales_engine.execute(
        profile_run_id="run-1",
        context=_context(),
        query={
            "analysis_kind": "histogram",
            "aggregate": "count",
            "column": "sales",
            "dimensions": [],
            "filters": [],
            "bins": 5,
            "limit": 50,
        },
        execution_kind="official",
    )

    rows = output["result"]["data"]
    assert len(rows) <= 5
    assert sum(row["value"] for row in rows) == 5
    assert set(rows[0]) == {"bin_index", "bin_start", "bin_end", "value"}


def test_scatter_returns_density_cells_instead_of_raw_rows(
    sales_engine: AnalysisEngine,
) -> None:
    output = sales_engine.execute(
        profile_run_id="run-1",
        context=_context(),
        query={
            "analysis_kind": "scatter",
            "aggregate": "count",
            "x_column": "sales",
            "y_column": "cost",
            "dimensions": [],
            "filters": [],
            "bins": 5,
            "limit": 50,
        },
        execution_kind="official",
    )

    rows = output["result"]["data"]
    assert sum(row["value"] for row in rows) == 5
    assert set(rows[0]) == {"x", "y", "value", "x_bin", "y_bin"}


def test_box_plot_returns_five_number_summary_by_group(
    sales_engine: AnalysisEngine,
) -> None:
    output = sales_engine.execute(
        profile_run_id="run-1",
        context=_context(),
        query={
            "analysis_kind": "box",
            "aggregate": "median",
            "column": "sales",
            "dimensions": ["region"],
            "filters": [],
            "limit": 50,
        },
        execution_kind="official",
    )

    rows = output["result"]["data"]
    assert {row["group_label"] for row in rows} == {"North", "South"}
    assert all(
        {"min", "q1", "median", "q3", "max", "count"} <= set(row) for row in rows
    )


def test_heatmap_is_a_two_dimension_aggregate(sales_engine: AnalysisEngine) -> None:
    output = sales_engine.execute(
        profile_run_id="run-1",
        context=_context(),
        query={
            "analysis_kind": "heatmap",
            "aggregate": "count",
            "dimensions": ["region", "channel"],
            "filters": [],
            "limit": 50,
        },
        execution_kind="official",
    )

    rows = output["result"]["data"]
    assert sum(row["value"] for row in rows) == 5
    assert set(rows[0]) == {"region", "channel", "value"}


@pytest.mark.parametrize(
    ("analysis_kind", "expected_columns"),
    [
        ("missing_bar", {"column", "value", "count"}),
        ("cardinality", {"column", "value", "count"}),
        ("outlier", {"column", "value", "count"}),
        ("correlation_heatmap", {"x", "y", "value"}),
    ],
)
def test_profile_metric_charts_use_persisted_aggregate_evidence(
    sales_engine: AnalysisEngine,
    analysis_kind: str,
    expected_columns: set[str],
) -> None:
    selected = ["sales", "cost"] if analysis_kind in {"outlier", "correlation_heatmap"} else ["sales", "channel"]
    output = sales_engine.execute(
        profile_run_id="run-1",
        context=_context(),
        query={
            "analysis_kind": analysis_kind,
            "aggregate": "count",
            "columns": selected,
            "dimensions": [],
            "filters": [],
            "bins": 12,
            "limit": 50,
        },
        execution_kind="official",
    )

    assert output["result"]["data"]
    assert set(output["result"]["data"][0]) == expected_columns
    assert "dữ liệu dòng thô" in output["limitations"][-1]


def test_missing_heatmap_returns_only_pairwise_percentages(
    sales_engine: AnalysisEngine,
) -> None:
    output = sales_engine.execute(
        profile_run_id="run-1",
        context=_context(),
        query={
            "analysis_kind": "missing_heatmap",
            "aggregate": "count",
            "columns": ["region", "channel"],
            "dimensions": [],
            "filters": [],
            "bins": 12,
            "limit": 50,
        },
        execution_kind="official",
    )

    assert len(output["result"]["data"]) == 4
    assert set(output["result"]["data"][0]) == {"x", "y", "value"}


def test_violin_and_donut_are_bounded_aggregates(sales_engine: AnalysisEngine) -> None:
    violin = sales_engine.execute(
        profile_run_id="run-1",
        context=_context(),
        query={
            "analysis_kind": "violin",
            "aggregate": "count",
            "column": "sales",
            "dimensions": ["region"],
            "filters": [],
            "bins": 5,
            "limit": 8,
        },
    )
    donut = sales_engine.execute(
        profile_run_id="run-1",
        context=_context(),
        query={
            "analysis_kind": "donut",
            "aggregate": "sum",
            "column": "sales",
            "dimensions": ["region"],
            "filters": [],
            "bins": 12,
            "limit": 12,
        },
    )

    assert {"group_label", "bin_index", "bin_start", "bin_end", "value"} == set(violin["result"]["data"][0])
    assert sum(row["value"] for row in donut["result"]["data"]) == 150


def test_naive_forecast_uses_aggregated_time_series(sales_engine: AnalysisEngine) -> None:
    output = sales_engine.execute(
        profile_run_id="run-1",
        context=_context(),
        query={
            "analysis_kind": "forecast",
            "aggregate": "sum",
            "column": "sales",
            "dimensions": ["order_date"],
            "filters": [],
            "time_grain": "day",
            "forecast_algorithm": "naive",
            "forecast_horizon": 3,
            "season_length": 2,
            "confidence_level": 0.95,
            "history_limit": 12,
            "bins": 12,
            "limit": 50,
            "sort": "asc",
        },
        execution_kind="official",
    )

    rows = output["result"]["data"]
    assert [row["series"] for row in rows[-3:]] == ["forecast"] * 3
    assert [row["value"] for row in rows[-3:]] == [50.0, 50.0, 50.0]
    assert output["canonical_query"]["forecast_algorithm"] == "naive"


@pytest.mark.parametrize(
    ("query", "spec", "expected_x", "expected_y"),
    [
        (
            {
                "analysis_kind": "histogram",
                "aggregate": "count",
                "column": "sales",
                "dimensions": [],
                "bins": 12,
            },
            {"chart_type": "histogram", "renderer": "native-svg"},
            "sales",
            None,
        ),
        (
            {
                "analysis_kind": "scatter",
                "aggregate": "count",
                "x_column": "sales",
                "y_column": "cost",
                "dimensions": [],
                "bins": 12,
            },
            {"chart_type": "scatter", "renderer": "native-svg"},
            "sales",
            "cost",
        ),
        (
            {
                "analysis_kind": "box",
                "aggregate": "median",
                "column": "sales",
                "dimensions": ["region"],
            },
            {"chart_type": "box", "renderer": "native-svg"},
            "region",
            "sales",
        ),
        (
            {
                "analysis_kind": "heatmap",
                "aggregate": "count",
                "dimensions": ["region", "channel"],
            },
            {"chart_type": "heatmap", "renderer": "native-grid"},
            "region",
            "channel",
        ),
        (
            {
                "analysis_kind": "forecast",
                "aggregate": "sum",
                "column": "sales",
                "dimensions": ["order_date"],
                "time_grain": "month",
                "forecast_algorithm": "seasonal_naive",
                "forecast_horizon": 6,
                "season_length": 12,
            },
            {"chart_type": "line", "renderer": "native-svg"},
            "order_date",
            "sales",
        ),
    ],
)
def test_advanced_chart_spec_is_derived_from_official_query(
    query: dict[str, object],
    spec: dict[str, object],
    expected_x: str,
    expected_y: str | None,
) -> None:
    normalized = ReportDraftRepository._validated_chart_spec(
        spec, {"query_spec": query}
    )

    assert normalized["x_column"] == expected_x
    assert normalized["y_column"] == expected_y
    assert normalized["analysis_kind"] == query["analysis_kind"]


@pytest.mark.parametrize(
    ("spec", "expected"),
    [
        (
            {
                "chart_type": "histogram",
                "analysis_kind": "histogram",
                "x": "sales",
                "aggregation": "count",
                "bins": 10,
            },
            {"column": "sales", "dimensions": [], "bins": 10},
        ),
        (
            {
                "chart_type": "scatter",
                "analysis_kind": "scatter",
                "x": "sales",
                "y": "cost",
                "aggregation": "count",
                "bins": 12,
            },
            {"x_column": "sales", "y_column": "cost", "dimensions": []},
        ),
        (
            {
                "chart_type": "box",
                "analysis_kind": "box",
                "x": "region",
                "y": "sales",
                "aggregation": "median",
            },
            {"column": "sales", "dimensions": ["region"]},
        ),
        (
            {
                "chart_type": "heatmap",
                "analysis_kind": "heatmap",
                "x": "region",
                "y": "channel",
                "aggregation": "count",
            },
            {"column": None, "dimensions": ["region", "channel"]},
        ),
        (
            {
                "chart_type": "line",
                "analysis_kind": "forecast",
                "x": "order_date",
                "y": "sales",
                "aggregation": "sum",
                "time_grain": "month",
                "forecast_algorithm": "seasonal_naive",
                "forecast_horizon": 6,
                "season_length": 12,
            },
            {
                "analysis_kind": "forecast",
                "column": "sales",
                "dimensions": ["order_date"],
                "forecast_algorithm": "seasonal_naive",
                "forecast_horizon": 6,
            },
        ),
    ],
)
def test_mcp_chart_spec_maps_to_bounded_query(
    spec: dict[str, object], expected: dict[str, object]
) -> None:
    query = _query_from_chart_spec(spec, limit=50)

    for key, value in expected.items():
        assert query[key] == value
