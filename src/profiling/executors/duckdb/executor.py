"""DuckDB executor for uploaded file profiling.

This module only handles DuckDB table creation and metric query execution.
Shared detection and numeric rules live under `executors/common`.
"""

from __future__ import annotations

from itertools import combinations
from pathlib import Path
from typing import Any

from src.profiling.executors.common.detectors import detect_pii, detect_regex_patterns
from src.profiling.executors.common.numeric_rules import (
    correlation_strength,
    iqr_bounds,
    is_correlatable_numeric,
    is_continuous_numeric,
    should_include_top_values,
)
from src.profiling.metrics import MetricName
from src.profiling.planner import ProfilePlan
from src.profiling.query_builders.duckdb import DuckDBQueryBuilder


class DuckDBProfileExecutor:
    def __init__(self) -> None:
        try:
            import duckdb
        except ImportError as exc:
            raise RuntimeError(
                "DuckDB is required for file profiling. Install dependencies with `pip install -e .`."
            ) from exc
        self.duckdb = duckdb
        self.query_builder = DuckDBQueryBuilder()

    def get_schema(self, file_path: Path) -> list[dict[str, str]]:
        with self.duckdb.connect(database=":memory:") as connection:
            connection.execute(self._create_table_sql(file_path))
            rows = connection.execute("DESCRIBE profile_data").fetchall()
        return [{"name": row[0], "data_type": row[1]} for row in rows]

    def inspect_file(self, file_path: Path) -> dict[str, Any]:
        with self.duckdb.connect(database=":memory:") as connection:
            connection.execute(self._create_table_sql(file_path))
            schema_rows = connection.execute("DESCRIBE profile_data").fetchall()
            row_count = connection.execute(
                self.query_builder.row_count_query("profile_data")
            ).fetchone()[0]
        return {
            "row_count": row_count,
            "schema": [{"name": row[0], "data_type": row[1]} for row in schema_rows],
        }

    def preview_file(self, file_path: Path, limit: int = 50) -> list[dict[str, Any]]:
        safe_limit = max(1, min(limit, 100))
        with self.duckdb.connect(database=":memory:") as connection:
            connection.execute(self._create_table_sql(file_path))
            relation = connection.execute(f"SELECT * FROM profile_data LIMIT {safe_limit}")
            columns = [description[0] for description in relation.description]
            rows = relation.fetchall()
        return [dict(zip(columns, row)) for row in rows]

    def profile_file(self, file_path: Path, source_name: str, plan: ProfilePlan) -> dict[str, Any]:
        with self.duckdb.connect(database=":memory:") as connection:
            connection.execute(self._create_table_sql(file_path))
            row_count = connection.execute(
                self.query_builder.row_count_query("profile_data")
            ).fetchone()[0]
            columns = [
                self._profile_column(connection, column_plan, row_count)
                for column_plan in plan.columns
            ]
            correlations = self._profile_correlations(connection, plan, columns, row_count)

        return {
            "source_name": source_name,
            "source_type": "file",
            "engine": "duckdb",
            "row_count": row_count,
            "columns": columns,
            "correlations": correlations,
        }

    def _profile_column(self, connection: Any, column_plan: Any, row_count: int) -> dict[str, Any]:
        result: dict[str, Any] = {
            "name": column_plan.name,
            "data_type": column_plan.data_type,
            "null_count": 0,
            "distinct_count": 0,
            "sample_values": [],
            "top_values": [],
        }

        if MetricName.NULL_COUNT in column_plan.metrics:
            result["null_count"] = connection.execute(
                self.query_builder.null_count_query("profile_data", column_plan.name)
            ).fetchone()[0] or 0

        if MetricName.DISTINCT_COUNT in column_plan.metrics:
            result["distinct_count"] = connection.execute(
                self.query_builder.distinct_count_query("profile_data", column_plan.name)
            ).fetchone()[0] or 0

        if row_count > 0 and MetricName.MIN in column_plan.metrics:
            result["min"], result["max"] = connection.execute(
                self.query_builder.min_max_query("profile_data", column_plan.name)
            ).fetchone()

        if row_count > 0 and MetricName.AVG in column_plan.metrics:
            result["avg"], result["stddev"] = connection.execute(
                self.query_builder.numeric_stats_query("profile_data", column_plan.name)
            ).fetchone()

        if row_count > 0 and MetricName.MEDIAN in column_plan.metrics:
            result["p25"], result["median"], result["p75"] = connection.execute(
                self.query_builder.quantile_query("profile_data", column_plan.name)
            ).fetchone()
            self._add_outlier_metric(connection, column_plan, result, row_count)

        self._add_pattern_metrics(connection, column_plan, result)
        self._add_value_samples(connection, column_plan, result, row_count)
        return result

    def _add_outlier_metric(
        self,
        connection: Any,
        column_plan: Any,
        result: dict[str, Any],
        row_count: int,
    ) -> None:
        if (
            MetricName.OUTLIER_COUNT not in column_plan.metrics
            or result.get("p25") is None
            or not is_continuous_numeric(column_plan.name, result, row_count)
        ):
            return
        lower_bound, upper_bound = iqr_bounds(float(result["p25"]), float(result["p75"]))
        outlier_count = connection.execute(
            self.query_builder.outlier_count_query(
                "profile_data",
                column_plan.name,
                lower_bound,
                upper_bound,
            )
        ).fetchone()[0]
        result["outlier"] = {
            "method": "iqr",
            "lower_bound": lower_bound,
            "upper_bound": upper_bound,
            "outlier_count": outlier_count,
            "outlier_ratio": outlier_count / row_count if row_count else 0,
        }

    def _add_pattern_metrics(self, connection: Any, column_plan: Any, result: dict[str, Any]) -> None:
        if (
            MetricName.REGEX_PATTERNS not in column_plan.metrics
            and MetricName.PII_DETECTION not in column_plan.metrics
        ):
            return
        rows = connection.execute(
            self.query_builder.column_values_query("profile_data", column_plan.name, 100)
        ).fetchall()
        sampled_values = [row[0] for row in rows]
        if MetricName.REGEX_PATTERNS in column_plan.metrics:
            result["regex_patterns"] = detect_regex_patterns(sampled_values)
        result["pii_detection"] = detect_pii(column_plan.name, sampled_values)

    def _add_value_samples(
        self,
        connection: Any,
        column_plan: Any,
        result: dict[str, Any],
        row_count: int,
    ) -> None:
        if MetricName.SAMPLE_VALUES in column_plan.metrics:
            rows = connection.execute(
                self.query_builder.sample_values_query("profile_data", column_plan.name, 5)
            ).fetchall()
            result["sample_values"] = [row[0] for row in rows]

        if MetricName.TOP_VALUES in column_plan.metrics and should_include_top_values(result, row_count):
            rows = connection.execute(
                self.query_builder.top_values_query("profile_data", column_plan.name, 5)
            ).fetchall()
            result["top_values"] = [{"value": row[0], "count": row[1]} for row in rows]

    def _profile_correlations(
        self,
        connection: Any,
        plan: ProfilePlan,
        columns: list[dict[str, Any]],
        row_count: int,
    ) -> list[dict[str, Any]]:
        column_stats = {column["name"]: column for column in columns}
        numeric_columns = [
            column.name
            for column in plan.columns
            if MetricName.AVG in column.metrics
            and MetricName.STDDEV in column.metrics
            and is_correlatable_numeric(column.name, column_stats[column.name], row_count)
        ]
        correlations = []
        for left_column, right_column in combinations(numeric_columns, 2):
            coefficient = connection.execute(
                self.query_builder.correlation_query("profile_data", left_column, right_column)
            ).fetchone()[0]
            if coefficient is None:
                continue
            correlations.append(
                {
                    "left_column": left_column,
                    "right_column": right_column,
                    "coefficient": float(coefficient),
                    "strength": correlation_strength(abs(float(coefficient))),
                }
            )
        correlations.sort(key=lambda item: abs(item["coefficient"]), reverse=True)
        return correlations[:20]

    def _create_table_sql(self, file_path: Path) -> str:
        normalized_path = str(file_path.resolve()).replace("\\", "/").replace("'", "''")
        return (
            "CREATE TEMP TABLE profile_data AS "
            f"SELECT * FROM read_csv_auto('{normalized_path}', header=true, sample_size=-1)"
        )
