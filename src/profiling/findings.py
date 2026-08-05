"""Human-readable profiling findings.

This module turns normalized metrics into simple analyst-friendly observations
without requiring an LLM. The agent layer can summarize these findings later.
"""

from __future__ import annotations

from src.models.schemas import ColumnProfile, CorrelationProfile, ProfileFinding


def build_findings(
    columns: list[ColumnProfile],
    row_count: int,
    correlations: list[CorrelationProfile] | None = None,
) -> list[ProfileFinding]:
    findings: list[ProfileFinding] = []
    if row_count == 0:
        return [
            ProfileFinding(
                severity="critical",
                column=None,
                message="Dataset has no rows, so profiling cannot produce meaningful metrics.",
            )
        ]

    for column in columns:
        if column.null_count == row_count:
            findings.append(
                ProfileFinding(
                    severity="critical",
                    column=column.name,
                    message=f"Column '{column.name}' is completely null.",
                )
            )
        elif column.null_ratio >= 0.1:
            findings.append(
                ProfileFinding(
                    severity="warning",
                    column=column.name,
                    message=f"Column '{column.name}' has {column.null_ratio:.1%} missing values.",
                )
            )

        if column.distinct_count == row_count and row_count > 1:
            findings.append(
                ProfileFinding(
                    severity="info",
                    column=column.name,
                    message=(
                        f"Column '{column.name}' is unique and is an identifier candidate; "
                        "HITL confirmation is required before treating it as a key."
                    ),
                )
            )
        elif column.name.lower().endswith("_id") and column.distinct_count < row_count:
            findings.append(
                ProfileFinding(
                    severity="warning",
                    column=column.name,
                    message=(
                        f"Identifier-like column '{column.name}' has duplicate values; "
                        "confirm whether this is expected."
                    ),
                )
            )
        elif column.distinct_ratio <= 0.05 and column.distinct_count > 0:
            findings.append(
                ProfileFinding(
                    severity="info",
                    column=column.name,
                    message=f"Column '{column.name}' has low cardinality.",
                )
            )

        if column.outlier and column.outlier.outlier_ratio >= 0.05:
            findings.append(
                ProfileFinding(
                    severity="warning",
                    column=column.name,
                    message=(
                        f"Column '{column.name}' has {column.outlier.outlier_ratio:.1%} "
                        "IQR outliers."
                    ),
                )
            )

        for detection in column.pii_detection:
            findings.append(
                ProfileFinding(
                    severity="warning",
                    column=column.name,
                    message=(
                        f"Column '{column.name}' may contain {detection.pii_type} "
                        f"({detection.confidence:.0%} confidence)."
                    ),
                )
            )

        for pattern in column.regex_patterns:
            if pattern.name in {"email", "phone", "url", "uuid"}:
                findings.append(
                    ProfileFinding(
                        severity="info",
                        column=column.name,
                        message=(
                            f"Column '{column.name}' values mostly match "
                            f"the {pattern.name} pattern."
                        ),
                    )
                )

    for correlation in correlations or []:
        if correlation.strength in {"moderate", "strong"}:
            findings.append(
                ProfileFinding(
                    severity="warning" if correlation.strength == "strong" else "info",
                    column=None,
                    message=(
                        f"{correlation.strength.title()} correlation between '{correlation.left_column}' and "
                        f"'{correlation.right_column}' ({correlation.coefficient:.2f})."
                    ),
                )
            )

    return findings
