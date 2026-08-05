"""Metric contracts used by profiling executors.

This module defines the small set of table and column metrics the MVP computes.
Keeping metric names centralized makes query builders, executors, and response
normalization agree on the same output shape.
"""

from __future__ import annotations

from enum import StrEnum


class MetricName(StrEnum):
    ROW_COUNT = "row_count"
    NULL_COUNT = "null_count"
    DISTINCT_COUNT = "distinct_count"
    MIN = "min"
    MAX = "max"
    AVG = "avg"
    STDDEV = "stddev"
    MEDIAN = "median"
    P25 = "p25"
    P75 = "p75"
    OUTLIER_COUNT = "outlier_count"
    REGEX_PATTERNS = "regex_patterns"
    PII_DETECTION = "pii_detection"
    TOP_VALUES = "top_values"
    SAMPLE_VALUES = "sample_values"


NUMERIC_TYPES = {
    "INT",
    "TINYINT",
    "SMALLINT",
    "INTEGER",
    "BIGINT",
    "HUGEINT",
    "UTINYINT",
    "USMALLINT",
    "UINTEGER",
    "UBIGINT",
    "FLOAT",
    "DOUBLE",
    "DECIMAL",
    "NUMERIC",
    "REAL",
    "MONEY",
    "SMALLMONEY",
}

DATE_TYPES = {
    "DATE",
    "TIME",
    "TIMESTAMP",
    "TIMESTAMP WITH TIME ZONE",
    "DATETIME",
    "DATETIME2",
    "SMALLDATETIME",
}

COMPLEX_TYPES = {
    "GEOGRAPHY",
    "GEOMETRY",
    "HIERARCHYID",
    "XML",
    "IMAGE",
    "BINARY",
    "VARBINARY",
}


def is_numeric_type(data_type: str) -> bool:
    normalized = data_type.upper()
    return any(normalized.startswith(type_name) for type_name in NUMERIC_TYPES)


def is_temporal_type(data_type: str) -> bool:
    normalized = data_type.upper()
    return any(normalized.startswith(type_name) for type_name in DATE_TYPES)


def is_complex_type(data_type: str) -> bool:
    normalized = data_type.upper()
    return any(normalized.startswith(type_name) for type_name in COMPLEX_TYPES)
