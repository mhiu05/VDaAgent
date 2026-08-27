"""Model Context Protocol (MCP) Server for the VDaAgent Tri-Engine Platform.

Orchestrates bounded, privacy-safe analytics across three core engines:
1. Profiling & Compute Engine (DuckDB & Cloud Warehouse)
2. Business Context & Knowledge Base (Vector DB / Hybrid RAG)
3. Statistical & Predictive Algorithms (Anomaly Detection & 30+ Forecasting Models)

Guarantees Zero Raw Data Leakage, strict execution budgets, and evidence verification.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal
from uuid import uuid4

# pyrefly: ignore [missing-import]
from mcp.server.fastmcp import FastMCP
from src.agents.tools.registry import run_tool
from src.config import get_settings
from src.services.analysis_engine import AnalysisEngine, AnalysisQueryError
from src.services.analysis_repository import get_analysis_repository
from src.services.forecasting import (
    ForecastAlgorithm,
    available_forecast_algorithms,
    forecast_algorithm_catalog,
)
from src.services.permissions import (
    ANALYSIS_RUN,
    canonical_role,
    permissions_for_role,
)
from src.services.quality_gate import evaluate_quality_gate
from src.services.repository import get_repository, is_expired

ChartType = Literal[
    "bar", "line", "table", "kpi", "histogram", "scatter", "box", "heatmap",
    "missing_bar", "missing_heatmap", "correlation_heatmap", "cardinality",
    "violin", "donut", "outlier", "map"
]
Aggregation = Literal["count", "count_distinct", "sum", "mean", "median"]
TimeGrain = Literal["day", "week", "month", "quarter", "year"]
Renderer = Literal[
    "native-svg", "native-css", "native-html", "native-kpi", "native-grid"
]

DEFAULT_RENDERERS: dict[str, str] = {
    "line": "native-svg",
    "bar": "native-css",
    "table": "native-html",
    "kpi": "native-kpi",
    "histogram": "native-svg",
    "scatter": "native-svg",
    "box": "native-svg",
    "heatmap": "native-grid",
    "missing_bar": "native-css",
    "missing_heatmap": "native-grid",
    "correlation_heatmap": "native-grid",
    "cardinality": "native-css",
    "violin": "native-svg",
    "donut": "native-svg",
    "outlier": "native-css",
}

mcp = FastMCP(
    "P-170 Data Profiling",
    instructions=(
        "Use only bounded profile metadata, aggregate evidence, and chart "
        "specifications. Raw rows and PII values are never available. "
        "Every tool call requires an explicit profile_run_id."
    ),
    json_response=True,
)


def _call(
    tool_name: str, profile_run_id: str, args: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Dispatch through the same audited, read-only registry used by Agent."""
    return run_tool(tool_name, args or {}, profile_run_id=profile_run_id)


@mcp.tool()
def get_profile_overview(profile_run_id: str) -> dict[str, Any]:
    """Return safe overview metadata for one Profile Run."""
    return _call("get_profile_overview", profile_run_id)


@mcp.tool()
def list_profile_columns(
    profile_run_id: str,
    query: str = "",
    dtype: str = "",
    has_nulls: bool | None = None,
    has_outliers: bool | None = None,
    is_pii: bool | None = None,
    limit: int = 50,
    cursor: int = 0,
) -> dict[str, Any]:
    """List bounded column metadata without values or raw rows."""
    return _call(
        "list_columns",
        profile_run_id,
        {
            "query": query,
            "dtype": dtype,
            "has_nulls": has_nulls,
            "has_outliers": has_outliers,
            "is_pii": is_pii,
            "limit": max(1, min(limit, 50)),
            "cursor": max(0, cursor),
        },
    )


@mcp.tool()
def get_column_profile(
    profile_run_id: str,
    column_name: str,
    fields: list[str] | None = None,
) -> dict[str, Any]:
    """Return aggregate statistics for one column; PII values stay masked."""
    return _call(
        "get_column_profile",
        profile_run_id,
        {"column_name": column_name, "fields": fields},
    )


