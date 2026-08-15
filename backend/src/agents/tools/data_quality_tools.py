"""Deterministic data-quality tools exposed to the QA agent."""

from __future__ import annotations

from typing import Any

from langchain_core.tools import tool
from src.agents.tools.common import (
    DEFAULT_LIMIT,
    active_run,
    column_stats,
    error,
    ok,
    page,
)


@tool
def list_quality_issues(
    severity: str = "",
    issue_type: str = "",
    column_name: str = "",
    limit: int = DEFAULT_LIMIT,
    cursor: int = 0,
) -> dict[str, Any]:
    """Derive deterministic quality issues from persisted aggregate metrics."""
    run_id, run = active_run("list_quality_issues")
    if not run:
        return error(
            "list_quality_issues", "not_found", "Active profile run was not found."
        )
    issues = []
    stats_by_column = column_stats(run_id)
    row_count = run.get("row_count") or 0
    for column, stats in stats_by_column.items():
        null_pct = float(stats.get("null_pct") or 0)
        uniqueness = float(stats.get("uniqueness_ratio") or 0)
        outlier_count = int(stats.get("outlier_count") or 0)
        if null_pct >= 50:
            issues.append(
                {
                    "column_name": column,
                    "issue_type": "high_missingness",
                    "severity": "high",
                    "metric_name": "null_pct",
                    "observed_value": null_pct,
                    "threshold": 50,
                    "rule_version": "v1",
                }
            )
        if (
            row_count
            and uniqueness <= 1 / max(row_count, 1)
            and stats.get("cardinality") == 1
        ):
            issues.append(
                {
                    "column_name": column,
                    "issue_type": "constant_column",
                    "severity": "medium",
                    "metric_name": "cardinality",
                    "observed_value": 1,
                    "threshold": 1,
                    "rule_version": "v1",
                }
            )
        if row_count and outlier_count / row_count >= 0.05:
            issues.append(
                {
                    "column_name": column,
                    "issue_type": "high_outlier_rate",
                    "severity": "medium",
                    "metric_name": "outlier_rate",
                    "observed_value": outlier_count / row_count,
                    "threshold": 0.05,
                    "rule_version": "v1",
                }
            )
    issues.sort(
        key=lambda item: (item["severity"], item["issue_type"], item["column_name"])
    )
    issues = [
        item
        for item in issues
        if (not severity or item["severity"] == severity)
        and (not issue_type or item["issue_type"] == issue_type)
        and (
            not column_name or item["column_name"].casefold() == column_name.casefold()
        )
    ]
    selected, pagination = page(issues, limit, cursor)
    return ok(
        "list_quality_issues",
        run_id,
        run,
        {"issues": selected},
        artifact="column_stats",
        page=pagination,
        limitations=[
            "Issues are deterministic rules over persisted aggregates (rule v1)."
        ],
    )


@tool
def get_missingness_patterns(limit: int = DEFAULT_LIMIT) -> dict[str, Any]:
    """Return per-column missingness; co-missing groups require a stored artifact."""
    run_id, run = active_run("get_missingness_patterns")
    if not run:
        return error(
            "get_missingness_patterns", "not_found", "Active profile run was not found."
        )
    rows = [
        {
            "column_name": name,
            "null_pct": stats.get("null_pct"),
            "null_count": stats.get("null_count"),
        }
        for name, stats in column_stats(run_id).items()
        if (stats.get("null_count") or 0) > 0
    ]
    rows.sort(key=lambda item: (-(item["null_pct"] or 0), item["column_name"]))
    selected, pagination = page(rows, limit, 0)
    return ok(
        "get_missingness_patterns",
        run_id,
        run,
        {"per_column": selected, "co_missing_groups": []},
        artifact="column_stats",
        page=pagination,
        limitations=["Co-missing groups were not persisted for this profile run."],
    )


@tool
def get_duplicate_analysis() -> dict[str, Any]:
    """Return duplicate analysis only when a persisted artifact is available."""
    run_id, run = active_run("get_duplicate_analysis")
    if not run:
        return error(
            "get_duplicate_analysis", "not_found", "Active profile run was not found."
        )
    if run.get("duplicate_row_count") is None:
        return error(
            "get_duplicate_analysis",
            "no_evidence",
            "Duplicate-row metrics were not persisted for this profile run.",
        )
    return ok(
        "get_duplicate_analysis",
        run_id,
        run,
        {
            "duplicate_row_count": run.get("duplicate_row_count"),
            "duplicate_row_rate": run.get("duplicate_row_rate"),
            "scan_mode": run.get("scan_mode"),
        },
        artifact="profile_runs",
        limitations=["Duplicate records are intentionally not exposed."],
    )


DATA_QUALITY_TOOLS = [
    list_quality_issues,
    get_missingness_patterns,
    get_duplicate_analysis,
]

__all__ = [
    "DATA_QUALITY_TOOLS",
    "get_duplicate_analysis",
    "get_missingness_patterns",
    "list_quality_issues",
]
