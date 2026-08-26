"""Core profile discovery tools exposed to the QA agent."""

from __future__ import annotations

from typing import Any

from langchain_core.tools import tool
# pyrefly: ignore [missing-import]
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
# pyrefly: ignore [missing-import]
from src.agents.tools.context import pii_columns
# pyrefly: ignore [missing-import]
from src.services.repository import get_repository


@tool
def get_profile_overview() -> dict[str, Any]:
    """Return a safe overview of the active profiled dataset."""
    run_id, run = active_run("get_profile_overview")
    if not run:
        return error(
            "get_profile_overview", "not_found", "Active profile run was not found."
        )
    dataset = get_repository().get_dataset(run["dataset_id"]) or {}
    stats = column_stats(run_id)
    warnings = run.get("risk_warnings") or []
    proposals = get_repository().get_proposals(run_id)
    return ok(
        "get_profile_overview",
        run_id,
        run,
        {
            "dataset_name": dataset.get("name"),
            "version": run.get("version"),
            "status": run.get("status"),
            "row_count": run.get("row_count"),
            "column_count": len(stats),
            "scan_mode": run.get("scan_mode"),
            "sampling_strategy": run.get("sampling_strategy"),
            "sample_size": run.get("sample_size"),
            "profiled_at": run.get("created_at"),
            "warning_count": len(warnings),
            "governance_count": sum(len(items) for items in proposals.values()),
        },
        artifact="profile_runs",
    )


@tool
def list_columns(
    query: str = "",
    dtype: str = "",
    has_nulls: bool | None = None,
    has_outliers: bool | None = None,
    is_pii: bool | None = None,
    sort_by: str = "column_name",
    limit: int = DEFAULT_LIMIT,
    cursor: int = 0,
) -> dict[str, Any]:
    """List columns with bounded filters. Column matching is case-insensitive."""
    run_id, run = active_run("list_columns")
    if not run:
        return error("list_columns", "not_found", "Active profile run was not found.")
    pii = pii_columns(run_id)
    rows = []
    for name, stats in column_stats(run_id).items():
        row = {
            "column_name": name,
            "dtype": stats.get("dtype"),
            "null_pct": stats.get("null_pct"),
            "cardinality": stats.get("cardinality"),
            "is_pii": name in pii,
            "has_outliers": bool(stats.get("outlier_count")),
            "is_approximate": bool(stats.get("is_approximate")),
        }
        if query and query.casefold() not in name.casefold():
            continue
        if dtype and str(row["dtype"]).casefold() != dtype.casefold():
            continue
        if has_nulls is not None and (bool((row["null_pct"] or 0) > 0) != has_nulls):
            continue
        if has_outliers is not None and row["has_outliers"] != has_outliers:
            continue
        if is_pii is not None and row["is_pii"] != is_pii:
            continue
        rows.append(row)
    if sort_by not in {"column_name", "null_pct", "cardinality"}:
        return error(
            "list_columns",
            "invalid_argument",
            "sort_by must be column_name, null_pct, or cardinality.",
        )
    rows.sort(
        key=lambda item: (
            item.get(sort_by) is None,
            item.get(sort_by)
            if sort_by != "column_name"
            else item["column_name"].casefold(),
        )
    )
    selected, pagination = page(rows, limit, cursor)
    return ok(
        "list_columns",
        run_id,
        run,
        {"columns": selected, "column_count": len(rows)},
        artifact="column_stats",
        page=pagination,
    )


@tool
def find_columns(
    query: str = "",
    dtype: str = "",
    quality: str = "",
    governance: str = "",
    limit: int = DEFAULT_LIMIT,
    cursor: int = 0,
) -> dict[str, Any]:
    """Find columns by partial name, type, quality, or governance signal."""
    if not query and not dtype and not quality and not governance:
        return error(
            "find_columns",
            "invalid_argument",
            "Provide at least one search or filter value.",
        )
    result = list_columns.invoke(
        {"query": query, "dtype": dtype, "limit": MAX_LIMIT, "cursor": 0}
    )
    if result.get("error_code"):
        return result
    rows = result["data"]["columns"]
    pii = pii_columns(result["profile_run_id"])
    quality = quality.casefold()
    governance = governance.casefold()
    rows = [
        row
        for row in rows
        if (
            not quality
            or (quality == "nulls" and (row.get("null_pct") or 0) > 0)
            or (quality == "outliers" and row.get("has_outliers"))
        )
        and (not governance or (governance == "pii" and row["column_name"] in pii))
    ]
    selected, pagination = page(rows, limit, cursor)
    run_id, run = active_run("find_columns")
    if not run:
        return error("find_columns", "not_found", "Active profile run was not found.")
    return ok(
        "find_columns",
        run_id,
        run,
        {"columns": selected},
        artifact="column_stats",
        page=pagination,
    )


