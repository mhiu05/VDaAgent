"""Safe chart planning from profile metadata and optional user intent.

The LLM may propose semantic choices, but this module owns every executable
field. It never accepts SQL or an arbitrary operation from the model.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import date, datetime
from typing import Any, Literal

# pyrefly: ignore [missing-import]
from pydantic import BaseModel, Field
from src.services.forecasting import (
    CAPABILITIES,
    ForecastAlgorithm,
    available_forecast_algorithms,
)

ProblemType = Literal[
    "compare", "trend", "ranking", "summary", "distribution", "relationship",
    "quality", "forecast", "composition", "geographic", "multi_dimensional"
]
AnalysisMethod = Literal[
    "count",
    "count_distinct",
    "sum",
    "mean",
    "median",
    "histogram",
    "box",
    "scatter",
    "heatmap",
    "missing_bar",
    "missing_heatmap",
    "correlation_heatmap",
    "cardinality",
    "violin",
    "donut",
    "outlier",
] | ForecastAlgorithm
ChartType = Literal[
    "line", "bar", "table", "kpi", "histogram", "scatter", "box", "heatmap",
    "missing_bar", "missing_heatmap", "correlation_heatmap", "cardinality",
    "violin", "donut", "outlier", "map"
]


class ChartPlanCandidate(BaseModel):
    """Non-executable semantic proposal returned by the model."""

    problem: ProblemType
    algorithm: AnalysisMethod
    x_column: str | None = Field(default=None, max_length=255)
    y_column: str | None = Field(default=None, max_length=255)
    second_dimension: str | None = Field(default=None, max_length=255)
    time_grain: Literal["day", "week", "month", "quarter", "year"] | None = None
    forecast_horizon: int = Field(default=12, ge=1, le=60)
    season_length: int = Field(default=12, ge=2, le=365)
    title: str = Field(min_length=3, max_length=255)
    rationale: str = Field(min_length=3, max_length=1000)


PROBLEM_ALGORITHMS: dict[str, set[str]] = {
    "compare": {"count", "sum", "mean", "median", "donut"},
    "trend": {"count", "sum", "mean", "median"},
    "ranking": {"count", "sum", "mean"},
    "summary": {"count", "count_distinct", "sum", "mean", "median"},
    "distribution": {"histogram", "box", "violin", "outlier"},
    "relationship": {"scatter", "heatmap", "correlation_heatmap"},
    "quality": {"missing_bar", "missing_heatmap", "cardinality", "outlier"},
    "forecast": {item.id for item in CAPABILITIES},
    "composition": {"count", "sum", "donut"},
    "geographic": {"count", "sum", "mean"},
    "multi_dimensional": {"scatter", "heatmap"},
}
CHART_FOR_PROBLEM = {
    "compare": "bar",
    "trend": "line",
    "ranking": "bar",
    "summary": "kpi",
    "distribution": "histogram",
    "relationship": "scatter",
    "quality": "missing_bar",
    "forecast": "line",
    "composition": "donut",
    "geographic": "bar",
    "multi_dimensional": "scatter",
}
RENDERER_FOR_CHART = {
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


def _plain(value: str) -> str:
    value = unicodedata.normalize("NFD", value.casefold())
    value = "".join(char for char in value if unicodedata.category(char) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


def _mentions(text: str, phrases: tuple[str, ...]) -> bool:
    return any(phrase in text for phrase in phrases)


COLUMN_SYNONYMS: dict[str, tuple[str, ...]] = {
    "gia": ("price", "cost", "amount", "salary", "fee", "rate", "revenue", "val", "spend"),
    "price": ("price", "cost", "amount", "fee"),
    "so luong": ("quantity", "qty", "volume", "count", "num", "units", "sl"),
    "quantity": ("quantity", "qty", "volume", "count", "num"),
    "danh muc": ("category", "cat", "type", "genre", "group", "class", "industry", "sector"),
    "nganh": ("industry", "sector", "category", "field", "domain"),
    "kho": ("warehouse", "store", "location", "facility", "site", "depot"),
    "vi tri": ("location", "aisle", "shelf", "bin", "site", "place"),
    "nha cung cap": ("supplier", "vendor", "provider", "distributor"),
    "trang thai": ("status", "state", "condition", "stage"),
    "danh gia": ("rating", "score", "rank", "diem", "eval"),
    "san pham": ("product", "item", "goods", "sku", "title", "name"),
    "ngay": ("date", "time", "restocked", "created", "updated", "timestamp", "year"),
}


def _best_column(question: str, columns: list[str], preferred: tuple[str, ...] = ()) -> str | None:
    if not columns:
        return None
    intent = _plain(question)
    directly_named = [column for column in columns if _plain(column) in intent]
    if directly_named:
        return directly_named[0]
    for key, tokens in COLUMN_SYNONYMS.items():
        if key in intent:
            for token in tokens:
                for column in columns:
                    if token in _plain(column):
                        return column
    for token in preferred:
        for column in columns:
            if token in _plain(column):
                return column
    return columns[0]


def _best_dimension(question: str, dimensions: list[str]) -> str | None:
    if not dimensions:
        return None
    text = _plain(question)
    match = re.search(r"(?:theo|theo tung|theo cac|giua cac|giua|theo moi|theo nhom|cac|tung)\s+([^,.;]+)", text)
    if match:
        target = match.group(1)
        found = _best_column(target, dimensions)
        if found:
            return found
    return _best_column(question, dimensions)


def _time_columns(context: dict[str, Any], column_stats: dict[str, Any]) -> list[str]:
    dimensions = list(context.get("dimensions") or [])
    result: list[str] = []
    configured = context.get("time_column")
    if configured in dimensions:
        result.append(str(configured))
    for name in dimensions:
        dtype = str((column_stats.get(name) or {}).get("dtype", "")).casefold()
        normalized = _plain(name)
        if (
            any(token in dtype for token in ("date", "time", "datetime"))
            or any(token in normalized for token in ("date", "time", "month", "year", "ngay", "thang", "nam"))
        ) and name not in result:
            result.append(name)
    return result


def sanitize_chart_context(
    context: dict[str, Any], column_stats: dict[str, Any]
) -> dict[str, Any]:
    """Remove restricted columns before any model proposal is normalized.

    Context is user/analyst supplied state and therefore a proposal, not a
    privacy boundary.  PII markers from persisted stats and explicit
    ``ignored_columns`` are both fail-closed; all executable planner fields
    are subsequently derived from this sanitized copy.
    """

    restricted = {
        str(item)
        for item in (context.get("ignored_columns") or [])
        if item
    }
    for name, stat in column_stats.items():
        if not isinstance(stat, dict):
            continue
        if any(
            bool(stat.get(marker))
            for marker in ("is_pii", "pii", "pii_masked", "restricted")
        ):
            restricted.add(str(name))
    restricted_fold = {item.casefold() for item in restricted}

    result = dict(context)
    for field in ("dimensions", "measures", "keys"):
        result[field] = [
            str(item)
            for item in (context.get(field) or [])
            if str(item).casefold() not in restricted_fold
        ]
    time_column = context.get("time_column")
    result["time_column"] = (
        str(time_column)
        if time_column and str(time_column).casefold() not in restricted_fold
        else None
    )
    result["ignored_columns"] = sorted(
        {*(context.get("ignored_columns") or []), *restricted}
    )
    return result


def can_plan_deterministically(
    question: str, context: dict[str, Any], column_stats: dict[str, Any]
) -> bool:
    """Whether a bounded rules planner fully covers an explicit chart intent.

    This is deliberately conservative. It does not infer an ambiguous business
    objective; it only skips the model when the question selects an existing
    safe planner family and the profile provides the fields that family needs.
    ``build_chart_plan`` remains the executable allow-list boundary either way.
    """

    safe_context = sanitize_chart_context(context, column_stats)
    text = _plain(question)
    if not text:
        return False
    dimensions = [str(item) for item in safe_context.get("dimensions") or []]
    measures = [str(item) for item in safe_context.get("measures") or []]
    time_columns = _time_columns(safe_context, column_stats)
    restricted = [str(item) for item in safe_context.get("ignored_columns") or []]
    # A request for a prohibited column must use the deterministic safe
    # fallback, never give that column another opportunity to influence a
    # semantic model proposal.
    if any(_plain(column) and _plain(column) in text for column in restricted):
        return True

    named_measures = [column for column in measures if _plain(column) in text]
    named_dimensions = [column for column in dimensions if _plain(column) in text]
    has_time_intent = bool(
        time_columns
        and _mentions(
            text,
            ("trend", "xu huong", "theo thang", "theo nam", "monthly", "yearly", "over time"),
        )
    )
    if _mentions(text, ("forecast", "du bao")):
        return bool(time_columns and measures)
    if _mentions(text, ("missing", "null", "cardinality", "outlier")):
        return bool(dimensions or measures)
    if _mentions(text, ("histogram", "box plot", "boxplot", "violin", "phan phoi")):
        return bool(measures)
    if _mentions(text, ("correlation", "tuong quan", "moi quan he", "scatter")):
        return len(measures) >= 2 and len(named_measures) >= 2
    if has_time_intent:
        return bool(measures)
    if _mentions(text, ("ranking", "cao nhat", "thap nhat", "top ", "so sanh", "compare")):
        return bool(dimensions and measures and (named_dimensions or named_measures))
    if _mentions(text, ("donut", "pie", "ty trong", "phan tram", "breakdown")):
        return bool(dimensions)
    return False


def _shift_month(year: int, month: int, offset: int) -> tuple[int, int]:
    absolute = year * 12 + (month - 1) + offset
    return absolute // 12, absolute % 12 + 1


def _relative_time_filters(
    question: str, time_column: str | None, column_stats: dict[str, Any]
) -> list[dict[str, Any]]:
    """Resolve bounded month/year windows against the profiled maximum date."""

    if not time_column:
        return []
    text = _plain(question)
    match = re.search(r"\b(\d{1,3})\s*(thang|month|months|nam|year|years)\b", text)
    if not match:
        return []
    amount = int(match.group(1))
    if amount < 1:
        return []
    months = amount * 12 if match.group(2) in {"nam", "year", "years"} else amount
    months = min(months, 120)
    maximum = (column_stats.get(time_column) or {}).get("max")
    if maximum is None:
        return []
    try:
        if isinstance(maximum, datetime):
            end_date = maximum.date()
        elif isinstance(maximum, date):
            end_date = maximum
        else:
            end_date = datetime.fromisoformat(str(maximum).replace("Z", "+00:00")).date()
    except (TypeError, ValueError):
        return []
    start_year, start_month = _shift_month(end_date.year, end_date.month, -(months - 1))
    next_year, next_month = _shift_month(end_date.year, end_date.month, 1)
    return [
        {"column": time_column, "operator": "gte", "value": date(start_year, start_month, 1).isoformat()},
        {"column": time_column, "operator": "lt", "value": date(next_year, next_month, 1).isoformat()},
    ]


def _fallback_candidate(
    question: str, context: dict[str, Any], column_stats: dict[str, Any]
) -> ChartPlanCandidate:
    """Deterministic heuristic when LLM planner is unavailable or unhelpful."""

    text = _plain(question)
    dimensions = list(context.get("dimensions") or [])
    measures = list(context.get("measures") or [])
    times = _time_columns(context, column_stats)

    explicit_forecast = (
        "du bao", "forecast", "predict", "tien doan",
        "neuralprophet", "prophet", "auto arima", "sarimax", "sarima",
        "arimax", "arima", "holt winters", "holt", "ets",
        "moving average", "trung binh truot", "seasonal naive", "naive",
        "random forest", "xgboost", "lightgbm", "catboost",
    )
    if times and _mentions(text, explicit_forecast):
        problem: ProblemType = "forecast"
    elif times and _mentions(text, ("thang", "quy", "nam", "ngay", "xu huong", "thay doi", "trend", "over time")):
        problem: ProblemType = "trend"
    elif _mentions(text, ("missing", "null", "thieu du lieu", "du lieu thieu", "cardinality", "unique", "trung lap", "outlier chart", "ty le outlier", "outlier theo cot", "missing_bar", "missing_heatmap")):
        problem = "quality"
    elif _mentions(text, ("phan phoi", "histogram", "tan suat", "box plot", "violin", "outlier", "ngoai le", "boxplot")):
        problem = "distribution"
    elif _mentions(text, ("tuong quan", "moi quan he", "relationship", "correlation", "scatter", "heatmap")):
        problem = "relationship"
    elif _mentions(text, ("top ", "cao nhat", "thap nhat", "xep hang", "ranking", "bar chart", "bieu do cot", "cot")):
        problem = "ranking"
    elif not dimensions or _mentions(text, ("tong cong", "kpi", "toan bo", "kpi card")):
        problem = "summary"
    else:
        problem = "compare"

    measure = _best_column(
        question,
        measures,
        ("price", "revenue", "sales", "amount", "total", "doanh thu", "doanh so", "value", "rating", "cost", "salary"),
    )
    if not measure and _mentions(text, ("gia", "price", "cost", "fee", "luong", "salary")):
        numeric_candidates = [
            c for c in list(column_stats.keys())
            if c in measures or any(token in str((column_stats.get(c) or {}).get("dtype", "")).casefold() for token in ("float", "double", "int", "numeric", "decimal"))
        ]
        measure = _best_column(question, numeric_candidates)

    dimension = _best_dimension(question, [item for item in dimensions if item not in times])
    time_column = _best_column(question, times)
    aggregate: AnalysisMethod = "sum" if measure else "count"
    if _mentions(text, ("trung binh", "average", "mean")) and measure:
        aggregate = "mean"
    elif _mentions(text, ("trung vi", "median")) and measure:
        aggregate = "median"
    elif _mentions(text, ("so luong", "bao nhieu", "count", "dem")):
        aggregate = "count"

    x_column: str | None = dimension
    y_column: str | None = measure
    second_dimension: str | None = None
    time_grain: Literal["day", "week", "month", "quarter", "year"] | None = None
    algorithm: AnalysisMethod = aggregate
    forecast_horizon = 12
    season_length = 12
    if problem == "forecast":
        horizon_match = re.search(r"\b(\d{1,2})\s*(?:ky|ngay|tuan|thang|quy|nam|period|day|week|month|quarter|year)", text)
        forecast_horizon = min(max(int(horizon_match.group(1)), 1), 60) if horizon_match else 12
        time_grain = "day" if _mentions(text, ("ngay", "day")) else "week" if _mentions(text, ("tuan", "week")) else "quarter" if _mentions(text, ("quy", "quarter")) else "year" if _mentions(text, ("nam", "year")) else "month"
        season_length = {"day": 7, "week": 52, "month": 12, "quarter": 4, "year": 2}[time_grain]
        explicit_algorithms = (
            ("neuralprophet", "neuralprophet"), ("prophet", "prophet"),
            ("auto arima", "auto_arima"), ("sarimax", "sarimax"), ("sarima", "sarima"),
            ("arimax", "arimax"), ("arima", "arima"), ("holt winters", "holt_winters"),
            ("holt", "holt_linear"), ("ets", "ets"), ("moving average", "moving_average"),
            ("trung binh truot", "moving_average"), ("seasonal naive", "seasonal_naive"),
            ("naive", "naive"), ("random forest", "random_forest"),
            ("xgboost", "xgboost"), ("lightgbm", "lightgbm"), ("catboost", "catboost"),
        )
        requested = next((identifier for phrase, identifier in explicit_algorithms if phrase in text), None)
        preferred = requested or ("seasonal_naive" if _mentions(text, ("mua vu", "season")) else "drift")
        available = available_forecast_algorithms()
        algorithm = preferred if preferred in available else "seasonal_naive" if "seasonal_naive" in available and _mentions(text, ("mua vu", "season")) else "drift"
        x_column = time_column
    if problem == "trend":
        x_column = time_column
        time_grain = "month" if "thang" in text or "month" in text else "quarter" if "quy" in text or "quarter" in text else "year" if "nam" in text or "year" in text else "month"
    elif problem == "quality":
        if _mentions(text, ("missing heatmap", "missing value heatmap", "null heatmap", "pattern missing", "mau thieu")):
            algorithm = "missing_heatmap"
        elif _mentions(text, ("cardinality", "unique", "trung lap")):
            algorithm = "cardinality"
        elif _mentions(text, ("outlier", "ngoai le")):
            algorithm = "outlier"
        else:
            algorithm = "missing_bar"
        x_column = y_column = None
    elif problem == "distribution":
        if "violin" in text:
            algorithm = "violin"
        elif _mentions(text, ("box plot", "boxplot", "outlier", "ngoai le")):
            algorithm = "box"
        else:
            algorithm = "histogram"
        has_group = _mentions(text, ("theo", "giua", "by", "per", "across"))
        x_column = dimension if (algorithm in {"box", "violin"} and has_group) else None
        y_column = measure or _best_column(question, measures) or (measures[0] if measures else None)
    elif problem == "relationship":
        if len(measures) >= 2 and _mentions(text, ("tuong quan", "correlation")):
            algorithm = "correlation_heatmap"
            x_column = y_column = None
        elif len(measures) >= 2:
            algorithm = "scatter"
            x_column = _best_column(question, measures) or measures[0]
            y_column = next((item for item in measures if item != x_column), measures[1])
        elif len(dimensions) >= 2:
            algorithm = "heatmap"
            x_column = dimension or dimensions[0]
            second_dimension = next(item for item in dimensions if item != x_column)
            y_column = None
        else:
            problem = "summary"
            algorithm = aggregate
            x_column = None
    elif problem == "compare":
        low_cardinality = [
            name for name in dimensions
            if 1 <= int((column_stats.get(name) or {}).get("cardinality") or 0) <= 8
            and name not in times
        ]
        if len(dimensions) >= 2 and _mentions(text, ("ma tran", "matrix", "va ", "giua ", "theo ca ", "cross")):
            problem = "relationship"
            algorithm = "heatmap"
            x_column = dimension or dimensions[0]
            second_dimension = next((item for item in dimensions if item != x_column), dimensions[1])
            y_column = None
        elif _mentions(text, ("donut", "pie", "ty trong", "co cau", "ty le", "phan tram", "share", "proportion", "breakdown")) or (x_column in low_cardinality and not measure):
            algorithm = "donut"
            if not x_column and low_cardinality:
                x_column = _best_column(question, low_cardinality) or low_cardinality[0]

    return ChartPlanCandidate(
        problem=problem,
        algorithm=algorithm,
        x_column=x_column,
        y_column=y_column,
        second_dimension=second_dimension,
        time_grain=time_grain,
        forecast_horizon=forecast_horizon,
        season_length=season_length,
        title=question[:255],
        rationale="Kế hoạch được tối ưu về tính trực quan và thẩm mỹ dựa trên đặc trưng kiểu dữ liệu.",
    )


def build_chart_plan(
    question: str,
    context: dict[str, Any],
    column_stats: dict[str, Any],
    candidate: ChartPlanCandidate | None = None,
    *,
    planning_mode: Literal["agent", "rules_fallback", "auto_profile"] = "agent",
) -> dict[str, Any]:
    """Normalize an agent proposal into a bounded executable chart plan."""

    context = sanitize_chart_context(context, column_stats)
    normalized_question = _plain(question)
    restricted_requested = any(
        _plain(str(column)) and _plain(str(column)) in normalized_question
        for column in (context.get("ignored_columns") or [])
    )
    # A request targeting a restricted column is not allowed to influence the
    # fallback dimension.  Prefer the safe time-series/measure default when
    # available, so the plan remains useful without leaking or selecting PII.
    fallback_question = question
    if restricted_requested:
        safe_measure = next(iter(context.get("measures") or []), None)
        safe_time = context.get("time_column") or next(
            iter(_time_columns(context, column_stats)), None
        )
        if safe_measure and safe_time:
            fallback_question = f"{safe_measure} theo thang {safe_time}"
    fallback = _fallback_candidate(fallback_question, context, column_stats)
    dimensions = list(context.get("dimensions") or [])
    measures = list(context.get("measures") or [])
    profile_columns = list(
        dict.fromkeys([*dimensions, *measures, *(context.get("keys") or [])])
    )
    times = _time_columns(context, column_stats)
    candidate_accepted = candidate is not None and not restricted_requested
    if candidate and (
        candidate.algorithm not in PROBLEM_ALGORITHMS[candidate.problem]
        or any(
            column is not None and column not in profile_columns
            for column in (
                candidate.x_column,
                candidate.y_column,
                candidate.second_dimension,
            )
        )
    ):
        proposed = fallback
        candidate_accepted = False
    elif restricted_requested:
        proposed = fallback
    else:
        proposed = candidate or fallback

    problem = proposed.problem
    algorithm = proposed.algorithm
    if problem == "forecast" and not times:
        problem, algorithm = fallback.problem, fallback.algorithm
    if algorithm not in PROBLEM_ALGORITHMS[problem]:
        salvaged_problem = next((p for p, algos in PROBLEM_ALGORITHMS.items() if algorithm in algos), None)
        if salvaged_problem:
            problem = salvaged_problem
        else:
            problem, algorithm = fallback.problem, fallback.algorithm

    if algorithm == "scatter" and len(measures) < 2:
        problem, algorithm = fallback.problem, fallback.algorithm
    if algorithm == "heatmap" and len(dimensions) < 2:
        problem, algorithm = fallback.problem, fallback.algorithm
    if algorithm == "correlation_heatmap" and len(measures) < 2:
        problem, algorithm = fallback.problem, fallback.algorithm

    if problem in {"trend", "forecast"}:
        x_column = proposed.x_column if proposed.x_column in times else fallback.x_column
    elif algorithm == "scatter":
        x_column = proposed.x_column if proposed.x_column in measures else fallback.x_column
    elif algorithm in {
        "histogram", "missing_bar", "missing_heatmap", "correlation_heatmap",
        "cardinality", "outlier",
    } or problem == "summary":
        x_column = None
    else:
        x_column = proposed.x_column if proposed.x_column in dimensions else fallback.x_column

    y_column = proposed.y_column if proposed.y_column in measures else fallback.y_column
    if algorithm in {
        "missing_bar", "missing_heatmap", "correlation_heatmap", "cardinality", "outlier", "donut"
    } and not y_column:
        y_column = None
    if algorithm == "donut":
        y_column = None
    second_dimension = (
        proposed.second_dimension
        if proposed.second_dimension in dimensions and proposed.second_dimension != x_column
        else fallback.second_dimension
    )
    time_grain = proposed.time_grain or fallback.time_grain if problem == "trend" else None
    forecast_horizon = proposed.forecast_horizon if problem == "forecast" else fallback.forecast_horizon
    season_length = proposed.season_length if problem == "forecast" else fallback.season_length

    if problem == "forecast":
        time_grain = proposed.time_grain or fallback.time_grain or "month"
        if algorithm not in available_forecast_algorithms():
            algorithm = fallback.algorithm

    if algorithm == "scatter" and y_column == x_column:
        y_column = next((item for item in measures if item != x_column), None)
    if algorithm in {"sum", "mean", "median", "histogram", "box", "scatter", "violin"} and not y_column:
        problem, algorithm = "summary", "count"
        x_column = y_column = second_dimension = None
        time_grain = None
    if problem in {"trend", "forecast"} and not x_column:
        problem = "summary"
        algorithm = "sum" if y_column else "count"
        time_grain = None

    chart_type: ChartType = CHART_FOR_PROBLEM[problem]  # type: ignore[assignment]
    if algorithm in {
        "histogram", "box", "scatter", "heatmap", "missing_bar", "missing_heatmap",
        "correlation_heatmap", "cardinality", "violin", "donut", "outlier",
    }:
        chart_type = algorithm  # type: ignore[assignment]

    # Visualization Recommendation Engine Override
    rationale = proposed.rationale
    cardinality = 0
    if x_column and x_column in column_stats:
        cardinality = column_stats[x_column].get("cardinality", 0)

    if problem == "composition":
        if cardinality <= 5 and cardinality > 0:
            chart_type = "donut"
            algorithm = "donut"
            rationale += f" (Hệ thống xác nhận: Dimension có {cardinality} nhóm, Pie/Donut là lý tưởng)."
        else:
            chart_type = "bar"
            if algorithm == "donut":
                algorithm = "sum" if y_column else "count"
            rationale += f" (Hệ thống tinh chỉnh: Có {cardinality} nhóm, quá nhiều cho Pie/Donut, chuyển sang Bar chart)."
    elif problem == "distribution" and chart_type not in ("histogram", "box", "violin", "outlier"):
        chart_type = "histogram"
        algorithm = "histogram"
        rationale += " (Hệ thống tinh chỉnh: Intent phân phối ưu tiên dùng Histogram)."
    elif problem == "geographic" and chart_type not in ("bar",):
        chart_type = "bar"
        if algorithm not in ("count", "sum", "mean", "median"):
            algorithm = "sum" if y_column else "count"
        rationale += " (Hệ thống ghi nhận intent địa lý, tạm render bằng Bar chart)."
    elif problem == "ranking" and chart_type != "bar":
        chart_type = "bar"
        rationale += " (Hệ thống xác nhận Ranking intent ưu tiên dùng Bar chart)."

    if problem == "forecast":
        query = {
            "analysis_kind": "forecast",
            "aggregate": "sum" if y_column else "count",
            "column": y_column,
            "dimensions": [x_column],
            "filters": [],
            "time_grain": time_grain,
            "forecast_algorithm": algorithm,
            "forecast_horizon": forecast_horizon,
            "season_length": season_length,
            "confidence_level": 0.95,
            "history_limit": 500,
            "bins": 12,
            "limit": 50,
            "sort": "asc",
        }
    elif algorithm == "histogram":
        query = {"analysis_kind": "histogram", "aggregate": "count", "column": y_column, "dimensions": [], "filters": [], "bins": 12, "limit": 50, "sort": "asc"}
    elif algorithm == "box":
        query = {"analysis_kind": "box", "aggregate": "median", "column": y_column, "dimensions": [x_column] if x_column else [], "filters": [], "bins": 12, "limit": 50, "sort": "desc"}
    elif algorithm == "violin":
        query = {
            "analysis_kind": "violin",
            "aggregate": "count",
            "column": y_column,
            "dimensions": [x_column] if x_column else [],
            "filters": [],
            "bins": 16,
            "limit": 8,
            "sort": "desc",
        }
    elif algorithm == "scatter":
        query = {"analysis_kind": "scatter", "aggregate": "count", "x_column": x_column, "y_column": y_column, "dimensions": [], "filters": [], "bins": 12, "limit": 50, "sort": "desc"}
    elif algorithm == "heatmap":
        query = {"analysis_kind": "heatmap", "aggregate": "count", "dimensions": [x_column, second_dimension], "filters": [], "bins": 12, "limit": 50, "sort": "desc"}
    elif algorithm in {"missing_bar", "missing_heatmap", "cardinality"}:
        query = {
            "analysis_kind": algorithm,
            "aggregate": "count",
            "columns": profile_columns[:12],
            "dimensions": [],
            "filters": [],
            "bins": 12,
            "limit": 50,
            "sort": "desc",
        }
    elif algorithm == "correlation_heatmap":
        query = {
            "analysis_kind": "correlation_heatmap",
            "aggregate": "count",
            "columns": measures[:10],
            "dimensions": [],
            "filters": [],
            "bins": 12,
            "limit": 100,
            "sort": "desc",
        }
    elif algorithm == "outlier":
        query = {
            "analysis_kind": "outlier",
            "aggregate": "count",
            "columns": measures[:12],
            "column": y_column,
            "dimensions": [x_column] if x_column else [],
            "filters": [],
            "bins": 12,
            "limit": 50,
            "sort": "desc",
        }
    elif algorithm == "donut":
        query = {
            "analysis_kind": "donut",
            "aggregate": "sum" if y_column else "count",
            "column": y_column,
            "dimensions": [x_column] if x_column else [],
            "filters": [],
            "bins": 12,
            "limit": 12,
            "sort": "desc",
        }
    else:
        filters = (
            _relative_time_filters(question, x_column, column_stats)
            if problem == "trend"
            else []
        )
        query = {
            "analysis_kind": "aggregate",
            "aggregate": algorithm,
            "column": None if algorithm == "count" else y_column,
            "dimensions": [x_column] if x_column and problem != "summary" else [],
            "filters": filters,
            "time_grain": time_grain,
            "bins": 12,
            "limit": 50,
            "sort": "asc" if problem == "trend" else "desc",
        }

    transforms: list[dict[str, str]] = []
    source_columns: list[str] = [c for c in [x_column, y_column, second_dimension] if c]

    if problem == "forecast":
        transforms.append({"step": "time_aggregation", "detail": f"Nhóm thời gian theo {time_grain or 'month'}"})
        transforms.append({"step": "model_fit", "detail": f"Áp dụng thuật toán {algorithm} ({forecast_horizon} kỳ)"})
    elif algorithm == "histogram":
        transforms.append({"step": "binning", "detail": f"Chia 12 khoảng giá trị cho {y_column}"})
        transforms.append({"step": "frequency_count", "detail": "Đếm tần suất theo từng bin"})
    elif algorithm in {"heatmap", "correlation_heatmap", "missing_heatmap"}:
        transforms.append({"step": "matrix_pivot", "detail": "Tổng hợp ma trận 2 chiều"})
    elif algorithm in {"box", "violin"}:
        transforms.append({"step": "quantile_summary", "detail": f"Tính ngũ phân vị / mật độ cho {y_column}"})
    else:
        if x_column and problem != "summary":
            transforms.append({"step": "group_by", "detail": f"Nhóm theo {x_column}"})
        transforms.append({"step": "aggregate", "detail": f"Tính {algorithm} ({y_column or '*'})"})
        if problem == "trend":
            transforms.append({"step": "sort_time", "detail": "Sắp xếp theo thời gian tăng dần"})

    return {
        "question": question,
        "title": question.strip()[:255] or proposed.title.strip()[:255],
        "problem": problem,
        "algorithm": algorithm,
        "x_column": x_column,
        "y_column": y_column,
        "second_dimension": second_dimension,
        "time_grain": time_grain,
        "forecast_horizon": forecast_horizon if problem == "forecast" else None,
        "season_length": season_length if problem == "forecast" else None,
        "chart_type": chart_type,
        "renderer": RENDERER_FOR_CHART[chart_type],
        "query": query,
        "transforms": transforms,
        "source_columns": source_columns,
        "rationale": rationale,
        "planning_mode": planning_mode
        if candidate_accepted or planning_mode == "auto_profile"
        else "rules_fallback",
    }


def build_auto_profile_pack(
    context: dict[str, Any],
    column_stats: dict[str, Any],
    *,
    max_charts: int = 12,
) -> list[dict[str, Any]]:
    """Create a rich, visually diverse profiling pack without a user question."""

    context = sanitize_chart_context(context, column_stats)
    dimensions = [str(item) for item in context.get("dimensions") or []]
    measures = [str(item) for item in context.get("measures") or []]
    times = _time_columns(context, column_stats)
    objectives: list[tuple[str, str]] = []

    def add(objective: str, question: str) -> None:
        if len(objectives) >= max_charts:
            return
        if any(existing == objective for existing, _ in objectives):
            return
        objectives.append((objective, question))

    # Core quality & distribution
    add("missingness", "Tự động kiểm tra missing null theo từng cột")
    if dimensions:
        add("cardinality", "Tự động kiểm tra cardinality unique duplicate theo cột")
    if measures:
        add("outlier", "Tự động kiểm tra outlier theo các measure")
        add(
            "distribution",
            f"Tự động phân tích histogram phân phối của measure {measures[0]}",
        )
        add(
            "box_plot",
            f"Tự động phân tích box plot outlier của measure {measures[0]}",
        )

    # Time-series trend & forecast (high priority when time column exists)
    if times and measures:
        add(
            "trend",
            f"Tự động phân tích xu hướng của {measures[0]} theo thời gian {times[0]}",
        )
        distinct_periods = (column_stats.get(times[0]) or {}).get("cardinality") or 0
        if int(distinct_periods or 0) >= 12:
            add(
                "forecast",
                f"Tự động dự báo chuỗi thời gian của {measures[0]} theo {times[0]}",
            )

    # Relationships between measures
    if len(measures) >= 2:
        add("correlation", "Tự động kiểm tra correlation giữa các measure")
        add(
            "relationship",
            f"Tự động kiểm tra scatter giữa {measures[0]} và {measures[1]}",
        )

    # Visual diversity: Donut & Cross Heatmap
    low_card_dims = [
        d for d in dimensions 
        if 2 <= int((column_stats.get(d) or {}).get("cardinality") or 0) <= 8
        and d not in times
    ]
    if low_card_dims:
        add(
            "donut_share",
            f"Tỷ trọng phân bổ cơ cấu theo {low_card_dims[0]} bằng biểu đồ donut",
        )

    if len(dimensions) >= 2:
        dim1, dim2 = dimensions[0], dimensions[1]
        add(
            "cross_heatmap",
            f"Ma trận phân bố tương quan 2 chiều giữa {dim1} và {dim2}",
        )

    if dimensions and measures:
        add(
            "comparison",
            f"Tự động so sánh {measures[0]} theo dimension {dimensions[0]}",
        )

    if len(dimensions) + len(measures) >= 3:
        add("missing_pattern", "Tự động kiểm tra pattern missing bằng missing heatmap")

    plans: list[dict[str, Any]] = []
    for objective, question in objectives:
        plan = build_chart_plan(question, context, column_stats, planning_mode="auto_profile")
        plan["objective"] = objective
        plan["auto_generated"] = True
        plans.append(plan)
    return plans


__all__ = [
    "can_plan_deterministically",
    "ChartPlanCandidate",
    "build_auto_profile_pack",
    "build_chart_plan",
    "sanitize_chart_context",
]
