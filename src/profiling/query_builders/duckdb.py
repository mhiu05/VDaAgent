"""DuckDB SQL builder for file profiling.

The executor creates a temporary DuckDB table and uses these query snippets to
compute metrics safely with quoted identifiers.
"""

from __future__ import annotations

from src.profiling.query_builders.base import QueryBuilder


class DuckDBQueryBuilder(QueryBuilder):
    def quote_identifier(self, identifier: str) -> str:
        return f'"{identifier.replace(chr(34), chr(34) + chr(34))}"'

    def row_count_query(self, table_name: str) -> str:
        return f"SELECT COUNT(*) FROM {self.quote_identifier(table_name)}"

    def null_count_query(self, table_name: str, column_name: str) -> str:
        column = self.quote_identifier(column_name)
        table = self.quote_identifier(table_name)
        return f"SELECT SUM(CASE WHEN {column} IS NULL THEN 1 ELSE 0 END) FROM {table}"

    def distinct_count_query(self, table_name: str, column_name: str) -> str:
        column = self.quote_identifier(column_name)
        table = self.quote_identifier(table_name)
        return f"SELECT COUNT(DISTINCT {column}) FROM {table}"

    def min_max_query(self, table_name: str, column_name: str) -> str:
        column = self.quote_identifier(column_name)
        table = self.quote_identifier(table_name)
        return f"SELECT MIN({column}), MAX({column}) FROM {table}"

    def numeric_stats_query(self, table_name: str, column_name: str) -> str:
        column = self.quote_identifier(column_name)
        table = self.quote_identifier(table_name)
        return f"SELECT AVG({column}), STDDEV_SAMP({column}) FROM {table}"

    def quantile_query(self, table_name: str, column_name: str) -> str:
        column = self.quote_identifier(column_name)
        table = self.quote_identifier(table_name)
        return (
            f"SELECT quantile_cont({column}, 0.25), "
            f"quantile_cont({column}, 0.5), "
            f"quantile_cont({column}, 0.75) FROM {table}"
        )

    def outlier_count_query(
        self,
        table_name: str,
        column_name: str,
        lower_bound: float,
        upper_bound: float,
    ) -> str:
        column = self.quote_identifier(column_name)
        table = self.quote_identifier(table_name)
        return (
            f"SELECT COUNT(*) FROM {table} "
            f"WHERE {column} IS NOT NULL AND ({column} < {lower_bound} OR {column} > {upper_bound})"
        )

    def correlation_query(self, table_name: str, left_column: str, right_column: str) -> str:
        left = self.quote_identifier(left_column)
        right = self.quote_identifier(right_column)
        table = self.quote_identifier(table_name)
        return f"SELECT corr({left}, {right}) FROM {table}"

    def sample_values_query(self, table_name: str, column_name: str, limit: int) -> str:
        column = self.quote_identifier(column_name)
        table = self.quote_identifier(table_name)
        return f"SELECT DISTINCT {column} FROM {table} WHERE {column} IS NOT NULL LIMIT {limit}"

    def column_values_query(self, table_name: str, column_name: str, limit: int) -> str:
        column = self.quote_identifier(column_name)
        table = self.quote_identifier(table_name)
        return f"SELECT {column} FROM {table} WHERE {column} IS NOT NULL LIMIT {limit}"

    def top_values_query(self, table_name: str, column_name: str, limit: int) -> str:
        column = self.quote_identifier(column_name)
        table = self.quote_identifier(table_name)
        return (
            f"SELECT {column}, COUNT(*) AS value_count FROM {table} "
            f"WHERE {column} IS NOT NULL GROUP BY {column} "
            f"ORDER BY value_count DESC, {column} LIMIT {limit}"
        )
