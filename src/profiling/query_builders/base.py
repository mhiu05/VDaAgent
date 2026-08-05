"""Base SQL query builder contracts for profiling.

Query builders isolate SQL dialect differences from executors. The MVP uses the
DuckDB builder end-to-end; database builders are placeholders for pushdown later.
"""

from __future__ import annotations

from abc import ABC, abstractmethod


class QueryBuilder(ABC):
    @abstractmethod
    def quote_identifier(self, identifier: str) -> str:
        raise NotImplementedError

    @abstractmethod
    def row_count_query(self, table_name: str) -> str:
        raise NotImplementedError

    @abstractmethod
    def null_count_query(self, table_name: str, column_name: str) -> str:
        raise NotImplementedError

    @abstractmethod
    def distinct_count_query(self, table_name: str, column_name: str) -> str:
        raise NotImplementedError

    def table_reference(self, table_name: str, schema_name: str | None = None) -> str:
        if schema_name:
            return f"{self.quote_identifier(schema_name)}.{self.quote_identifier(table_name)}"
        return self.quote_identifier(table_name)
