"""DuckDB executor for uploaded file profiling.

This executor loads a CSV file into a temporary DuckDB table, runs the planned
metrics, and returns raw metric dictionaries for the normalizer.
"""

from __future__ import annotations

import re
from itertools import combinations
from pathlib import Path
from typing import Any

from src.profiling.metrics import MetricName, is_numeric_type
from src.profiling.planner import ProfilePlan, is_identifier_column
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
            min_value, max_value = connection.execute(
                self.query_builder.min_max_query("profile_data", column_plan.name)
            ).fetchone()
            result["min"] = min_value
            result["max"] = max_value

        if row_count > 0 and MetricName.AVG in column_plan.metrics:
            avg_value, stddev_value = connection.execute(
                self.query_builder.numeric_stats_query("profile_data", column_plan.name)
            ).fetchone()
            result["avg"] = avg_value
            result["stddev"] = stddev_value

        if row_count > 0 and MetricName.MEDIAN in column_plan.metrics:
            p25_value, median_value, p75_value = connection.execute(
                self.query_builder.quantile_query("profile_data", column_plan.name)
            ).fetchone()
            result["p25"] = p25_value
            result["median"] = median_value
            result["p75"] = p75_value

            if (
                MetricName.OUTLIER_COUNT in column_plan.metrics
                and p25_value is not None
                and self._is_continuous_numeric(column_plan.name, result, row_count)
            ):
                lower_bound, upper_bound = self._iqr_bounds(float(p25_value), float(p75_value))
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

        sampled_values = []
        if MetricName.REGEX_PATTERNS in column_plan.metrics or MetricName.PII_DETECTION in column_plan.metrics:
            sampled_rows = connection.execute(
                self.query_builder.column_values_query("profile_data", column_plan.name, 100)
            ).fetchall()
            sampled_values = [row[0] for row in sampled_rows]
            if MetricName.REGEX_PATTERNS in column_plan.metrics:
                result["regex_patterns"] = self._detect_regex_patterns(sampled_values)
            result["pii_detection"] = self._detect_pii(column_plan.name, sampled_values)

        if MetricName.SAMPLE_VALUES in column_plan.metrics:
            rows = connection.execute(
                self.query_builder.sample_values_query("profile_data", column_plan.name, 5)
            ).fetchall()
            result["sample_values"] = [row[0] for row in rows]

        if MetricName.TOP_VALUES in column_plan.metrics:
            rows = connection.execute(
                self.query_builder.top_values_query("profile_data", column_plan.name, 5)
            ).fetchall()
            result["top_values"] = [{"value": row[0], "count": row[1]} for row in rows]

        return result

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
            if MetricName.AVG in column.metrics and MetricName.STDDEV in column.metrics
            and not is_identifier_column(column.name)
            and self._is_continuous_numeric(column.name, column_stats[column.name], row_count)
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
                    "coefficient": coefficient,
                    "strength": self._correlation_strength(abs(float(coefficient))),
                }
            )
        correlations.sort(key=lambda item: abs(item["coefficient"]), reverse=True)
        return correlations[:20]

    def _is_continuous_numeric(
        self,
        column_name: str,
        column_result: dict[str, Any],
        row_count: int,
    ) -> bool:
        if is_identifier_column(column_name):
            return False
        if row_count == 0:
            return False
        distinct_count = column_result.get("distinct_count", 0)
        if distinct_count <= 2:
            return False
        return (distinct_count / row_count) > 0.05 and distinct_count > 10

    def _iqr_bounds(self, p25: float, p75: float) -> tuple[float, float]:
        iqr = p75 - p25
        return p25 - (1.5 * iqr), p75 + (1.5 * iqr)

    def _correlation_strength(self, absolute_coefficient: float) -> str:
        if absolute_coefficient >= 0.8:
            return "strong"
        if absolute_coefficient >= 0.5:
            return "moderate"
        return "weak"

    def _detect_regex_patterns(self, values: list[Any]) -> list[dict[str, Any]]:
        patterns = {
            "email": re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$"),
            "phone": re.compile(r"^\+?[0-9][0-9 .()\-]{7,}$"),
            "url": re.compile(r"^https?://[^\s/$.?#].[^\s]*$"),
            "uuid": re.compile(
                r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
                r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
            ),
            "date_like": re.compile(r"^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}$"),
            "time_like": re.compile(r"^\d{1,2}:\d{2}(:\d{2})?$"),
            "numeric_string": re.compile(r"^-?\d+(\.\d+)?$"),
        }
        text_values = [str(value).strip() for value in values if value is not None and str(value).strip()]
        if not text_values:
            return []

        detected = []
        for name, pattern in patterns.items():
            match_count = sum(1 for value in text_values if pattern.match(value))
            confidence = match_count / len(text_values)
            if confidence >= 0.6:
                detected.append(
                    {
                        "name": name,
                        "match_count": match_count,
                        "sample_size": len(text_values),
                        "confidence": confidence,
                    }
                )
        return detected

    def _detect_pii(self, column_name: str, values: list[Any]) -> list[dict[str, Any]]:
        normalized_name = column_name.lower()
        detections = []
        name_rules = {
            "email": ("email", "Column name suggests email address."),
            "phone": ("phone", "Column name suggests phone number."),
            "mobile": ("phone", "Column name suggests phone number."),
            "first_name": ("person_name", "Column name suggests a person name."),
            "firstname": ("person_name", "Column name suggests a person name."),
            "last_name": ("person_name", "Column name suggests a person name."),
            "lastname": ("person_name", "Column name suggests a person name."),
            "full_name": ("person_name", "Column name suggests a person name."),
            "fullname": ("person_name", "Column name suggests a person name."),
            "person_name": ("person_name", "Column name suggests a person name."),
            "contact_name": ("person_name", "Column name suggests a person name."),
            "address": ("address", "Column name suggests a physical address."),
            "ssn": ("national_identifier", "Column name suggests national identifier."),
            "passport": ("national_identifier", "Column name suggests passport identifier."),
            "student_id": ("person_identifier", "Column name suggests student identifier."),
            "customer_id": ("person_identifier", "Column name suggests customer identifier."),
            "user_id": ("person_identifier", "Column name suggests user identifier."),
        }
        for token, (pii_type, reason) in name_rules.items():
            if token in normalized_name:
                detections.append({"pii_type": pii_type, "confidence": 0.8, "reason": reason})
                break

        value_patterns = {
            "email": re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$"),
            "phone": re.compile(r"^\+?[0-9][0-9 .()\-]{7,}$"),
        }
        text_values = [str(value).strip() for value in values if value is not None and str(value).strip()]
        for pii_type, pattern in value_patterns.items():
            if not text_values:
                continue
            match_ratio = sum(1 for value in text_values if pattern.match(value)) / len(text_values)
            if match_ratio >= 0.6:
                detections.append(
                    {
                        "pii_type": pii_type,
                        "confidence": match_ratio,
                        "reason": f"Sampled values match {pii_type} pattern.",
                    }
                )
        return detections

    def _create_table_sql(self, file_path: Path) -> str:
        normalized_path = str(file_path.resolve()).replace("\\", "/").replace("'", "''")
        return (
            "CREATE TEMP TABLE profile_data AS "
            f"SELECT * FROM read_csv_auto('{normalized_path}', header=true, sample_size=-1)"
        )
