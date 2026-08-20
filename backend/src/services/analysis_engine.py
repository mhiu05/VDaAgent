"""Bounded, deterministic aggregate engine for analysis sessions.

It deliberately has no raw-SQL entry point.  The only values interpolated into
SQL are validated identifiers; filter values are always bound parameters.
"""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from threading import Lock
from typing import Any

import duckdb
from src.services.repository import Repository
from src.services.storage import materialize_source


class AnalysisQueryError(ValueError):
    pass


class ExecutionControl:
    """Thread-safe cancellation handle for a bounded DuckDB execution."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._connection: duckdb.DuckDBPyConnection | None = None

    def attach(self, connection: duckdb.DuckDBPyConnection) -> None:
        with self._lock:
            self._connection = connection

    def detach(self) -> None:
        with self._lock:
            self._connection = None

    def cancel(self) -> None:
        with self._lock:
            connection = self._connection
        if connection is not None:
            connection.interrupt()


def _identifier(value: str) -> str:
    if not value or "\x00" in value:
        raise AnalysisQueryError("Tên cột không hợp lệ.")
    return '"' + value.replace('"', '""') + '"'


def _reader(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".csv", ".tsv"}:
        return "read_csv_auto(?, header=true)"
    if suffix == ".parquet":
        return "read_parquet(?)"
    if suffix == ".json":
        return "read_json_auto(?)"
    raise AnalysisQueryError("Định dạng nguồn chưa được hỗ trợ cho analysis.")


class AnalysisEngine:
    def __init__(self, repository: Repository) -> None:
        self.repository = repository

    def execute(
        self,
        *,
        profile_run_id: str,
        context: dict[str, Any],
        query: dict[str, Any],
        execution_kind: str = "official",
        preview_row_budget: int | None = None,
        preview_seed: int = 42,
        control: ExecutionControl | None = None,
    ) -> dict[str, Any]:
        if execution_kind not in {"preview", "official"}:
            raise AnalysisQueryError("Execution kind is not supported.")
        run = self.repository.get_profile_run(profile_run_id)
        if not run:
            raise AnalysisQueryError("Profile run không tồn tại.")
        dataset = self.repository.get_dataset(run["dataset_id"])
        source_ref = str((dataset or {}).get("source_ref", ""))
        if not source_ref:
            raise AnalysisQueryError("Profile run không có immutable source.")

        stats = self.repository.get_column_stats(profile_run_id)
        columns = set(stats)
        pii = self.repository.confirmed_pii_columns(profile_run_id)
        dimensions = list(query.get("dimensions") or [])
        aggregate = str(query.get("aggregate"))
        value_column = query.get("column")
        if aggregate != "count" and not value_column:
            raise AnalysisQueryError("Aggregate này cần một cột measure.")
        if value_column and value_column not in columns:
            raise AnalysisQueryError("Cột measure không thuộc source đã pin.")
        if value_column in pii:
            raise AnalysisQueryError("Không thể aggregate trực tiếp trên cột PII.")
        for column in dimensions:
            if column not in columns:
                raise AnalysisQueryError(
                    f"Dimension '{column}' không thuộc source đã pin."
                )
            if column in pii:
                raise AnalysisQueryError("Không thể group-by trên cột PII.")
        allowed = (
            set(context.get("dimensions") or [])
            | set(context.get("measures") or [])
            | set(context.get("keys") or [])
        )
        if allowed and any(
            column not in allowed
            for column in [
                *dimensions,
                *([value_column] if value_column else []),
                *[str(item.get("column")) for item in query.get("filters") or []],
            ]
        ):
            raise AnalysisQueryError("Cột chưa được duyệt trong semantic context.")

        expressions = {
            "count": "COUNT(*)",
            "count_distinct": f"COUNT(DISTINCT {_identifier(str(value_column))})",
            "sum": f"SUM({_identifier(str(value_column))})",
            "mean": f"AVG({_identifier(str(value_column))})",
            "median": f"MEDIAN({_identifier(str(value_column))})",
        }
        if aggregate not in expressions:
            raise AnalysisQueryError("Aggregate không nằm trong allowlist.")
        where, params = self._filters(query.get("filters") or [], columns, pii)
        select_dimensions = ", ".join(_identifier(item) for item in dimensions)
        select_prefix = f"{select_dimensions}, " if select_dimensions else ""
        group = f" GROUP BY {select_dimensions}" if dimensions else ""
        sort = "ASC" if query.get("sort", "desc") == "asc" else "DESC"
        order = f" ORDER BY value {sort} NULLS LAST" if dimensions else ""
        limit = int(query.get("limit", 100))
        if execution_kind == "preview" and limit > 50:
            raise AnalysisQueryError("Preview results are limited to 50 groups.")
        sql = (
            f"SELECT {select_prefix}{expressions[aggregate]} AS value "
            f"FROM source{where}{group}{order} LIMIT {limit}"
        )
        started = time.perf_counter()
        connection = duckdb.connect(database=":memory:")
        if control:
            control.attach(connection)
        try:
            with materialize_source(source_ref) as source:
                # DuckDB does not prepare CREATE VIEW, while CREATE TABLE supports
                # bound file paths. This temporary in-memory table never exposes
                # rows through the API; it only feeds bounded aggregates below.
                if execution_kind == "preview":
                    row_budget = int(preview_row_budget or 50_000)
                    sample_sql = (
                        "CREATE TEMP TABLE source AS SELECT * FROM "
                        f"{_reader(source)} USING SAMPLE reservoir({row_budget} ROWS) "
                        f"REPEATABLE({int(preview_seed)})"
                    )
                    connection.execute(sample_sql, [str(source)])
                else:
                    connection.execute(
                        f"CREATE TEMP TABLE source AS SELECT * FROM {_reader(source)}",
                        [str(source)],
                    )
                rows = connection.execute(sql, params).fetchall()
                names = [item[0] for item in connection.description]
        except (duckdb.Error, FileNotFoundError, OSError, TimeoutError, ValueError) as exc:
            raise AnalysisQueryError(
                "Không thể tải nguồn dữ liệu để chạy Preview. Hãy thử lại sau khi kiểm tra kết nối nguồn lưu trữ."
            ) from exc
        finally:
            if control:
                control.detach()
            connection.close()
        data = [dict(zip(names, row, strict=True)) for row in rows]
        result = {"data": data, "columns": names, "row_count": len(data)}
        canonical = json.dumps(
            query, sort_keys=True, ensure_ascii=False, separators=(",", ":")
        )
        result_hash = hashlib.sha256(
            json.dumps(result, sort_keys=True, default=str).encode()
        ).hexdigest()
        limitations = list(context.get("limitations") or [])
        if execution_kind == "preview":
            effective_row_budget = int(preview_row_budget or 50_000)
            limitations.append(
                "Preview uses a reservoir sample "
                f"(seed={int(preview_seed)}, row_budget={effective_row_budget}); "
                "confirm the result before using it as official evidence."
            )
        return {
            "result": result,
            "result_hash": result_hash,
            "canonical_query": json.loads(canonical),
            "duration_ms": round((time.perf_counter() - started) * 1000),
            "is_approximate": execution_kind == "preview",
            "limitations": limitations,
            "execution_kind": execution_kind,
            "query_summary": query_summary(query),
        }

    def _filters(
        self, filters: list[dict[str, Any]], columns: set[str], pii: set[str]
    ) -> tuple[str, list[Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        operators = {
            "eq": "=",
            "ne": "!=",
            "gt": ">",
            "gte": ">=",
            "lt": "<",
            "lte": "<=",
        }
        for item in filters:
            column = item.get("column")
            operator = item.get("operator")
            if column not in columns or column in pii:
                raise AnalysisQueryError("Filter dùng cột không hợp lệ hoặc PII.")
            quoted = _identifier(str(column))
            if operator in operators:
                clauses.append(f"{quoted} {operators[operator]} ?")
                params.append(item.get("value"))
            elif operator in {"in", "not_in"}:
                values = item.get("value")
                if not isinstance(values, list) or not values or len(values) > 100:
                    raise AnalysisQueryError("Filter IN cần 1–100 giá trị.")
                placeholders = ", ".join("?" for _ in values)
                in_operator = "NOT IN" if operator == "not_in" else "IN"
                clauses.append(f"{quoted} {in_operator} ({placeholders})")
                params.extend(values)
            elif operator == "is_null":
                clauses.append(f"{quoted} IS NULL")
            elif operator == "not_null":
                clauses.append(f"{quoted} IS NOT NULL")
            else:
                raise AnalysisQueryError("Toán tử filter không được hỗ trợ.")
        return (" WHERE " + " AND ".join(clauses) if clauses else ""), params


def query_summary(query: dict[str, Any]) -> str:
    """Return a deterministic, user-facing description of the bounded query."""
    aggregate_labels = {
        "count": "Count rows",
        "count_distinct": "Count distinct values",
        "sum": "Sum",
        "mean": "Mean",
        "median": "Median",
    }
    aggregate = aggregate_labels.get(str(query.get("aggregate")), "Aggregate")
    column = query.get("column")
    metric = f" {column}" if column else ""
    dimensions = [str(item) for item in query.get("dimensions") or []]
    grouped = f" by {', '.join(dimensions)}" if dimensions else ""
    filters = query.get("filters") or []
    filtered = f" with {len(filters)} filter(s)" if filters else ""
    limit = int(query.get("limit", 100))
    return f"{aggregate}{metric}{grouped}{filtered}; showing up to {limit} group(s)."
