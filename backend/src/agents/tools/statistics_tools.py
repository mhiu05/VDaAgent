"""Bounded aggregate statistics tools exposed to the QA agent."""

from __future__ import annotations

from typing import Any

from langchain_core.tools import tool
from src.agents.tools.common import (
    DEFAULT_LIMIT,
    MAX_LIMIT,
    active_run,
    column_stats,
    error,
    get_column_suggestions,
    ok,
    page,
    resolve_column,
)
from src.agents.tools.context import pii_columns
from src.agents.tools.core_profile_tools import get_column_profile


@tool
def get_correlation(column_a: str, column_b: str) -> dict[str, Any]:
    """Get Pearson correlation for exactly one numeric column pair."""
    run_id, run = active_run("get_correlation")
    if not run:
        return error(
            "get_correlation", "not_found", "Active profile run was not found."
        )
    matrix = run.get("correlation_matrix") or {}
    stats_map = column_stats(run_id)
    a = resolve_column(stats_map, column_a)
    b = resolve_column(stats_map, column_b)
    if not a or not b:
        missing = []
        suggestions = []
        if not a:
            missing.append(column_a)
            suggestions.extend(get_column_suggestions(stats_map, column_a))
        if not b:
            missing.append(column_b)
            suggestions.extend(get_column_suggestions(stats_map, column_b))
        return error(
            "get_correlation",
            "not_found",
            f"Columns not found: {', '.join(missing)}.",
            suggestions=list(dict.fromkeys(suggestions)),
            self_correction_guidance=f"Please call get_correlation with valid column names. Suggestions: {list(dict.fromkeys(suggestions))}",
        )
    if a[0] not in matrix or b[0] not in matrix.get(a[0], {}):
        return error(
            "get_correlation",
            "no_evidence",
            "No persisted correlation exists for this pair.",
        )
    return ok(
        "get_correlation",
        run_id,
        run,
        {
            "column_a": a[0],
            "column_b": b[0],
            "pearson_r": matrix[a[0]][b[0]],
            "note": "Correlation does not establish causation.",
        },
        artifact="correlation_matrix",
    )


@tool
def get_top_correlations(
    min_abs_r: float = 0.0, limit: int = DEFAULT_LIMIT
) -> dict[str, Any]:
    """Return bounded unique correlation pairs, sorted deterministically."""
    if not 0 <= min_abs_r <= 1:
        return error(
            "get_top_correlations",
            "invalid_argument",
            "min_abs_r must be between 0 and 1.",
        )
    run_id, run = active_run("get_top_correlations")
    if not run:
        return error(
            "get_top_correlations", "not_found", "Active profile run was not found."
        )
    pairs = []
    matrix = run.get("correlation_matrix") or {}
    for column_a in sorted(matrix):
        for column_b, correlation in (matrix.get(column_a) or {}).items():
            if (
                column_a < column_b
                and correlation is not None
                and abs(float(correlation)) >= min_abs_r
            ):
                pairs.append(
                    {
                        "column_a": column_a,
                        "column_b": column_b,
                        "pearson_r": correlation,
                        "abs_r": abs(float(correlation)),
                    }
                )
    pairs.sort(key=lambda item: (-item["abs_r"], item["column_a"], item["column_b"]))
    selected, pagination = page(pairs, limit, 0)
    return ok(
        "get_top_correlations",
        run_id,
        run,
        {
            "correlations": selected,
            "note": "Correlation does not establish causation.",
        },
        artifact="correlation_matrix",
        page=pagination,
    )


@tool
def get_outlier_summary(column_name: str) -> dict[str, Any]:
    """Return aggregate outlier counts and method for a column."""
    data = get_column_profile.invoke(
        {"column_name": column_name, "fields": ["outlier_count", "outlier_method"]}
    )
    if data.get("error_code"):
        return data
    data["tool"] = "get_outlier_summary"
    data["data"]["outlier_rate"] = (data["data"].get("outlier_count") or 0) / max(
        1, (active_run("get_outlier_summary")[1] or {}).get("row_count") or 1
    )
    data["limitations"].append("Outlier values and rows are intentionally not exposed.")
    return data


@tool
def get_distribution(column_name: str, limit: int = DEFAULT_LIMIT) -> dict[str, Any]:
    """Return persisted aggregate distribution only for a non-PII column."""
    run_id, run = active_run("get_distribution")
    if not run:
        return error(
            "get_distribution", "not_found", "Active profile run was not found."
        )
    stats_map = column_stats(run_id)
    resolved = resolve_column(stats_map, column_name)
    if not resolved:
        suggestions = get_column_suggestions(stats_map, column_name)
        return error(
            "get_distribution",
            "not_found",
            f"Column '{column_name}' was not found.",
            suggestions=suggestions,
            self_correction_guidance=f"Column '{column_name}' was not found. Valid suggestions: {suggestions}. Retry get_distribution with an exact match.",
        )
    name, stats = resolved
    if name in pii_columns(run_id):
        return error(
            "get_distribution",
            "forbidden_scope",
            "Distribution values are unavailable for PII or pending-PII columns.",
        )
    values = (stats.get("top_k_values") or [])[: max(1, min(limit, MAX_LIMIT))]
    if not values:
        return error(
            "get_distribution",
            "no_evidence",
            "No persisted distribution artifact exists for this column.",
        )
    return ok(
        "get_distribution",
        run_id,
        run,
        {"column_name": name, "kind": "top_categories", "values": values},
        artifact="column_stats",
        limitations=[
            "Only persisted top categories are available; raw rows are not exposed."
        ],
    )


@tool
def get_sampling_uncertainty(column_name: str = "") -> dict[str, Any]:
    """Return persisted sampling strategy and metric uncertainty."""
    run_id, run = active_run("get_sampling_uncertainty")
    if not run:
        return error(
            "get_sampling_uncertainty", "not_found", "Active profile run was not found."
        )
    data = {
        "scan_mode": run.get("scan_mode"),
        "sampling_strategy": run.get("sampling_strategy"),
        "sample_size": run.get("sample_size"),
        "random_seed": run.get("random_seed"),
    }
    if column_name:
        resolved = resolve_column(column_stats(run_id), column_name)
        if not resolved:
            return error(
                "get_sampling_uncertainty",
                "not_found",
                f"Column '{column_name}' was not found.",
            )
        data.update(
            {
                "column_name": resolved[0],
                "margin_of_error": resolved[1].get("margin_of_error"),
            }
        )
    return ok("get_sampling_uncertainty", run_id, run, data, artifact="profile_runs")


STATISTICS_TOOLS = [
    get_correlation,
    get_top_correlations,
    get_distribution,
    get_outlier_summary,
    get_sampling_uncertainty,
]

__all__ = [
    "STATISTICS_TOOLS",
    "get_correlation",
    "get_distribution",
    "get_outlier_summary",
    "get_sampling_uncertainty",
    "get_top_correlations",
]
