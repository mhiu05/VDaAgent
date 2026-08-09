"""Database executor for SQL Server and PostgreSQL query pushdown.

This module coordinates database discovery, preview, and metric query execution.
Connection URL construction lives in `database/connection.py`.
"""

from __future__ import annotations

import struct
from itertools import combinations
from typing import Any

from src.models.schemas import DatabaseConnectionConfig
from src.profiling.executors.common.detectors import detect_pii, detect_regex_patterns
from src.profiling.executors.common.numeric_rules import (
    correlation_strength,
    iqr_bounds,
    is_correlatable_numeric,
    is_continuous_numeric,
    should_include_top_values,
)
from src.profiling.executors.database.connection import build_connection_details, build_query_builder
from src.profiling.metrics import MetricName
from src.profiling.planner import ProfilePlan


class DatabaseProfileExecutor:
    def __init__(self, config: DatabaseConnectionConfig) -> None:
        try:
            from sqlalchemy import create_engine, text
        except ImportError as exc:
            raise RuntimeError(
                "SQLAlchemy is required for database profiling. Install project dependencies first."
            ) from exc

        self.config = config
        self.text = text
        self.query_builder = build_query_builder(config.type)
        connection_details = build_connection_details(config)
        self.engine = create_engine(
            connection_details.url,
            connect_args=connection_details.connect_args,
            pool_pre_ping=True,
        )
        if config.type == "sql_server":
            self._register_sql_server_output_converters()

    def _register_sql_server_output_converters(self) -> None:
        try:
            from sqlalchemy import event
        except ImportError:
            return

        @event.listens_for(self.engine, "connect")
        def add_output_converters(dbapi_connection: Any, _connection_record: Any) -> None:
            if hasattr(dbapi_connection, "add_output_converter"):
                dbapi_connection.add_output_converter(-151, _decode_datetimeoffset)

    def test_connection(self) -> dict[str, str]:
        with self.engine.connect() as connection:
            connection.execute(self.text("SELECT 1"))
        return {"status": "ok", "database_type": self.config.type, "database": self.config.database}

    def list_tables(self) -> list[dict[str, str]]:
        query = self._list_tables_query()
        with self.engine.connect() as connection:
            rows = connection.execute(self.text(query)).fetchall()
        return [{"schema": row[0], "table": row[1]} for row in rows]

    def get_schema(self, table_name: str, schema_name: str | None = None) -> list[dict[str, str]]:
        query = """
            SELECT COLUMN_NAME, DATA_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = :table_name
              AND (:schema_name IS NULL OR TABLE_SCHEMA = :schema_name)
            ORDER BY ORDINAL_POSITION
        """
        with self.engine.connect() as connection:
            rows = connection.execute(
                self.text(query),
                {"table_name": table_name, "schema_name": schema_name},
            ).fetchall()
        return [{"name": row[0], "data_type": row[1]} for row in rows]

    def preview_table(
        self,
        table_name: str,
        schema_name: str | None = None,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        safe_limit = min(max(limit, 1), 100)
        table = self.query_builder.table_reference(table_name, schema_name)
        if self.config.type == "sql_server":
            query = f"SELECT TOP ({safe_limit}) * FROM {table}"
        else:
            query = f"SELECT * FROM {table} LIMIT {safe_limit}"
        with self.engine.connect() as connection:
            result = connection.execute(self.text(query))
            rows = result.mappings().fetchall()
        return [dict(row) for row in rows]

    def profile_table(
        self,
        table_name: str,
        schema_name: str | None,
        plan: ProfilePlan,
    ) -> dict[str, Any]:
        with self.engine.connect() as connection:
            row_count = connection.execute(
                self.text(self.query_builder.row_count_query(table_name, schema_name))
            ).fetchone()[0]
            columns = [
                self._profile_column(connection, table_name, schema_name, column_plan, row_count)
                for column_plan in plan.columns
            ]
            correlations = self._profile_correlations(
                connection,
                table_name,
                schema_name,
                plan,
                columns,
                row_count,
            )

        source_name = f"{schema_name}.{table_name}" if schema_name else table_name
        return {
            "source_name": source_name,
            "source_type": self.config.type,
            "engine": self.config.type,
            "profile_mode": "database_pushdown",
            "row_count": row_count,
            "columns": columns,
            "correlations": correlations,
        }

    def _profile_column(
        self,
        connection: Any,
        table_name: str,
        schema_name: str | None,
        column_plan: Any,
        row_count: int,
    ) -> dict[str, Any]:
        result: dict[str, Any] = {
            "name": column_plan.name,
            "data_type": column_plan.data_type,
            "null_count": 0,
            "distinct_count": 0,
            "sample_values": [],
            "top_values": [],
        }
        self._add_count_metrics(connection, table_name, schema_name, column_plan, result, row_count)
        self._add_range_metrics(connection, table_name, schema_name, column_plan, result, row_count)
        self._add_pattern_metrics(connection, table_name, schema_name, column_plan, result)
        self._add_value_samples(connection, table_name, schema_name, column_plan, result, row_count)
        return result

    def _add_count_metrics(
        self,
        connection: Any,
        table_name: str,
        schema_name: str | None,
        column_plan: Any,
        result: dict[str, Any],
        row_count: int,
    ) -> None:
        if MetricName.NULL_COUNT in column_plan.metrics:
            result["null_count"] = connection.execute(
                self.text(
                    self.query_builder.null_count_query(table_name, column_plan.name, schema_name)
                )
            ).fetchone()[0] or 0

        if MetricName.DISTINCT_COUNT in column_plan.metrics:
            result["distinct_count"] = connection.execute(
                self.text(
                    self.query_builder.distinct_count_query(table_name, column_plan.name, schema_name)
                )
            ).fetchone()[0] or 0

    def _add_range_metrics(
        self,
        connection: Any,
        table_name: str,
        schema_name: str | None,
        column_plan: Any,
        result: dict[str, Any],
        row_count: int,
    ) -> None:
        if row_count > 0 and MetricName.MIN in column_plan.metrics:
            result["min"], result["max"] = connection.execute(
                self.text(self.query_builder.min_max_query(table_name, column_plan.name, schema_name))
            ).fetchone()

        if row_count > 0 and MetricName.AVG in column_plan.metrics:
            result["avg"], result["stddev"] = connection.execute(
                self.text(
                    self.query_builder.numeric_stats_query(table_name, column_plan.name, schema_name)
                )
            ).fetchone()

        if row_count > 0 and MetricName.MEDIAN in column_plan.metrics:
            result["p25"], result["median"], result["p75"] = connection.execute(
                self.text(self.query_builder.quantile_query(table_name, column_plan.name, schema_name))
            ).fetchone()
            self._add_outlier_metric(connection, table_name, schema_name, column_plan, result, row_count)

    def _add_outlier_metric(
        self,
        connection: Any,
        table_name: str,
        schema_name: str | None,
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
            self.text(
                self.query_builder.outlier_count_query(
                    table_name,
                    column_plan.name,
                    lower_bound,
                    upper_bound,
                    schema_name,
                )
            )
        ).fetchone()[0]
        result["outlier"] = {
            "method": "iqr",
            "lower_bound": lower_bound,
            "upper_bound": upper_bound,
            "outlier_count": outlier_count,
            "outlier_ratio": outlier_count / row_count if row_count else 0,
        }

    def _add_pattern_metrics(
        self,
        connection: Any,
        table_name: str,
        schema_name: str | None,
        column_plan: Any,
        result: dict[str, Any],
    ) -> None:
        if (
            MetricName.REGEX_PATTERNS not in column_plan.metrics
            and MetricName.PII_DETECTION not in column_plan.metrics
        ):
            return
        rows = connection.execute(
            self.text(
                self.query_builder.column_values_query(table_name, column_plan.name, 100, schema_name)
            )
        ).fetchall()
        sampled_values = [row[0] for row in rows]
        if MetricName.REGEX_PATTERNS in column_plan.metrics:
            result["regex_patterns"] = detect_regex_patterns(sampled_values)
        result["pii_detection"] = detect_pii(column_plan.name, sampled_values)

    def _add_value_samples(
        self,
        connection: Any,
        table_name: str,
        schema_name: str | None,
        column_plan: Any,
        result: dict[str, Any],
        row_count: int,
    ) -> None:
        if MetricName.SAMPLE_VALUES in column_plan.metrics:
            rows = connection.execute(
                self.text(
                    self.query_builder.sample_values_query(table_name, column_plan.name, 5, schema_name)
                )
            ).fetchall()
            result["sample_values"] = [row[0] for row in rows]

        if MetricName.TOP_VALUES in column_plan.metrics and should_include_top_values(result, row_count):
            rows = connection.execute(
                self.text(self.query_builder.top_values_query(table_name, column_plan.name, 5, schema_name))
            ).fetchall()
            result["top_values"] = [{"value": row[0], "count": row[1]} for row in rows]

    def _profile_correlations(
        self,
        connection: Any,
        table_name: str,
        schema_name: str | None,
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
                self.text(
                    self.query_builder.correlation_query(
                        table_name,
                        left_column,
                        right_column,
                        schema_name,
                    )
                )
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

    def _list_tables_query(self) -> str:
        if self.config.type == "sql_server":
            return """
                SELECT TABLE_SCHEMA, TABLE_NAME
                FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_TYPE = 'BASE TABLE'
                ORDER BY TABLE_SCHEMA, TABLE_NAME
            """
        return """
            SELECT table_schema, table_name
            FROM information_schema.tables
            WHERE table_type = 'BASE TABLE'
              AND table_schema NOT IN ('pg_catalog', 'information_schema')
            ORDER BY table_schema, table_name
        """


def _decode_datetimeoffset(raw_value: bytes) -> str:
    """Decode SQL Server DATETIMEOFFSET from pyodbc type -151 into ISO text."""
    try:
        year, month, day, hour, minute, second, fraction, tz_hour, tz_minute = struct.unpack(
            "<6hI2h",
            raw_value,
        )
        microsecond = fraction // 1000
        sign = "+" if tz_hour >= 0 else "-"
        return (
            f"{year:04d}-{month:02d}-{day:02d}T"
            f"{hour:02d}:{minute:02d}:{second:02d}.{microsecond:06d}"
            f"{sign}{abs(tz_hour):02d}:{abs(tz_minute):02d}"
        )
    except Exception:
        return str(raw_value)
