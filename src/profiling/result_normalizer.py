"""Normalize executor output into API response schemas.

Executors may return database-native values such as Decimal, date, or timestamp
objects. This module converts them into JSON-safe Pydantic response models.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Any

from src.models.schemas import (
    ColumnProfile,
    CorrelationProfile,
    DatasetSummary,
    OutlierProfile,
    PiiDetection,
    ProfileMetadata,
    ProfileRelationships,
    ProfileResult,
    ProfileSource,
    QualitySummary,
    RegexPattern,
    TopValue,
)
from src.profiling.findings import build_findings


def json_safe(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime | date | time):
        return value.isoformat()
    return value


class ProfileResultNormalizer:
    def normalize(self, raw_result: dict[str, Any]) -> ProfileResult:
        row_count = raw_result["row_count"]
        columns = [
            ColumnProfile(
                name=column["name"],
                data_type=column["data_type"],
                null_count=column["null_count"],
                distinct_count=column["distinct_count"],
                null_ratio=column["null_count"] / row_count if row_count else 0,
                distinct_ratio=column["distinct_count"] / row_count if row_count else 0,
                min=json_safe(column.get("min")),
                max=json_safe(column.get("max")),
                avg=json_safe(column.get("avg")),
                stddev=json_safe(column.get("stddev")),
                median=json_safe(column.get("median")),
                p25=json_safe(column.get("p25")),
                p75=json_safe(column.get("p75")),
                outlier=self._normalize_outlier(column.get("outlier")),
                regex_patterns=[
                    RegexPattern(
                        name=item["name"],
                        match_count=item["match_count"],
                        sample_size=item["sample_size"],
                        confidence=item["confidence"],
                    )
                    for item in column.get("regex_patterns", [])
                ],
                pii_detection=[
                    PiiDetection(
                        pii_type=item["pii_type"],
                        confidence=item["confidence"],
                        reason=item["reason"],
                    )
                    for item in column.get("pii_detection", [])
                ],
                sample_values=[json_safe(value) for value in column.get("sample_values", [])],
                top_values=[
                    TopValue(value=json_safe(item["value"]), count=item["count"])
                    for item in column.get("top_values", [])
                ],
            )
            for column in raw_result["columns"]
        ]
        correlations = [
            CorrelationProfile(
                left_column=item["left_column"],
                right_column=item["right_column"],
                coefficient=item["coefficient"],
                strength=item["strength"],
            )
            for item in raw_result.get("correlations", [])
        ]
        findings = build_findings(columns, row_count, correlations)
        quality_summary = self._build_quality_summary(findings)
        return ProfileResult(
            profile_metadata=ProfileMetadata(
                engine=raw_result.get("engine", "duckdb"),
                profile_mode=raw_result.get("profile_mode", "full"),
                sampled=False,
                sample_size=None,
                generated_at=datetime.now(timezone(timedelta(hours=7))).isoformat(),
                profiling_version="0.1.0",
                outlier_method="iqr",
                correlation_method="pearson",
                hitl_required=True,
            ),
            source=ProfileSource(name=raw_result["source_name"], type=raw_result["source_type"]),
            dataset_summary=DatasetSummary(row_count=row_count, column_count=len(columns)),
            columns=columns,
            relationships=ProfileRelationships(correlations=correlations),
            findings=findings,
            quality_summary=quality_summary,
        )

    def _normalize_outlier(self, outlier: dict[str, Any] | None) -> OutlierProfile | None:
        if outlier is None:
            return None
        return OutlierProfile(
            method=outlier["method"],
            lower_bound=json_safe(outlier["lower_bound"]),
            upper_bound=json_safe(outlier["upper_bound"]),
            outlier_count=outlier["outlier_count"],
            outlier_ratio=outlier["outlier_ratio"],
        )

    def _build_quality_summary(self, findings: list[Any]) -> QualitySummary:
        return QualitySummary(
            critical_count=sum(1 for finding in findings if finding.severity == "critical"),
            warning_count=sum(1 for finding in findings if finding.severity == "warning"),
            info_count=sum(1 for finding in findings if finding.severity == "info"),
        )
