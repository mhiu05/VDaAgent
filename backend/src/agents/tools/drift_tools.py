"""Read-only persisted drift-report tools."""

from __future__ import annotations

from collections import Counter
from typing import Any

from langchain_core.tools import tool
from src.agents.tools.common import DEFAULT_LIMIT, active_run, error, ok, page
from src.services.repository import get_repository


def _reports(run_id: str) -> list[dict[str, Any]]:
    repository = get_repository()
    active = repository.get_profile_run(run_id)
    reports = []
    for report in repository.get_drift_reports(run_id):
        other_id = (
            report["profile_run_id_b"]
            if report["profile_run_id_a"] == run_id
            else report["profile_run_id_a"]
        )
        other_run = repository.get_profile_run(other_id)
        if active and other_run and other_run["dataset_id"] == active["dataset_id"]:
            reports.append(report)
    return reports


@tool
def get_drift_summary() -> dict[str, Any]:
    """Summarize persisted same-dataset drift reports touching the active run."""
    run_id, run = active_run("get_drift_summary")
    if not run:
        return error(
            "get_drift_summary", "not_found", "Active profile run was not found."
        )
    data = []
    for report in _reports(run_id):
        findings = report.get("drift_columns") or []
        counts = Counter(item.get("severity", "unknown") for item in findings)
        data.append(
            {
                "summary": report.get("summary"),
                "finding_count": len(findings),
                "severity_counts": dict(sorted(counts.items())),
            }
        )
    return ok(
        "get_drift_summary", run_id, run, {"reports": data}, artifact="drift_reports"
    )


@tool
def get_drift_findings(
    column_name: str = "",
    drift_type: str = "",
    severity: str = "",
    limit: int = DEFAULT_LIMIT,
    cursor: int = 0,
) -> dict[str, Any]:
    """List persisted same-dataset drift findings."""
    run_id, run = active_run("get_drift_findings")
    if not run:
        return error(
            "get_drift_findings", "not_found", "Active profile run was not found."
        )
    rows = [
        finding
        for report in _reports(run_id)
        for finding in (report.get("drift_columns") or [])
    ]
    rows = [
        item
        for item in rows
        if (
            not column_name
            or str(item.get("column_name", "")).casefold() == column_name.casefold()
        )
        and (not drift_type or item.get("drift_type") == drift_type)
        and (not severity or item.get("severity") == severity)
    ]
    rows.sort(
        key=lambda item: (
            item.get("column_name", "").casefold(),
            item.get("drift_type", ""),
        )
    )
    selected, pagination = page(rows, limit, cursor)
    return ok(
        "get_drift_findings",
        run_id,
        run,
        {"findings": selected},
        artifact="drift_reports",
        page=pagination,
    )


@tool
def get_schema_diff() -> dict[str, Any]:
    """Return persisted schema changes from same-dataset drift reports."""
    run_id, run = active_run("get_schema_diff")
    if not run:
        return error(
            "get_schema_diff", "not_found", "Active profile run was not found."
        )
    changes = [
        finding
        for report in _reports(run_id)
        for finding in (report.get("drift_columns") or [])
        if finding.get("drift_type")
        in {"column_added", "column_removed", "dtype_changed"}
    ]
    return ok(
        "get_schema_diff", run_id, run, {"changes": changes}, artifact="drift_reports"
    )


DRIFT_TOOLS = [get_drift_summary, get_drift_findings, get_schema_diff]

__all__ = [
    "DRIFT_TOOLS",
    "get_drift_findings",
    "get_drift_summary",
    "get_schema_diff",
]