@tool
def get_column_profile(
    column_name: str, fields: list[str] | None = None
) -> dict[str, Any]:
    """Get an aggregate profile for one column; never returns PII values."""
    run_id, run = active_run("get_column_profile")
    if not run:
        return error(
            "get_column_profile", "not_found", "Active profile run was not found."
        )
    stats_map = column_stats(run_id)
    resolved = resolve_column(stats_map, column_name)
    if not resolved:
        suggestions = get_column_suggestions(stats_map, column_name)
        guidance = (
            f"Column '{column_name}' was not found. Close matches: {suggestions}. "
            "Please invoke get_column_profile with one of these names or check list_columns."
            if suggestions
            else f"Column '{column_name}' was not found in dataset. Use list_columns to see available columns."
        )
        return error(
            "get_column_profile",
            "not_found",
            f"Column '{column_name}' was not found.",
            suggestions=suggestions,
            self_correction_guidance=guidance,
        )
    name, stats = resolved
    allowed = {
        "dtype",
        "null_pct",
        "null_count",
        "cardinality",
        "uniqueness_ratio",
        "min_value",
        "max_value",
        "mean",
        "median",
        "std",
        "q1",
        "q3",
        "min_length",
        "max_length",
        "outlier_count",
        "outlier_method",
        "margin_of_error",
        "is_approximate",
    }
    selected_fields = set(fields or allowed)
    unknown = selected_fields - allowed
    if unknown:
        return error(
            "get_column_profile",
            "invalid_argument",
            "Unknown profile fields: " + ", ".join(sorted(unknown)),
        )
    data = {key: stats.get(key) for key in sorted(selected_fields)}
    data.update({"column_name": name, "is_pii": name in pii_columns(run_id)})
    return ok("get_column_profile", run_id, run, data, artifact="column_stats")


@tool
def get_stat(column_name: str, stat_name: str = "all") -> dict[str, Any]:
    """Deprecated compatibility alias for get_column_profile."""
    result = get_column_profile.invoke(
        {
            "column_name": column_name,
            "fields": None if stat_name == "all" else [stat_name],
        }
    )
    result["tool"] = "get_stat"
    result["limitations"] = list(result.get("limitations") or []) + [
        "Deprecated: use get_column_profile."
    ]
    return result


@tool
def get_run_metadata() -> dict[str, Any]:
    """Compatibility alias returning the safe profile overview."""
    result = get_profile_overview.invoke({})
    result["tool"] = "get_run_metadata"
    return result


@tool
def list_profile_versions(
    limit: int = DEFAULT_LIMIT, cursor: int = 0
) -> dict[str, Any]:
    """List only profile versions belonging to the active run's dataset."""
    run_id, run = active_run("list_profile_versions")
    if not run:
        return error(
            "list_profile_versions", "not_found", "Active profile run was not found."
        )
    rows = [
        {
            "version": item.get("version"),
            "status": item.get("status"),
            "created_at": item.get("created_at"),
            "scan_mode": item.get("scan_mode"),
            "is_approximate": item.get("is_approximate"),
        }
        for item in get_repository().list_profile_runs(
            run["dataset_id"], limit=MAX_LIMIT
        )
    ]
    rows.sort(key=lambda item: -(item["version"] or 0))
    selected, pagination = page(rows, limit, cursor)
    return ok(
        "list_profile_versions",
        run_id,
        run,
        {"versions": selected},
        artifact="profile_runs",
        page=pagination,
    )


CORE_PROFILE_TOOLS = [
    get_profile_overview,
    list_columns,
    find_columns,
    get_column_profile,
    list_profile_versions,
    # V1 compatibility aliases; prompts should prefer their V2 equivalents.
    get_stat,
    get_run_metadata,
]

__all__ = [
    "CORE_PROFILE_TOOLS",
    "find_columns",
    "get_column_profile",
    "get_profile_overview",
    "get_run_metadata",
    "get_stat",
    "list_columns",
    "list_profile_versions",
]
