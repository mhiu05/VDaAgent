"""Deterministic quality gate; it reports evidence, never mutates source data."""

from __future__ import annotations

from typing import Any

from src.services.repository import Repository


def evaluate_quality_gate(
    repository: Repository, profile_run_id: str, context: dict[str, Any]
) -> tuple[str, list[dict[str, Any]]]:
    run = repository.get_profile_run(profile_run_id)
    issues: list[dict[str, Any]] = []

    def add(
        rule: str, dimension: str, severity: str, message: str, evidence: dict[str, Any]
    ) -> None:
        issues.append(
            {
                "rule": rule,
                "dimension": dimension,
                "severity": severity,
                "message": message,
                "evidence": evidence,
                "status": "open",
                "resolution_note": None,
            }
        )

    if not run or run["status"] != "completed":
        add(
            "profile_completed",
            "validity",
            "critical",
            "Profile phải hoàn tất trước khi phân tích.",
            {"status": run and run["status"]},
        )
    if repository.pending_count(profile_run_id):
        add(
            "proposal_reviewed",
            "governance",
            "critical",
            "Còn proposal chưa review; context chưa an toàn để dùng.",
            {"pending": repository.pending_count(profile_run_id)},
        )
    if not run or not run.get("row_count"):
        add(
            "non_empty_source",
            "completeness",
            "critical",
            "Source rỗng hoặc không có row count.",
            {},
        )
    if run and run.get("is_approximate"):
        add(
            "sampled_source",
            "representativeness",
            "warning",
            "Profile dùng sample; analyst cần acknowledge trước khi dùng kết quả như số liệu exact.",
            {"scan_mode": run.get("scan_mode")},
        )
    if not context.get("row_grain"):
        add(
            "row_grain",
            "consistency",
            "warning",
            "Chưa xác nhận row grain; COUNT(*) có thể không tương đương entity count.",
            {},
        )
    if context.get("time_column") and not context.get("timezone"):
        add(
            "timezone",
            "timeliness",
            "warning",
            "Có time column nhưng chưa nêu timezone.",
            {"time_column": context["time_column"]},
        )
    stats = repository.get_column_stats(profile_run_id)
    for measure in context.get("measures") or []:
        stat = stats.get(measure)
        if stat and (stat.get("null_pct") or 0) >= 20:
            add(
                "measure_missingness",
                "completeness",
                "warning",
                f"Measure '{measure}' có missingness cao.",
                {"column": measure, "null_pct": stat.get("null_pct")},
            )
    return (
        "blocked"
        if any(item["severity"] == "critical" for item in issues)
        else "warning"
        if issues
        else "passed"
    ), issues
