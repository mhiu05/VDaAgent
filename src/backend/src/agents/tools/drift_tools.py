"""Read-only persisted drift-report tools."""

from __future__ import annotations

from collections import Counter
from math import isfinite
from typing import Any

from langchain_core.tools import tool
from src.agents.tools.common import DEFAULT_LIMIT, active_run, error, ok, page
from src.services.repository import get_repository


def _reports(
    run_id: str, active: dict[str, Any] | None = None
) -> list[dict[str, Any]]:
    repository = get_repository()
    active = active or repository.get_profile_run(run_id)
    if not active or not active.get("workspace_id"):
        return []
    # Scope both sides in the report query. Drift comparisons may legitimately
    # span separate immutable dataset snapshots, so dataset_id is not a tenant
    # boundary and must not be used to discard the report.
    return repository.get_drift_reports(
        run_id, workspace_id=str(active["workspace_id"])
    )


def _supplemental_profile_findings(
    repository: Any, reports: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Derive omitted comparison facts from persisted aggregate statistics.

    Drift reports historically persisted mean/std shifts but not median shifts
    or the top category on either side. The immutable profile runs already
    contain those exact per-column aggregates, so expose that persisted
    evidence without reading or recomputing raw data.
    Duplicate idempotent reports are collapsed before loading their statistics.
    """

    pairs = sorted(
        {
            (str(report["profile_run_id_a"]), str(report["profile_run_id_b"]))
            for report in reports
            if report.get("profile_run_id_a") and report.get("profile_run_id_b")
        }
    )
    findings: list[dict[str, Any]] = []
    for baseline_run_id, current_run_id in pairs:
        baseline_stats = repository.get_column_stats(baseline_run_id)
        current_stats = repository.get_column_stats(current_run_id)
        for column_name in sorted(set(baseline_stats) & set(current_stats)):
            baseline_top = (baseline_stats.get(column_name) or {}).get(
                "top_k_values"
            )
            current_top = (current_stats.get(column_name) or {}).get("top_k_values")
            before_top = (
                baseline_top[0].get("value")
                if isinstance(baseline_top, list)
                and baseline_top
                and isinstance(baseline_top[0], dict)
                else None
            )
            after_top = (
                current_top[0].get("value")
                if isinstance(current_top, list)
                and current_top
                and isinstance(current_top[0], dict)
                else None
            )
            if before_top is not None and after_top is not None:
                findings.append(
                    {
                        "column_name": column_name,
                        "drift_type": "distribution_snapshot",
                        "severity": "informational",
                        "metric": "top_category",
                        "baseline_value": before_top,
                        "current_value": after_top,
                        "before": before_top,
                        "after": after_top,
                        "detail": (
                            f"top category was {before_top} in the baseline and "
                            f"{after_top} in the current run."
                        ),
                    }
                )
            before = (baseline_stats.get(column_name) or {}).get("median")
            after = (current_stats.get(column_name) or {}).get("median")
            if (
                not isinstance(before, (int, float))
                or isinstance(before, bool)
                or not isinstance(after, (int, float))
                or isinstance(after, bool)
                or not isfinite(float(before))
                or not isfinite(float(after))
                or float(before) == float(after)
            ):
                continue
            scale = max(abs(float(before)), abs(float(after)), 1.0)
            relative_change = abs(float(after) - float(before)) / scale
            findings.append(
                {
                    "column_name": column_name,
                    "drift_type": "numeric_shift",
                    "severity": "major" if relative_change >= 0.2 else "minor",
                    "metric": "median",
                    "baseline_value": before,
                    "current_value": after,
                    "before": before,
                    "after": after,
                    "detail": f"median changed from {before} to {after}.",
                }
            )
    return findings


@tool
def get_drift_summary() -> dict[str, Any]:
    """Summarize persisted same-dataset drift reports touching the active run."""
    run_id, run = active_run("get_drift_summary")
    if not run:
        return error(
            "get_drift_summary", "not_found", "Active profile run was not found."
        )
    data = []
    for report in _reports(run_id, run):
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
    reports = _reports(run_id, run)
    rows = [
        finding
        for report in reports
        for finding in (report.get("drift_columns") or [])
    ]
    repository = get_repository()
    rows.extend(_supplemental_profile_findings(repository, reports))
    report_run_ids = [
        str(report[key])
        for report in reports
        for key in ("profile_run_id_a", "profile_run_id_b")
        if report.get(key)
    ]
    row_counts = repository.get_profile_run_row_counts(
        report_run_ids, workspace_id=str(run.get("workspace_id"))
    )
    for report in reports:
        before = row_counts.get(str(report["profile_run_id_a"]))
        after = row_counts.get(str(report["profile_run_id_b"]))
        if all(isinstance(value, int) and not isinstance(value, bool) for value in (before, after)):
            rows.append(
                {
                    "column_name": "__dataset__",
                    "drift_type": "row_count_shift",
                    "severity": "minor" if before == after else "major",
                    "metric": "row_count",
                    "baseline_value": before,
                    "current_value": after,
                    "before": before,
                    "after": after,
                    "detail": f"row_count đổi từ {before} sang {after}.",
                }
            )
    # A resumed idempotent comparison can encounter an older duplicate report.
    # Deduplicate public findings so pagination and agent answers stay stable.
    unique_rows: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()
    for item in rows:
        key = (
            item.get("column_name"), item.get("drift_type"), item.get("metric"),
            item.get("before"), item.get("after"), item.get("psi"),
        )
        if key not in seen:
            seen.add(key)
            unique_rows.append(item)
    rows = unique_rows
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
        for report in _reports(run_id, run)
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
