"""Rule-based profiling planner for the MVP.

The planner decides which metrics are useful for each column from its DuckDB
data type. Later this can become an agent node, but the MVP stays deterministic.
"""

from __future__ import annotations

from dataclasses import dataclass

from src.profiling.metrics import MetricName, is_complex_type, is_numeric_type, is_temporal_type


@dataclass(frozen=True)
class ColumnPlan:
    name: str
    data_type: str
    metrics: tuple[MetricName, ...]


@dataclass(frozen=True)
class ProfilePlan:
    table_metrics: tuple[MetricName, ...]
    columns: tuple[ColumnPlan, ...]


class ProfilingPlanner:
    def build_plan(self, schema: list[dict[str, str]]) -> ProfilePlan:
        columns = []
        for column in schema:
            column_name = column["name"]
            data_type = column["data_type"]
            if is_complex_type(data_type):
                columns.append(
                    ColumnPlan(
                        name=column_name,
                        data_type=data_type,
                        metrics=(MetricName.NULL_COUNT,),
                    )
                )
                continue

            metrics = [
                MetricName.NULL_COUNT,
                MetricName.DISTINCT_COUNT,
                MetricName.SAMPLE_VALUES,
            ]
            if is_numeric_type(data_type) or is_temporal_type(data_type):
                metrics.extend([MetricName.MIN, MetricName.MAX])
            if is_numeric_type(data_type):
                metrics.extend(
                    [
                        MetricName.AVG,
                        MetricName.STDDEV,
                        MetricName.MEDIAN,
                        MetricName.P25,
                        MetricName.P75,
                    ]
                )
                if not is_identifier_column(column_name):
                    metrics.append(MetricName.OUTLIER_COUNT)
            if not is_numeric_type(data_type):
                metrics.append(MetricName.REGEX_PATTERNS)
            metrics.append(MetricName.PII_DETECTION)
            metrics.append(MetricName.TOP_VALUES)
            columns.append(ColumnPlan(name=column_name, data_type=data_type, metrics=tuple(metrics)))

        return ProfilePlan(table_metrics=(MetricName.ROW_COUNT,), columns=tuple(columns))


def is_identifier_column(column_name: str) -> bool:
    normalized = column_name.lower().strip()
    compact = normalized.replace("_", "")
    identifier_names = {
        "id",
        "student_id",
        "customer_id",
        "order_id",
        "user_id",
        "transaction_id",
        "product_id",
    }
    return normalized in identifier_names or normalized.endswith("_id") or compact.endswith("id")
