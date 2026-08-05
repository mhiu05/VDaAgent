"""Database executor for SQL Server and PostgreSQL query pushdown.

This module connects to source databases, discovers tables/schema, previews
rows, and computes profiling metrics by pushing SQL aggregation queries to the
database instead of loading full data into the API process.
"""

from __future__ import annotations

import re
from itertools import combinations
from typing import Any
from urllib.parse import quote_plus

from src.models.schemas import DatabaseConnectionConfig
from src.profiling.metrics import MetricName, is_numeric_type
from src.profiling.planner import ProfilePlan, is_identifier_column
from src.profiling.query_builders.postgresql import PostgreSQLQueryBuilder
from src.profiling.query_builders.sql_server import SQLServerQueryBuilder


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
        self.query_builder = self._build_query_builder(config.type)
        self.engine = create_engine(self._build_connection_url(config), pool_pre_ping=True)

    def test_connection(self) -> dict[str, str]:
        with self.engine.connect() as connection:
            connection.execute(self.text("SELECT 1"))
        return {"status": "ok", "database_type": self.config.type, "database": self.config.database}

    def list_tables(self) -> list[dict[str, str]]:
        if self.config.type == "sql_server":
            query = """
                SELECT TABLE_SCHEMA, TABLE_NAME
                FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_TYPE = 'BASE TABLE'
                ORDER BY TABLE_SCHEMA, TABLE_NAME
            """
        else:
            query = """
                SELECT table_schema, table_name
                FROM information_schema.tables
                WHERE table_type = 'BASE TABLE'
                  AND table_schema NOT IN ('pg_catalog', 'information_schema')
                ORDER BY table_schema, table_name
            """
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

            if (
                MetricName.OUTLIER_COUNT in column_plan.metrics
                and result["p25"] is not None
                and self._is_continuous_numeric(column_plan.name, result, row_count)
            ):
                lower_bound, upper_bound = self._iqr_bounds(float(result["p25"]), float(result["p75"]))
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

        sampled_values = []
        if MetricName.REGEX_PATTERNS in column_plan.metrics or MetricName.PII_DETECTION in column_plan.metrics:
            sampled_rows = connection.execute(
                self.text(
                    self.query_builder.column_values_query(table_name, column_plan.name, 100, schema_name)
                )
            ).fetchall()
            sampled_values = [row[0] for row in sampled_rows]
            if MetricName.REGEX_PATTERNS in column_plan.metrics:
                result["regex_patterns"] = self._detect_regex_patterns(sampled_values)
            result["pii_detection"] = self._detect_pii(column_plan.name, sampled_values)

        if MetricName.SAMPLE_VALUES in column_plan.metrics:
            rows = connection.execute(
                self.text(
                    self.query_builder.sample_values_query(table_name, column_plan.name, 5, schema_name)
                )
            ).fetchall()
            result["sample_values"] = [row[0] for row in rows]

        if MetricName.TOP_VALUES in column_plan.metrics:
            rows = connection.execute(
                self.text(self.query_builder.top_values_query(table_name, column_plan.name, 5, schema_name))
            ).fetchall()
            result["top_values"] = [{"value": row[0], "count": row[1]} for row in rows]

        return result

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
            and self._is_continuous_numeric(column.name, column_stats[column.name], row_count)
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
                    "strength": self._correlation_strength(abs(float(coefficient))),
                }
            )
        correlations.sort(key=lambda item: abs(item["coefficient"]), reverse=True)
        return correlations[:20]

    def _build_connection_url(self, config: DatabaseConnectionConfig) -> str:
        if config.type == "postgresql":
            host = quote_plus(config.host)
            user = quote_plus(config.username)
            password = quote_plus(config.password)
            database = quote_plus(config.database)
            return f"postgresql+psycopg2://{user}:{password}@{host}:{config.port}/{database}"

        odbc = quote_plus(
            "DRIVER={"
            + (config.driver or "ODBC Driver 18 for SQL Server")
            + "};SERVER="
            + config.host
            + f",{config.port};DATABASE="
            + config.database
            + ";UID="
            + config.username
            + ";PWD="
            + config.password
            + ";Encrypt=yes;TrustServerCertificate=no;Connection Timeout=30;"
        )
        return f"mssql+pyodbc:///?odbc_connect={odbc}"

    def _build_query_builder(self, database_type: str) -> PostgreSQLQueryBuilder | SQLServerQueryBuilder:
        if database_type == "postgresql":
            return PostgreSQLQueryBuilder()
        return SQLServerQueryBuilder()

    def _is_continuous_numeric(
        self,
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