@mcp.tool()
def get_distribution(
    profile_run_id: str,
    column_name: str,
    limit: int = 20,
) -> dict[str, Any]:
    """Return persisted top-category distribution for a non-PII column."""
    return _call(
        "get_distribution",
        profile_run_id,
        {"column_name": column_name, "limit": max(1, min(limit, 50))},
    )


@mcp.tool()
def get_correlation(
    profile_run_id: str,
    column_a: str,
    column_b: str,
) -> dict[str, Any]:
    """Return persisted Pearson correlation for one numeric pair."""
    return _call(
        "get_correlation",
        profile_run_id,
        {"column_a": column_a, "column_b": column_b},
    )


@mcp.tool()
def get_profile_readiness(profile_run_id: str) -> dict[str, Any]:
    """Check whether a Profile Run is ready for evidence workflows."""
    return _call("get_profile_readiness", profile_run_id)


def _safe_column_names(
    profile_run_id: str,
) -> tuple[set[str], set[str], dict[str, Any] | None]:
    result = _call("list_columns", profile_run_id, {"limit": 50, "cursor": 0})
    if result.get("error_code"):
        return set(), set(), result
    rows = (result.get("data") or {}).get("columns") or []
    names = {str(row.get("column_name")) for row in rows}
    pii = {str(row.get("column_name")) for row in rows if row.get("is_pii")}
    return names, pii, None


