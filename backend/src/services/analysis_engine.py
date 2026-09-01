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

# pyrefly: ignore [missing-import]
import duckdb
from src.services.forecasting import ForecastingError, forecast_series
from src.services.datasource import DatasourceError
from src.services.repository import Repository
from src.services.storage import artifact_source_ref, materialize_source


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
        workspace_id: str | None = None,
        context: dict[str, Any],
        query: dict[str, Any],
        execution_kind: str = "official",
        preview_row_budget: int | None = None,
        preview_seed: int = 42,
        control: ExecutionControl | None = None,
    ) -> dict[str, Any]:
        if execution_kind not in {"preview", "official"}:
            raise AnalysisQueryError("Execution kind is not supported.")
        run = (
            self.repository.get_profile_run(profile_run_id)
            if workspace_id is None
            else self.repository.get_profile_run(
                profile_run_id, workspace_id=workspace_id
            )
        )
        if not run:
            raise AnalysisQueryError("Profile run không tồn tại.")
        dataset = (
            self.repository.get_dataset(run["dataset_id"])
            if workspace_id is None
            else self.repository.get_dataset(
                run["dataset_id"], workspace_id=workspace_id
            )
        )
        source_ref = ""
        if run.get("artifact_id"):
            artifact = self.repository.get_dataset_artifact(
                str(run["artifact_id"]), workspace_id=str(run["workspace_id"])
            )
            if artifact and artifact.get("status") == "ready":
                source_ref = artifact_source_ref(artifact)
        if not source_ref:
            source_ref = str((dataset or {}).get("source_ref", ""))
        if not source_ref:
            raise AnalysisQueryError("Profile run không có immutable source.")

        stats = self.repository.get_column_stats(profile_run_id)
        columns = set(stats)
        pii = self.repository.confirmed_pii_columns(profile_run_id)
        dimensions = list(query.get("dimensions") or [])
        selected_columns = list(
            dict.fromkeys(str(item) for item in query.get("columns") or [])
        )
        analysis_kind = str(query.get("analysis_kind") or "aggregate")
        time_grain = query.get("time_grain")
        aggregate = str(query.get("aggregate"))
        value_column = query.get("column")
        x_column = query.get("x_column")
        y_column = query.get("y_column")
        bins = int(query.get("bins", 12))
        allowed_kinds = {
            "aggregate", "histogram", "scatter", "box", "heatmap", "forecast",
            "missing_bar", "missing_heatmap", "correlation_heatmap", "cardinality",
            "violin", "donut", "outlier",
        }
        if analysis_kind not in allowed_kinds:
            raise AnalysisQueryError("analysis_kind không nằm trong allowlist.")
        if len(selected_columns) > 12:
            raise AnalysisQueryError("Biểu đồ profiling hỗ trợ tối đa 12 cột.")
        profile_kinds = {
            "missing_bar", "missing_heatmap", "correlation_heatmap", "cardinality", "outlier"
        }
        if analysis_kind in profile_kinds and not selected_columns:
            candidates = [name for name in stats if name not in pii]
            semantic_columns = (
                set(context.get("dimensions") or [])
                | set(context.get("measures") or [])
                | set(context.get("keys") or [])
            )
            if semantic_columns:
                candidates = [name for name in candidates if name in semantic_columns]
            if analysis_kind in {"correlation_heatmap", "outlier"}:
                candidates = [
                    name for name in candidates
                    if any(
                        token in str(stats[name].get("dtype", "")).casefold()
                        for token in ("int", "float", "double", "decimal", "number")
                    )
                ]
            selected_columns = candidates[:12]
            query = {**query, "columns": selected_columns}
        if analysis_kind in {"missing_heatmap", "correlation_heatmap"} and len(selected_columns) < 2:
            raise AnalysisQueryError("Heatmap profiling cần ít nhất hai cột hợp lệ.")
        if not 5 <= bins <= 30:
            raise AnalysisQueryError("bins phải nằm trong khoảng 5–30.")
        if (
            analysis_kind in {"aggregate", "heatmap", "forecast", "donut"}
            and aggregate != "count"
            and not value_column
        ):
            raise AnalysisQueryError("Aggregate này cần một cột measure.")
        if analysis_kind in {"histogram", "box", "violin"} and not value_column:
            raise AnalysisQueryError("Phân tích phân phối cần một cột measure.")
        if analysis_kind == "scatter" and (not x_column or not y_column):
            raise AnalysisQueryError("Scatter cần x_column và y_column.")
        if analysis_kind == "scatter" and x_column == y_column:
            raise AnalysisQueryError("Scatter cần hai measure khác nhau.")
        if analysis_kind == "histogram" and dimensions:
            raise AnalysisQueryError("Histogram không hỗ trợ dimension.")
        if analysis_kind == "box" and len(dimensions) > 1:
            raise AnalysisQueryError("Box plot hỗ trợ tối đa một dimension.")
        if analysis_kind == "scatter" and dimensions:
            raise AnalysisQueryError("Scatter density không hỗ trợ dimension.")
        if analysis_kind == "heatmap" and len(dimensions) != 2:
            raise AnalysisQueryError("Heatmap cần đúng hai dimensions.")
        if analysis_kind == "violin" and len(dimensions) > 1:
            raise AnalysisQueryError("Violin plot hỗ trợ tối đa một dimension.")
        if analysis_kind == "donut" and len(dimensions) != 1:
            raise AnalysisQueryError("Donut chart cần đúng một dimension.")
        if analysis_kind in profile_kinds and (dimensions or value_column or x_column or y_column):
            raise AnalysisQueryError("Biểu đồ metric profiling chỉ nhận danh sách columns.")
        if time_grain and analysis_kind not in {"aggregate", "forecast"}:
            raise AnalysisQueryError("time_grain chỉ hỗ trợ aggregate hoặc forecast time-series.")
        if analysis_kind == "forecast":
            if len(dimensions) != 1 or not time_grain:
                raise AnalysisQueryError("Forecast cần đúng một time dimension và time_grain.")
            if not query.get("forecast_algorithm"):
                raise AnalysisQueryError("Forecast cần một thuật toán trong allow-list.")
            if x_column or y_column:
                raise AnalysisQueryError("Forecast không nhận x_column/y_column tùy ý.")
        requested_columns = {
            str(item)
            for item in [value_column, x_column, y_column, *dimensions, *selected_columns]
            if item
        }
        for requested in requested_columns:
            if requested not in columns:
                raise AnalysisQueryError(
                    f"Cột '{requested}' không thuộc source đã pin."
                )
            if requested in pii:
                raise AnalysisQueryError(
                    "Không thể dùng cột PII trong phân tích biểu đồ."
                )
        measures = set(context.get("measures") or [])
        if (
            analysis_kind in {"histogram", "box", "violin", "forecast"}
            and measures
            and aggregate != "count"
            and value_column not in measures
        ):
            raise AnalysisQueryError(
                "Phân tích phân phối chỉ chấp nhận measure đã duyệt."
            )
        if (
            analysis_kind == "scatter"
            and measures
            and ({x_column, y_column} - measures)
        ):
            raise AnalysisQueryError("Scatter chỉ chấp nhận hai measure đã duyệt.")
        for column in dimensions:
            if column not in columns:
                raise AnalysisQueryError(
                    f"Dimension '{column}' không thuộc source đã pin."
                )
            if column in pii:
                raise AnalysisQueryError("Không thể group-by trên cột PII.")
        if time_grain not in {None, "day", "week", "month", "quarter", "year"}:
            raise AnalysisQueryError("time_grain không nằm trong allowlist.")
        if time_grain and len(dimensions) != 1:
            raise AnalysisQueryError("time_grain chỉ hỗ trợ đúng một time dimension.")
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
                *([x_column] if x_column else []),
                *([y_column] if y_column else []),
                *selected_columns,
                *[str(item.get("column")) for item in query.get("filters") or []],
            ]
        ):
            raise AnalysisQueryError("Cột chưa được duyệt trong semantic context.")

        if analysis_kind == "donut":
            cardinality = int((stats.get(dimensions[0]) or {}).get("cardinality") or 0)
            if cardinality < 1 or cardinality > 12:
                raise AnalysisQueryError("Pie/Donut chỉ hỗ trợ dimension có từ 1 đến 12 nhóm.")

        if analysis_kind in profile_kinds - {"missing_heatmap"}:
            started = time.perf_counter()
            result = self._profile_result(
                analysis_kind=analysis_kind,
                selected_columns=selected_columns,
                stats=stats,
                run=run,
            )
            limitations = list(context.get("limitations") or [])
            limitations.append(
                "Kết quả dùng metric tổng hợp đã lưu trong Profile Run; không trả dữ liệu dòng thô."
            )
            return self._finalize(
                query=query,
                result=result,
                started=started,
                execution_kind=execution_kind,
                limitations=limitations,
                is_approximate=bool(run.get("is_approximate")),
            )

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
        dimension_selects: list[str] = []
        dimension_groups: list[str] = []
        for item in dimensions:
            identifier = _identifier(item)
            if time_grain:
                expression = (
                    f"date_trunc('{time_grain}', TRY_CAST({identifier} AS TIMESTAMP))"
                )
                dimension_selects.append(f"{expression} AS {identifier}")
                dimension_groups.append(expression)
            else:
                dimension_selects.append(identifier)
                dimension_groups.append(identifier)
        if time_grain:
            # A failed date cast must not become a misleading ``NULL`` bucket.
            # Keep this predicate server-generated; users still cannot submit SQL.
            time_predicate = (
                f"TRY_CAST({_identifier(dimensions[0])} AS TIMESTAMP) IS NOT NULL"
            )
            where = (
                f"{where} AND {time_predicate}" if where else f" WHERE {time_predicate}"
            )
        select_dimensions = ", ".join(dimension_selects)
        select_prefix = f"{select_dimensions}, " if select_dimensions else ""
        group = f" GROUP BY {', '.join(dimension_groups)}" if dimensions else ""
        sort = "ASC" if query.get("sort", "desc") == "asc" else "DESC"
        # Time series are always chronological. ``sort`` controls rankings and
        # categorical comparisons only; ordering a trend by metric value would
        # silently turn a line chart into the wrong story.
        if time_grain and dimension_groups:
            order = f" ORDER BY {dimension_groups[0]} ASC NULLS LAST"
        else:
            order = f" ORDER BY value {sort} NULLS LAST" if dimensions else ""
        limit = int(query.get("limit", 100))
        if execution_kind == "preview" and limit > 50:
            raise AnalysisQueryError("Preview results are limited to 50 groups.")
        if analysis_kind == "histogram":
            sql = self._histogram_sql(str(value_column), where, bins)
        elif analysis_kind == "scatter":
            sql = self._scatter_sql(str(x_column), str(y_column), where, bins, limit)
        elif analysis_kind == "box":
            sql = self._box_sql(str(value_column), dimensions, where, sort, limit)
        elif analysis_kind == "violin":
            sql = self._violin_sql(
                str(value_column), dimensions, where, bins, min(limit, 8)
            )
        elif analysis_kind == "missing_heatmap":
            sql = self._missing_heatmap_sql(selected_columns)
        elif analysis_kind == "forecast":
            sql = self._forecast_history_sql(
                dimension_groups[0],
                expressions[aggregate],
                where,
                group,
                int(query.get("history_limit", 500)),
            )
        else:
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
        except (
            duckdb.Error,
            DatasourceError,
            FileNotFoundError,
            OSError,
            TimeoutError,
            ValueError,
        ) as exc:
            raise AnalysisQueryError(
                "Không thể tải nguồn dữ liệu để chạy Preview. Hãy thử lại sau khi kiểm tra kết nối nguồn lưu trữ."
            ) from exc
        finally:
            if control:
                control.detach()
            connection.close()
        data = [dict(zip(names, row, strict=True)) for row in rows]
        if analysis_kind == "forecast":
            try:
                forecast = forecast_series(
                    [row["timestamp"] for row in data],
                    [row["value"] for row in data],
                    algorithm=str(query.get("forecast_algorithm")),
                    horizon=int(query.get("forecast_horizon", 12)),
                    season_length=int(query.get("season_length", 12)),
                    confidence_level=float(query.get("confidence_level", 0.95)),
                    time_grain=str(time_grain),
                )
            except ForecastingError as exc:
                raise AnalysisQueryError(str(exc)) from exc
            time_column = dimensions[0]
            history_count = min(len(forecast["history_values"]), 60)
            history_rows = [
                {
                    time_column: timestamp,
                    "value": value,
                    "series": "actual",
                    "lower": None,
                    "upper": None,
                }
                for timestamp, value in zip(
                    forecast["history_timestamps"][-history_count:],
                    forecast["history_values"][-history_count:],
                    strict=True,
                )
            ]
            forecast_rows = [
                {
                    time_column: timestamp,
                    "value": value,
                    "series": "forecast",
                    "lower": lower,
                    "upper": upper,
                }
                for timestamp, value, lower, upper in zip(
                    forecast["timestamps"],
                    forecast["forecast"],
                    forecast["lower"],
                    forecast["upper"],
                    strict=True,
                )
            ]
            data = history_rows + forecast_rows
            names = [time_column, "value", "series", "lower", "upper"]
        result = {"data": data, "columns": names, "row_count": len(data)}
        limitations = list(context.get("limitations") or [])
        if analysis_kind == "forecast":
            limitations.append(
                "Forecast là ước lượng mô hình, không phải giá trị chắc chắn; "
                "prediction interval được ước lượng từ độ lệch chuẩn lịch sử."
            )
            limitations.extend(
                f"Model warning: {message}" for message in forecast.get("warnings", [])
            )
        if execution_kind == "preview":
            effective_row_budget = int(preview_row_budget or 50_000)
            limitations.append(
                "Preview uses a reservoir sample "
                f"(seed={int(preview_seed)}, row_budget={effective_row_budget}); "
                "confirm the result before using it as official evidence."
            )
        if analysis_kind == "missing_heatmap":
            limitations.append(
                "Missing Value Heatmap hiển thị tỷ lệ đồng thiếu theo cặp cột, không hiển thị pattern của từng dòng."
            )
        if analysis_kind == "violin":
            limitations.append(
                "Violin plot được dựng từ histogram theo nhóm; không truyền các điểm dữ liệu thô tới frontend."
            )
        return self._finalize(
            query=query,
            result=result,
            started=started,
            execution_kind=execution_kind,
            limitations=limitations,
            is_approximate=execution_kind == "preview",
        )

    @staticmethod
    def _finalize(
        *,
        query: dict[str, Any],
        result: dict[str, Any],
        started: float,
        execution_kind: str,
        limitations: list[str],
        is_approximate: bool,
    ) -> dict[str, Any]:
        canonical = json.dumps(
            query, sort_keys=True, ensure_ascii=False, separators=(",", ":")
        )
        result_hash = hashlib.sha256(
            json.dumps(result, sort_keys=True, default=str).encode()
        ).hexdigest()
        return {
            "result": result,
            "result_hash": result_hash,
            "canonical_query": json.loads(canonical),
            "duration_ms": round((time.perf_counter() - started) * 1000),
            "is_approximate": is_approximate,
            "limitations": limitations,
            "execution_kind": execution_kind,
            "query_summary": query_summary(query),
        }

    @staticmethod
    def _profile_result(
        *,
        analysis_kind: str,
        selected_columns: list[str],
        stats: dict[str, dict[str, Any]],
        run: dict[str, Any],
    ) -> dict[str, Any]:
        if analysis_kind == "correlation_heatmap":
            matrix = run.get("correlation_matrix") or {}
            rows = [
                {"x": left, "y": right, "value": matrix.get(left, {}).get(right)}
                for left in selected_columns
                for right in selected_columns
                if matrix.get(left, {}).get(right) is not None
            ]
            return {
                "data": rows,
                "columns": ["x", "y", "value"],
                "row_count": len(rows),
            }

        metric = {
            "missing_bar": "null_pct",
            "cardinality": "cardinality",
            "outlier": "outlier_count",
        }[analysis_kind]
        total_rows = max(int(run.get("row_count") or 0), 1)
        rows: list[dict[str, Any]] = []
        for name in selected_columns:
            stat = stats.get(name) or {}
            raw_value = stat.get(metric)
            if raw_value is None:
                continue
            value = (
                float(raw_value) / total_rows * 100
                if analysis_kind == "outlier"
                else float(raw_value)
            )
            count_value = (
                stat.get("null_count") if metric == "null_pct" else raw_value
            )
            rows.append(
                {
                    "column": name,
                    "value": value,
                    "count": int(count_value or 0),
                }
            )
        rows.sort(key=lambda item: (-float(item["value"]), item["column"]))
        return {
            "data": rows,
            "columns": ["column", "value", "count"],
            "row_count": len(rows),
        }

    @staticmethod
    def _with_predicate(where: str, predicate: str) -> str:
        return f"{where} AND {predicate}" if where else f" WHERE {predicate}"

    def _histogram_sql(self, column: str, where: str, bins: int) -> str:
        quoted = _identifier(column)
        bounded_where = self._with_predicate(
            where, f"TRY_CAST({quoted} AS DOUBLE) IS NOT NULL"
        )
        return (
            "WITH numeric_values AS ("
            f"SELECT TRY_CAST({quoted} AS DOUBLE) AS numeric_value FROM source{bounded_where}"
            "), bounds AS ("
            "SELECT MIN(numeric_value) AS min_value, MAX(numeric_value) AS max_value "
            "FROM numeric_values"
            "), binned AS ("
            "SELECT numeric_value, min_value, max_value, "
            "CASE WHEN max_value = min_value THEN 0 ELSE "
            f"LEAST({bins - 1}, GREATEST(0, FLOOR((numeric_value - min_value) "
            f"/ NULLIF(max_value - min_value, 0) * {bins}))) END AS bin_index "
            "FROM numeric_values CROSS JOIN bounds"
            ") SELECT CAST(bin_index AS INTEGER) AS bin_index, "
            f"MIN(min_value + bin_index * (max_value - min_value) / {bins}) AS bin_start, "
            f"MAX(CASE WHEN max_value = min_value THEN max_value ELSE min_value + "
            f"(bin_index + 1) * (max_value - min_value) / {bins} END) AS bin_end, "
            "COUNT(*) AS value FROM binned "
            "GROUP BY bin_index ORDER BY bin_index ASC"
        )

    @staticmethod
    def _forecast_history_sql(
        time_expression: str,
        aggregate_expression: str,
        where: str,
        group: str,
        history_limit: int,
    ) -> str:
        if not 12 <= history_limit <= 2000:
            raise AnalysisQueryError("history_limit phải nằm trong khoảng 12–2000.")
        return (
            "WITH complete_series AS ("
            f"SELECT {time_expression} AS timestamp, {aggregate_expression} AS value "
            f"FROM source{where}{group}"
            "), recent_series AS ("
            "SELECT timestamp, value FROM complete_series "
            f"ORDER BY timestamp DESC NULLS LAST LIMIT {history_limit}"
            ") SELECT timestamp, value FROM recent_series ORDER BY timestamp ASC"
        )
    def _scatter_sql(
        self,
        x_column: str,
        y_column: str,
        where: str,
        bins: int,
        limit: int,
    ) -> str:
        x_quoted = _identifier(x_column)
        y_quoted = _identifier(y_column)
        bounded_where = self._with_predicate(
            where,
            f"TRY_CAST({x_quoted} AS DOUBLE) IS NOT NULL "
            f"AND TRY_CAST({y_quoted} AS DOUBLE) IS NOT NULL",
        )
        return (
            "WITH numeric_values AS ("
            f"SELECT TRY_CAST({x_quoted} AS DOUBLE) AS x_value, "
            f"TRY_CAST({y_quoted} AS DOUBLE) AS y_value FROM source{bounded_where}"
            "), bounds AS ("
            "SELECT MIN(x_value) AS min_x, MAX(x_value) AS max_x, "
            "MIN(y_value) AS min_y, MAX(y_value) AS max_y FROM numeric_values"
            "), binned AS ("
            "SELECT x_value, y_value, "
            "CASE WHEN max_x = min_x THEN 0 ELSE "
            f"LEAST({bins - 1}, GREATEST(0, FLOOR((x_value - min_x) "
            f"/ NULLIF(max_x - min_x, 0) * {bins}))) END AS x_bin, "
            "CASE WHEN max_y = min_y THEN 0 ELSE "
            f"LEAST({bins - 1}, GREATEST(0, FLOOR((y_value - min_y) "
            f"/ NULLIF(max_y - min_y, 0) * {bins}))) END AS y_bin "
            "FROM numeric_values CROSS JOIN bounds"
            ") SELECT AVG(x_value) AS x, AVG(y_value) AS y, "
            "COUNT(*) AS value, CAST(x_bin AS INTEGER) AS x_bin, "
            "CAST(y_bin AS INTEGER) AS y_bin FROM binned "
            "GROUP BY x_bin, y_bin ORDER BY value DESC "
            f"LIMIT {limit}"
        )

    def _box_sql(
        self,
        column: str,
        dimensions: list[str],
        where: str,
        sort: str,
        limit: int,
    ) -> str:
        quoted = _identifier(column)
        bounded_where = self._with_predicate(
            where, f"TRY_CAST({quoted} AS DOUBLE) IS NOT NULL"
        )
        dimension = _identifier(dimensions[0]) if dimensions else None
        dimension_select = f"{dimension} AS group_label, " if dimension else ""
        group = " GROUP BY group_label" if dimension else ""
        order = f" ORDER BY value {sort} NULLS LAST" if dimension else ""
        return (
            f"SELECT {dimension_select}MIN(TRY_CAST({quoted} AS DOUBLE)) AS min, "
            f"QUANTILE_CONT(TRY_CAST({quoted} AS DOUBLE), 0.25) AS q1, "
            f"MEDIAN(TRY_CAST({quoted} AS DOUBLE)) AS median, "
            f"QUANTILE_CONT(TRY_CAST({quoted} AS DOUBLE), 0.75) AS q3, "
            f"MAX(TRY_CAST({quoted} AS DOUBLE)) AS max, "
            f"MEDIAN(TRY_CAST({quoted} AS DOUBLE)) AS value, COUNT(*) AS count "
            f"FROM source{bounded_where}{group}{order} LIMIT {limit}"
        )

    @staticmethod
    def _missing_heatmap_sql(columns: list[str]) -> str:
        cells: list[str] = []
        for left in columns:
            for right in columns:
                left_identifier = _identifier(left)
                right_identifier = _identifier(right)
                left_label = left.replace("'", "''")
                right_label = right.replace("'", "''")
                cells.append(
                    f"SELECT '{left_label}' AS x, '{right_label}' AS y, "
                    f"AVG(CASE WHEN {left_identifier} IS NULL AND "
                    f"{right_identifier} IS NULL THEN 100.0 ELSE 0.0 END) AS value "
                    "FROM source"
                )
        return " UNION ALL ".join(cells)

    def _violin_sql(
        self,
        column: str,
        dimensions: list[str],
        where: str,
        bins: int,
        group_limit: int,
    ) -> str:
        quoted = _identifier(column)
        bounded_where = self._with_predicate(
            where, f"TRY_CAST({quoted} AS DOUBLE) IS NOT NULL"
        )
        group_expression = (
            f"COALESCE(CAST({_identifier(dimensions[0])} AS VARCHAR), '(NULL)')"
            if dimensions
            else "'Tổng thể'"
        )
        return (
            "WITH numeric_values AS ("
            f"SELECT {group_expression} AS group_label, "
            f"TRY_CAST({quoted} AS DOUBLE) AS numeric_value FROM source{bounded_where}"
            "), top_groups AS ("
            "SELECT group_label, COUNT(*) AS group_count FROM numeric_values "
            f"GROUP BY group_label ORDER BY group_count DESC LIMIT {group_limit}"
            "), selected AS ("
            "SELECT n.group_label, n.numeric_value FROM numeric_values n "
            "JOIN top_groups g USING (group_label)"
            "), bounds AS ("
            "SELECT MIN(numeric_value) AS min_value, MAX(numeric_value) AS max_value "
            "FROM selected"
            "), binned AS ("
            "SELECT group_label, numeric_value, min_value, max_value, "
            "CASE WHEN max_value = min_value THEN 0 ELSE "
            f"LEAST({bins - 1}, GREATEST(0, FLOOR((numeric_value - min_value) "
            f"/ NULLIF(max_value - min_value, 0) * {bins}))) END AS bin_index "
            "FROM selected CROSS JOIN bounds"
            ") SELECT group_label, CAST(bin_index AS INTEGER) AS bin_index, "
            f"MIN(min_value + bin_index * (max_value - min_value) / {bins}) AS bin_start, "
            f"MAX(CASE WHEN max_value = min_value THEN max_value ELSE min_value + "
            f"(bin_index + 1) * (max_value - min_value) / {bins} END) AS bin_end, "
            "COUNT(*) AS value FROM binned GROUP BY group_label, bin_index "
            "ORDER BY group_label ASC, bin_index ASC"
        )

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
    analysis_kind = str(query.get("analysis_kind") or "aggregate")
    if analysis_kind == "histogram":
        return (
            f"Histogram {query.get('column')} with {int(query.get('bins', 12))} bins; "
            "returns aggregate bin counts only."
        )
    if analysis_kind == "scatter":
        return (
            f"Binned scatter density {query.get('x_column')} vs {query.get('y_column')} "
            f"with {int(query.get('bins', 12))} bins per axis; no raw points."
        )
    if analysis_kind == "box":
        dimensions = [str(item) for item in query.get("dimensions") or []]
        grouped = f" by {dimensions[0]}" if dimensions else ""
        return f"Box summary {query.get('column')}{grouped}; aggregate five-number summary."
    if analysis_kind == "heatmap":
        dimensions = [str(item) for item in query.get("dimensions") or []]
        return (
            f"Heatmap {query.get('aggregate')} {query.get('column') or 'rows'} by "
            f"{', '.join(dimensions)}; showing up to {int(query.get('limit', 100))} cells."
        )
    if analysis_kind == "missing_bar":
        return "Missing Value Bar from persisted null percentages; aggregate profile evidence only."
    if analysis_kind == "missing_heatmap":
        return "Missing Value Heatmap from pairwise co-missing percentages; no row-level pattern is returned."
    if analysis_kind == "correlation_heatmap":
        return "Correlation Heatmap from the persisted Pearson matrix; aggregate profile evidence only."
    if analysis_kind == "cardinality":
        return "Cardinality Chart from persisted distinct-count metrics; aggregate profile evidence only."
    if analysis_kind == "outlier":
        return "Outlier Chart from persisted outlier counts, normalized by profiled row count."
    if analysis_kind == "violin":
        return (
            f"Violin density summary for {query.get('column')} with "
            f"{int(query.get('bins', 12))} aggregate bins per group; no raw points."
        )
    if analysis_kind == "donut":
        return (
            f"Donut share using {query.get('aggregate')} {query.get('column') or 'rows'} "
            f"by {(query.get('dimensions') or ['group'])[0]}; limited to low-cardinality groups."
        )
    if analysis_kind == "forecast":
        return (
            f"Forecast {query.get('aggregate')} {query.get('column') or 'rows'} by "
            f"{(query.get('dimensions') or ['time'])[0]} ({query.get('time_grain')}) "
            f"using {query.get('forecast_algorithm')} for "
            f"{int(query.get('forecast_horizon', 12))} future period(s)."
        )
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
    time_grain = query.get("time_grain")
    grain = f" ({time_grain})" if time_grain else ""
    filters = query.get("filters") or []
    filtered = f" with {len(filters)} filter(s)" if filters else ""
    limit = int(query.get("limit", 100))
    return f"{aggregate}{metric}{grouped}{grain}{filtered}; showing up to {limit} group(s)."
