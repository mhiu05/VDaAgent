"""Deterministic quality gate; it reports evidence, never mutates source data."""

from __future__ import annotations

from typing import Any

from src.services.repository import Repository


def evaluate_quality_gate(
    repository: Repository,
    profile_run_id: str,
    context: dict[str, Any],
    *,
    workspace_id: str | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    # Keep the service workspace-aware even though callers normally resolve
    # the session first.  This prevents a future call site from accidentally
    # evaluating quality data for a Profile Run in another tenant.
    run = (
        repository.get_profile_run(profile_run_id)
        if workspace_id is None
        else repository.get_profile_run(profile_run_id, workspace_id=workspace_id)
    )
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
    # Do not inspect child rows when the Profile Run is missing from the
    # caller's workspace.  Besides avoiding a ``None.get`` failure below,
    # this keeps column stats and proposal counts from becoming an IDOR side
    # channel for cross-workspace identifiers.
    if not run:
        return "blocked", issues
    pending = repository.pending_count(profile_run_id)
    if pending:
        add(
            "proposal_reviewed",
            "governance",
            "critical",
            "Còn proposal chưa review; context chưa an toàn để dùng.",
            {"pending": pending},
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
    # OpenMetadata-style Extended Quality Assertions
    stats = repository.get_column_stats(profile_run_id)
    all_stats = stats or {}
    clean_columns = 0

    for col_name, stat in all_stats.items():
        null_pct = float(stat.get("null_pct") or 0)
        cardinality = int(stat.get("cardinality") or 0)
        outlier_count = int(stat.get("outlier_count") or 0)
        row_count = int(run.get("row_count") or 0)

        # 1. Extreme Missingness Assertion
        if null_pct >= 50.0:
            add(
                "extreme_missingness",
                "completeness",
                "warning",
                f"Cột '{col_name}' bị thiếu dữ liệu nghiêm trọng ({null_pct:.1f}% null).",
                {"column": col_name, "null_pct": null_pct},
            )

        # 2. Outlier Anomaly Assertion (> 10% row count)
        if row_count > 0 and (outlier_count / row_count) >= 0.10:
            add(
                "high_outlier_ratio",
                "validity",
                "warning",
                f"Cột '{col_name}' có tỷ lệ outlier bất thường ({outlier_count:,} dòng, {(outlier_count / row_count * 100):.1f}%).",
                {"column": col_name, "outlier_count": outlier_count, "outlier_pct": round(outlier_count / row_count * 100, 2)},
            )

        # 3. Low Cardinality on ID columns
        if "id" in col_name.lower() and row_count > 10 and cardinality <= 1:
            add(
                "constant_identifier",
                "uniqueness",
                "warning",
                f"Cột định danh '{col_name}' có cardinality = {cardinality} (gần như đơn trị).",
                {"column": col_name, "cardinality": cardinality},
            )

        if null_pct < 5.0 and (outlier_count / max(row_count, 1)) < 0.05:
            clean_columns += 1

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

    gate_status = (
        "blocked"
        if any(item["severity"] == "critical" for item in issues)
        else "warning"
        if issues
        else "passed"
    )

    return gate_status, issues