@mcp.tool()
def build_chart_spec(
    profile_run_id: str,
    chart_type: ChartType,
    x_column: str | None = None,
    y_column: str | None = None,
    measure_column: str | None = None,
    aggregation: Aggregation = "count",
    time_grain: TimeGrain | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    renderer: Renderer | None = None,
    bins: int = 12,
    forecast_algorithm: ForecastAlgorithm | None = None,
    forecast_horizon: int = 12,
    season_length: int = 12,
    title: str = "",
) -> dict[str, Any]:
    """Create a validated, non-persisted ChartSpec from approved columns.

    This tool only proposes a chart specification. It does not execute a
    query, expose rows, or mark the result as Official evidence.
    """
    names, pii, failure = _safe_column_names(profile_run_id)
    if failure:
        return failure
    requested = [item for item in (x_column, y_column, measure_column) if item]
    unknown = [item for item in requested if item not in names]
    if unknown:
        return {
            "tool": "build_chart_spec",
            "profile_run_id": profile_run_id,
            "error_code": "invalid_argument",
            "error": f"Column is not available in the Profile Run: {', '.join(unknown)}.",
        }
    restricted = [item for item in requested if item in pii]
    if restricted:
        return {
            "tool": "build_chart_spec",
            "profile_run_id": profile_run_id,
            "error_code": "forbidden_scope",
            "error": "PII columns cannot be used in a chart specification.",
            "columns": restricted,
        }
    if forecast_algorithm:
        if chart_type != "line" or not x_column or not time_grain:
            return {
                "tool": "build_chart_spec",
                "profile_run_id": profile_run_id,
                "error_code": "invalid_argument",
                "error": "Forecast requires a line chart, x_column and time_grain.",
            }
        if forecast_algorithm not in available_forecast_algorithms():
            return {
                "tool": "build_chart_spec",
                "profile_run_id": profile_run_id,
                "error_code": "capability_unavailable",
                "error": "The requested forecast algorithm is not available in this deployment.",
            }
        if not 1 <= forecast_horizon <= 60 or not 2 <= season_length <= 365:
            return {
                "tool": "build_chart_spec",
                "profile_run_id": profile_run_id,
                "error_code": "invalid_argument",
                "error": "forecast_horizon or season_length is outside the bounded range.",
            }
    if (
        chart_type in {"bar", "line", "histogram", "scatter", "heatmap", "donut"}
        and not x_column
    ):
        return {
            "tool": "build_chart_spec",
            "profile_run_id": profile_run_id,
            "error_code": "invalid_argument",
            "error": f"{chart_type} requires x_column.",
        }
    if chart_type in {"scatter", "heatmap"} and not y_column:
        return {
            "tool": "build_chart_spec",
            "profile_run_id": profile_run_id,
            "error_code": "invalid_argument",
            "error": f"{chart_type} requires y_column.",
        }
    if chart_type == "scatter" and x_column == y_column:
        return {
            "tool": "build_chart_spec",
            "profile_run_id": profile_run_id,
            "error_code": "invalid_argument",
            "error": "scatter requires two different measures.",
        }
    if chart_type in {"box", "violin"} and not y_column:
        return {
            "tool": "build_chart_spec",
            "profile_run_id": profile_run_id,
            "error_code": "invalid_argument",
            "error": f"{chart_type} requires y_column as its measure.",
        }
    aggregate_measure = measure_column if chart_type == "heatmap" else y_column
    if (
        chart_type not in {"histogram", "scatter", "box", "violin", "missing_bar", "missing_heatmap", "correlation_heatmap", "cardinality", "outlier"}
        and aggregation != "count"
        and not aggregate_measure
    ):
        return {
            "tool": "build_chart_spec",
            "profile_run_id": profile_run_id,
            "error_code": "invalid_argument",
            "error": "This aggregation requires a measure column.",
        }
    if not 5 <= bins <= 30:
        return {
            "tool": "build_chart_spec",
            "profile_run_id": profile_run_id,
            "error_code": "invalid_argument",
            "error": "bins must be between 5 and 30.",
        }
    if time_grain and chart_type != "line":
        return {
            "tool": "build_chart_spec",
            "profile_run_id": profile_run_id,
            "error_code": "invalid_argument",
            "error": "time_grain is supported only for line charts.",
        }
    if (date_from or date_to) and (chart_type != "line" or not x_column):
        return {
            "tool": "build_chart_spec",
            "profile_run_id": profile_run_id,
            "error_code": "invalid_argument",
            "error": "Date bounds require a line chart with x_column.",
        }
    try:
        parsed_from = date.fromisoformat(date_from) if date_from else None
        parsed_to = date.fromisoformat(date_to) if date_to else None
    except ValueError:
        return {
            "tool": "build_chart_spec",
            "profile_run_id": profile_run_id,
            "error_code": "invalid_argument",
            "error": "date_from and date_to must use YYYY-MM-DD.",
        }
    if parsed_from and parsed_to and parsed_from > parsed_to:
        return {
            "tool": "build_chart_spec",
            "profile_run_id": profile_run_id,
            "error_code": "invalid_argument",
            "error": "date_from must not be after date_to.",
        }
    selected_renderer = renderer or DEFAULT_RENDERERS[chart_type]
    if selected_renderer != DEFAULT_RENDERERS[chart_type]:
        return {
            "tool": "build_chart_spec",
            "profile_run_id": profile_run_id,
            "error_code": "invalid_argument",
            "error": "renderer is not compatible with chart_type.",
        }
    return {
        "tool": "build_chart_spec",
        "profile_run_id": profile_run_id,
        "status": "draft",
        "chart_spec": {
            "chart_type": chart_type,
            "renderer": selected_renderer,
            "analysis_kind": "forecast"
            if forecast_algorithm
            else chart_type
            if chart_type in {"histogram", "scatter", "box", "heatmap", "missing_bar", "missing_heatmap", "correlation_heatmap", "cardinality", "violin", "donut", "outlier"}
            else "aggregate",
            "x": x_column,
            "y": y_column,
            "measure": measure_column,
            "aggregation": aggregation,
            "time_grain": time_grain,
            "date_from": date_from,
            "date_to": date_to,
            "bins": bins if chart_type in {"histogram", "scatter", "violin"} else None,
            "forecast_algorithm": forecast_algorithm,
            "forecast_horizon": forecast_horizon if forecast_algorithm else None,
            "season_length": season_length if forecast_algorithm else None,
            "title": title.strip()[:160] or "Biểu đồ từ Profile Run",
        },
        "limitations": [
            "ChartSpec mới chỉ là đề xuất; cần chạy Preview rồi xác nhận Official.",
            "Không có raw rows hoặc giá trị PII trong response.",
        ],
    }


