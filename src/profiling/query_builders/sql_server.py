"""SQL Server query builder for database query pushdown.

This module owns T-SQL syntax for profiling metrics.
"""

from src.profiling.query_builders.base import QueryBuilder


class SQLServerQueryBuilder(QueryBuilder):
    def quote_identifier(self, identifier: str) -> str:
        return f"[{identifier.replace(']', ']]')}]"

    def row_count_query(self, table_name: str, schema_name: str | None = None) -> str:
        return f"SELECT COUNT_BIG(*) FROM {self.table_reference(table_name, schema_name)}"

    def null_count_query(
        self,
        table_name: str,
        column_name: str,
        schema_name: str | None = None,
    ) -> str:
        column = self.quote_identifier(column_name)
        table = self.table_reference(table_name, schema_name)
        return f"SELECT SUM(CASE WHEN {column} IS NULL THEN 1 ELSE 0 END) FROM {table}"

    def distinct_count_query(
        self,
        table_name: str,
        column_name: str,
        schema_name: str | None = None,
    ) -> str:
        column = self.quote_identifier(column_name)
        table = self.table_reference(table_name, schema_name)
        return f"SELECT COUNT(DISTINCT {column}) FROM {table}"

    def min_max_query(
        self,
        table_name: str,
        column_name: str,
        schema_name: str | None = None,
    ) -> str:
        column = self.quote_identifier(column_name)
        table = self.table_reference(table_name, schema_name)
        return f"SELECT MIN({column}), MAX({column}) FROM {table}"

    def numeric_stats_query(
        self,
        table_name: str,
        column_name: str,
        schema_name: str | None = None,
    ) -> str:
        column = self.quote_identifier(column_name)
        table = self.table_reference(table_name, schema_name)
        return f"SELECT AVG(CAST({column} AS FLOAT)), STDEV(CAST({column} AS FLOAT)) FROM {table}"

    def quantile_query(
        self,
        table_name: str,
        column_name: str,
        schema_name: str | None = None,
    ) -> str:
        column = self.quote_identifier(column_name)
        table = self.table_reference(table_name, schema_name)
        return (
            "SELECT DISTINCT "
            f"PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY {column}) OVER (), "
            f"PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY {column}) OVER (), "
            f"PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY {column}) OVER () "
            f"FROM {table} WHERE {column} IS NOT NULL"
        )

    def outlier_count_query(
        self,
        table_name: str,
        column_name: str,
        lower_bound: float,
        upper_bound: float,
        schema_name: str | None = None,
    ) -> str:
        column = self.quote_identifier(column_name)
        table = self.table_reference(table_name, schema_name)
        return (
            f"SELECT COUNT_BIG(*) FROM {table} "
            f"WHERE {column} IS NOT NULL AND ({column} < {lower_bound} OR {column} > {upper_bound})"
        )

    def sample_values_query(
        self,
        table_name: str,
        column_name: str,
        limit: int,
        schema_name: str | None = None,
    ) -> str:
        column = self.quote_identifier(column_name)
        table = self.table_reference(table_name, schema_name)
        return f"SELECT DISTINCT TOP ({limit}) {column} FROM {table} WHERE {column} IS NOT NULL"

    def top_values_query(
        self,
        table_name: str,
        column_name: str,
        limit: int,
        schema_name: str | None = None,
    ) -> str:
        column = self.quote_identifier(column_name)
        table = self.table_reference(table_name, schema_name)
        return (
            f"SELECT TOP ({limit}) {column}, COUNT_BIG(*) AS value_count FROM {table} "
            f"WHERE {column} IS NOT NULL GROUP BY {column} "
            f"ORDER BY value_count DESC, {column}"
        )

    def column_values_query(
        self,
        table_name: str,
        column_name: str,
        limit: int,
        schema_name: str | None = None,
    ) -> str:
        column = self.quote_identifier(column_name)
        table = self.table_reference(table_name, schema_name)
        return f"SELECT TOP ({limit}) {column} FROM {table} WHERE {column} IS NOT NULL"

    def correlation_query(
        self,
        table_name: str,
        left_column: str,
        right_column: str,
        schema_name: str | None = None,
    ) -> str:
        left = self.quote_identifier(left_column)
        right = self.quote_identifier(right_column)
        table = self.table_reference(table_name, schema_name)
        return (
            "SELECT "
            f"(COUNT_BIG(*) * SUM(CAST({left} AS FLOAT) * CAST({right} AS FLOAT)) "
            f"- SUM(CAST({left} AS FLOAT)) * SUM(CAST({right} AS FLOAT))) "
            "/ NULLIF(SQRT("
            f"(COUNT_BIG(*) * SUM(POWER(CAST({left} AS FLOAT), 2)) - POWER(SUM(CAST({left} AS FLOAT)), 2)) "
            "* "
            f"(COUNT_BIG(*) * SUM(POWER(CAST({right} AS FLOAT), 2)) - POWER(SUM(CAST({right} AS FLOAT)), 2))"
            "), 0) "
            f"FROM {table} WHERE {left} IS NOT NULL AND {right} IS NOT NULL"
        )
