"""Numeric profiling rules shared by file and database executors."""

from __future__ import annotations

from typing import Any

from src.profiling.metrics import is_numeric_type
from src.profiling.planner import is_identifier_column


def is_continuous_numeric(
    column_name: str,
    column_result: dict[str, Any],
    row_count: int,
) -> bool:
    if is_identifier_column(column_name) or row_count == 0:
        return False
    if not is_numeric_type(column_result.get("data_type", "")):
        return False
    distinct_count = column_result.get("distinct_count", 0)
    if distinct_count <= 2:
        return False
    return (distinct_count / row_count) > 0.05 and distinct_count > 10


def is_correlatable_numeric(
    column_name: str,
    column_result: dict[str, Any],
    row_count: int,
) -> bool:
    if is_identifier_column(column_name) or row_count == 0:
        return False
    if not is_numeric_type(column_result.get("data_type", "")):
        return False
    return column_result.get("distinct_count", 0) > 2


def should_include_top_values(column_result: dict[str, Any], row_count: int) -> bool:
    if row_count == 0:
        return False
    if not is_numeric_type(column_result.get("data_type", "")):
        return True

    distinct_count = column_result.get("distinct_count", 0)
    distinct_ratio = distinct_count / row_count
    return distinct_count <= 20 or distinct_ratio <= 0.2


def iqr_bounds(p25: float, p75: float) -> tuple[float, float]:
    iqr = p75 - p25
    return p25 - (1.5 * iqr), p75 + (1.5 * iqr)


def correlation_strength(absolute_coefficient: float) -> str:
    if absolute_coefficient >= 0.8:
        return "strong"
    if absolute_coefficient >= 0.5:
        return "moderate"
    return "weak"