@mcp.tool()
def build_chart_plan(
    profile_run_id: str,
    charts: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build a bounded multi-chart plan for one Profile Run.

    Each item in ``charts`` must contain ``chart_type`` and may contain
    ``x_column``, ``y_column``, ``aggregation`` and ``title``. This creates
    draft specifications only; it does not execute queries or expose rows.
    A plan is capped at 12 charts so one Agent request cannot fan out without
    a bounded limit.
    """
    if not charts:
        return {
            "tool": "build_chart_plan",
            "profile_run_id": profile_run_id,
            "error_code": "invalid_argument",
            "error": "charts must contain at least one chart request.",
        }
    if len(charts) > 12:
        return {
            "tool": "build_chart_plan",
            "profile_run_id": profile_run_id,
            "error_code": "limit_exceeded",
            "error": "A chart plan can contain at most 12 charts.",
        }

    chart_specs: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    for index, request in enumerate(charts):
        if not isinstance(request, dict):
            errors.append({"index": index, "error": "Chart request must be an object."})
            continue
        chart_type = request.get("chart_type")
        aggregation = request.get("aggregation", "count")
        time_grain = request.get("time_grain")
        renderer = request.get("renderer")
        if chart_type not in {
            "bar",
            "line",
            "table",
            "kpi",
            "histogram",
            "scatter",
            "box",
            "heatmap",
        }:
            errors.append({"index": index, "error": "Unsupported chart_type."})
            continue
        if aggregation not in {"count", "count_distinct", "sum", "mean", "median"}:
            errors.append({"index": index, "error": "Unsupported aggregation."})
            continue
        if time_grain not in {None, "day", "week", "month", "quarter", "year"}:
            errors.append({"index": index, "error": "Unsupported time_grain."})
            continue
        if renderer not in {
            None,
            "native-svg",
            "native-css",
            "native-html",
            "native-kpi",
            "native-grid",
        }:
            errors.append({"index": index, "error": "Unsupported renderer."})
            continue
        result = build_chart_spec(
            profile_run_id=profile_run_id,
            chart_type=chart_type,
            x_column=request.get("x_column"),
            y_column=request.get("y_column"),
            measure_column=request.get("measure_column"),
            aggregation=aggregation,
            time_grain=time_grain,
            date_from=request.get("date_from"),
            date_to=request.get("date_to"),
            renderer=renderer,
            bins=int(request.get("bins", 12)),
            forecast_algorithm=request.get("forecast_algorithm"),
            forecast_horizon=int(request.get("forecast_horizon", 12)),
            season_length=int(request.get("season_length", 12)),
            title=str(request.get("title", "")),
        )
        if result.get("error_code"):
            errors.append(
                {"index": index, "error": result.get("error"), "detail": result}
            )
        else:
            spec = dict(result["chart_spec"])
            spec["position"] = index
            chart_specs.append(spec)

    return {
        "tool": "build_chart_plan",
        "profile_run_id": profile_run_id,
        "status": "draft" if chart_specs else "failed",
        "chart_count": len(chart_specs),
        "chart_specs": chart_specs,
        "errors": errors,
        "limitations": [
            "The plan contains draft ChartSpecs only; execute each chart through bounded Preview/Official workflows.",
            "A chart failure does not invalidate the other valid chart specifications.",
            "No raw rows or PII values are returned.",
        ],
    }


def _execution_scope(
    profile_run_id: str,
    workspace_id: str,
    actor_user_id: str,
) -> tuple[Any | None, dict[str, Any] | None]:
    """Authorize an MCP execution against the same workspace boundary as HTTP."""
    if not get_settings().ux_command_center_enabled:
        return None, {
            "error_code": "feature_disabled",
            "error": "The bounded analysis workspace is disabled.",
        }
    repository = get_repository()
    membership = repository.get_membership(workspace_id, actor_user_id)
    role = canonical_role(str((membership or {}).get("role", "")))
    if (
        not membership
        or membership.get("status") != "active"
        or ANALYSIS_RUN not in permissions_for_role(role)
    ):
        return None, {
            "error_code": "forbidden_scope",
            "error": "The actor is not authorized to run analysis in this workspace.",
        }
    run = repository.get_profile_run(profile_run_id, workspace_id=workspace_id)
    if not run:
        return None, {
            "error_code": "not_found",
            "error": "Profile Run was not found in this workspace.",
        }
    if run.get("status") != "completed":
        return None, {
            "error_code": "profile_not_ready",
            "error": "Profile Run must be completed before chart execution.",
        }
    return repository, None


def _quick_context(profile_run_id: str, repository: Any) -> dict[str, Any]:
    stats = repository.get_column_stats(profile_run_id)
    restricted = repository.confirmed_pii_columns(profile_run_id)
    dimensions: list[str] = []
    measures: list[str] = []
    for name, stat in stats.items():
        if name in restricted:
            continue
        if stat.get("mean") is not None or str(stat.get("dtype", "")).lower() in {
            "int",
            "float",
            "double",
            "bigint",
            "integer",
        }:
            measures.append(name)
        else:
            dimensions.append(name)
    return {
        "row_grain": "One source row",
        "entity": None,
        "keys": [],
        "time_column": None,
        "timezone": None,
        "dimensions": dimensions[:100],
        "measures": measures[:100],
        "ignored_columns": sorted(restricted),
        "limitations": [],
    }


def _ensure_execution_session(
    profile_run_id: str,
    workspace_id: str,
    actor_user_id: str,
    repository: Any,
) -> tuple[Any, Any]:
    analyses = get_analysis_repository()
    session = next(
        (
            item
            for item in analyses.list_sessions(
                profile_run_id, workspace_id=workspace_id
            )
            if item.get("creator") == actor_user_id and item.get("mode") == "quick"
        ),
        None,
    )
    if not session:
        session = analyses.create_session(
            {
                "mode": "quick",
                "goal": "Generate bounded chart evidence",
                "output": "chart",
            },
            profile_run_id=profile_run_id,
            creator=actor_user_id,
            workspace_id=workspace_id,
        )
    session = analyses.get_session(session["id"], workspace_id=workspace_id) or session
    if not session.get("context"):
        analyses.add_context(session["id"], _quick_context(profile_run_id, repository))
        session = (
            analyses.get_session(session["id"], workspace_id=workspace_id) or session
        )
    return analyses, session


def _query_from_chart_spec(spec: dict[str, Any], *, limit: int) -> dict[str, Any]:
    chart_type = str(spec.get("chart_type"))
    x_column = spec.get("x")
    y_column = spec.get("y")
    if chart_type in {"missing_bar", "missing_heatmap", "correlation_heatmap", "cardinality", "outlier"}:
        dimensions = []
    elif chart_type == "heatmap":
        dimensions = [str(x_column), str(y_column)]
    elif chart_type == "box":
        dimensions = [str(x_column)] if x_column else []
    else:
        dimensions = (
            [str(x_column)]
            if x_column and chart_type not in {"kpi", "histogram", "scatter"}
            else []
        )
    filters: list[dict[str, Any]] = []
    if x_column and spec.get("date_from"):
        filters.append(
            {"column": str(x_column), "operator": "gte", "value": spec["date_from"]}
        )
    if x_column and spec.get("date_to"):
        exclusive_end = (
            (datetime.fromisoformat(str(spec["date_to"])) + timedelta(days=1))
            .date()
            .isoformat()
        )
        filters.append(
            {"column": str(x_column), "operator": "lt", "value": exclusive_end}
        )
    return {
        "analysis_kind": spec.get("analysis_kind", "aggregate"),
        "aggregate": str(spec.get("aggregation", "count")),
        "column": (
            x_column
            if chart_type == "histogram"
            else y_column
            if chart_type == "box"
            else spec.get("measure")
            if chart_type == "heatmap"
            else y_column
        ),
        "x_column": x_column if chart_type == "scatter" else None,
        "y_column": y_column if chart_type == "scatter" else None,
        "dimensions": dimensions,
        "filters": filters,
        "limit": limit,
        "sort": "asc" if chart_type == "line" else "desc",
        "time_grain": spec.get("time_grain"),
        "bins": int(spec.get("bins") or 12),
        "forecast_algorithm": spec.get("forecast_algorithm"),
        "forecast_horizon": int(spec.get("forecast_horizon") or 12),
        "season_length": int(spec.get("season_length") or 12),
        "confidence_level": 0.95,
        "history_limit": 500,
    }


@mcp.tool()
def list_forecast_algorithms() -> dict[str, Any]:
    """List forecast models and deployment availability without loading them."""

    return {"tool": "list_forecast_algorithms", "algorithms": forecast_algorithm_catalog()}


def _execute_chart(
    *,
    profile_run_id: str,
    workspace_id: str,
    context: dict[str, Any],
    query: dict[str, Any],
    execution_kind: Literal["preview", "official"],
) -> dict[str, Any]:
    return AnalysisEngine(get_repository()).execute(
        profile_run_id=profile_run_id,
        workspace_id=workspace_id,
        context=context,
        query=query,
        execution_kind=execution_kind,
        preview_row_budget=get_settings().ux_preview_row_budget,
    )


@mcp.tool()
def preview_chart_plan(
    profile_run_id: str,
    workspace_id: str,
    actor_user_id: str,
    charts: list[dict[str, Any]],
    request_id: str = "",
) -> dict[str, Any]:
    """Execute every valid chart in a plan as bounded Preview evidence."""
    repository, failure = _execution_scope(profile_run_id, workspace_id, actor_user_id)
    if failure:
        return {
            "tool": "preview_chart_plan",
            "profile_run_id": profile_run_id,
            **failure,
        }
    plan = build_chart_plan(profile_run_id, charts)
    if plan.get("error_code"):
        return plan
    analyses, session = _ensure_execution_session(
        profile_run_id, workspace_id, actor_user_id, repository
    )
    context = session["context"]
    plan_id = request_id.strip()[:120] or uuid4().hex
    executions: list[dict[str, Any]] = []
    errors = list(plan.get("errors") or [])
    for spec in plan["chart_specs"]:
        index = int(spec["position"])
        query = _query_from_chart_spec(
            spec, limit=get_settings().ux_preview_result_limit
        )
        try:
            output = _execute_chart(
                profile_run_id=profile_run_id,
                workspace_id=workspace_id,
                context=context["context"],
                query=query,
                execution_kind="preview",
            )
            execution = analyses.save_execution(
                session["id"],
                context["id"],
                output["canonical_query"],
                output["result"],
                output["result_hash"],
                approximate=True,
                limitations=output["limitations"],
                duration_ms=output["duration_ms"],
                execution_kind="preview",
                requested_by_user_id=actor_user_id,
                expires_at=datetime.now(UTC) + timedelta(hours=1),
                idempotency_key=f"mcp:{plan_id}:{index}:preview",
            )
            executions.append(
                {"position": index, "chart_spec": spec, "execution": execution}
            )
        except (AnalysisQueryError, ValueError) as exc:
            errors.append({"index": index, "error": str(exc)})
    return {
        "tool": "preview_chart_plan",
        "profile_run_id": profile_run_id,
        "status": "preview_ready" if executions else "failed",
        "session_id": session["id"],
        "context_version_id": context["id"],
        "plan_id": plan_id,
        "executions": executions,
        "errors": errors,
        "limitations": [
            "Mỗi chart được chạy độc lập; chart lỗi không làm mất Preview hợp lệ khác.",
            "Preview vẫn dùng sample bounded và phải được promote trước khi ghim vào báo cáo.",
        ],
    }


@mcp.tool()
def promote_chart_plan(
    profile_run_id: str,
    workspace_id: str,
    actor_user_id: str,
    preview_execution_ids: list[str],
    expected_context_version_id: str,
) -> dict[str, Any]:
    """Promote selected Preview executions into Official evidence independently."""
    repository, failure = _execution_scope(profile_run_id, workspace_id, actor_user_id)
    if failure:
        return {
            "tool": "promote_chart_plan",
            "profile_run_id": profile_run_id,
            **failure,
        }
    if not preview_execution_ids or len(preview_execution_ids) > 12:
        return {
            "tool": "promote_chart_plan",
            "profile_run_id": profile_run_id,
            "error_code": "invalid_argument",
            "error": "preview_execution_ids must contain 1 to 12 items.",
        }
    analyses = get_analysis_repository()
    executions: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    session_id: str | None = None
    session: dict[str, Any] | None = None
    context: dict[str, Any] | None = None
    gate: dict[str, Any] | None = None
    for index, preview_id in enumerate(preview_execution_ids):
        preview = analyses.get_execution(preview_id, workspace_id=workspace_id)
        if not preview or preview.get("execution_kind") != "preview":
            errors.append(
                {
                    "index": index,
                    "preview_execution_id": preview_id,
                    "error": "Preview not found.",
                }
            )
            continue
        current_session_id = str(preview["session_id"])
        if session_id is None:
            session_id = current_session_id
            session = analyses.get_session(session_id, workspace_id=workspace_id)
            context = (session or {}).get("context")
        if current_session_id != session_id or not session or not context:
            errors.append(
                {
                    "index": index,
                    "preview_execution_id": preview_id,
                    "error": "Preview executions must belong to one analysis session.",
                }
            )
            continue
        source = session.get("source") or {}
        if source.get("profile_run_id") != profile_run_id:
            errors.append(
                {
                    "index": index,
                    "preview_execution_id": preview_id,
                    "error": "Preview does not belong to this Profile Run.",
                }
            )
            continue
        if is_expired(preview.get("expires_at")):
            errors.append(
                {
                    "index": index,
                    "preview_execution_id": preview_id,
                    "error": "Preview has expired.",
                }
            )
            continue
        if (
            context["id"] != preview.get("context_version_id")
            or context["id"] != expected_context_version_id
        ):
            errors.append(
                {
                    "index": index,
                    "preview_execution_id": preview_id,
                    "error": "Analysis context is stale.",
                }
            )
            continue
        try:
            if context.get("status") != "approved":
                analyses.approve_context(session_id, context["id"], actor_user_id)
                session = (
                    analyses.get_session(session_id, workspace_id=workspace_id)
                    or session
                )
                context = session.get("context")
            if not context:
                raise AnalysisQueryError("Analysis context is unavailable.")
            if not gate or gate.get("context_version_id") != context["id"]:
                decision, issues = evaluate_quality_gate(
                    repository,
                    profile_run_id,
                    context["context"],
                    workspace_id=workspace_id,
                )
                gate = analyses.save_gate(session_id, context["id"], decision, issues)
            if gate["decision"] == "blocked":
                errors.append(
                    {
                        "index": index,
                        "preview_execution_id": preview_id,
                        "error": "Quality gate blocked Official execution.",
                        "issues": gate.get("issues", []),
                    }
                )
                continue
            output = _execute_chart(
                profile_run_id=profile_run_id,
                workspace_id=workspace_id,
                context=context["context"],
                query=preview["query_spec"],
                execution_kind="official",
            )
            execution = analyses.save_execution(
                session_id,
                context["id"],
                output["canonical_query"],
                output["result"],
                output["result_hash"],
                approximate=False,
                limitations=output["limitations"],
                duration_ms=output["duration_ms"],
                execution_kind="official",
                quality_gate_run_id=gate["id"],
                requested_by_user_id=actor_user_id,
                idempotency_key=f"mcp:{preview_id}:official",
            )
            executions.append({"position": index, "execution": execution})
        except (AnalysisQueryError, ValueError) as exc:
            errors.append(
                {"index": index, "preview_execution_id": preview_id, "error": str(exc)}
            )
    return {
        "tool": "promote_chart_plan",
        "profile_run_id": profile_run_id,
        "status": "official_ready" if executions else "failed",
        "session_id": session_id,
        "executions": executions,
        "errors": errors,
        "limitations": [
            "Chỉ Official result mới đủ điều kiện ghim vào Report Draft.",
            "Mỗi chart được promote độc lập trong cùng quality gate/context.",
        ],
    }


def main() -> None:
    """Run the local MCP server over stdio."""
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
