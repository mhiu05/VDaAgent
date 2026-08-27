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
# pyrefly: ignore [missing-import]
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
    value = value.replace("đ", "d").replace("Đ", "d")
    value = unicodedata.normalize("NFD", value.casefold())
    value = "".join(char for char in value if unicodedata.category(char) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


def _mentions(text: str, phrases: tuple[str, ...]) -> bool:
    return any(phrase in text for phrase in phrases)


def _requested_top_limit(question: str, default: int = 15) -> int:
    """Return the explicit Top-N requested by the analyst, bounded for execution."""

    text = _plain(question)
    match = re.search(r"\btop\s*(\d{1,2})\b", text)
    if not match:
        return default
    return min(max(int(match.group(1)), 1), 50)


def _localized_rationale(
    rationale: str, problem: ProblemType, x_column: str | None, y_column: str | None
) -> str:
    """Keep planning feedback legible even if the provider returns ASCII-only text."""

    if re.search(r"[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]", rationale.casefold()):
        return rationale.strip()
    if problem == "relationship":
        return f"Chọn biểu đồ phân tán để kiểm tra mối quan hệ giữa “{x_column or 'biến số thứ nhất'}” và “{y_column or 'biến số thứ hai'}”."
    if problem in {"trend", "forecast"}:
        return f"Chọn biểu đồ đường để theo dõi sự thay đổi của “{y_column or 'giá trị'}” theo thời gian."
    if problem == "ranking":
        return f"Chọn biểu đồ cột để xếp hạng các nhóm theo “{x_column or 'nhóm dữ liệu'}”."
    if problem == "distribution":
        return f"Chọn biểu đồ phân phối để xem đặc điểm của “{y_column or 'cột số'}”."
    return f"Chọn biểu đồ phù hợp để phân tích “{y_column or x_column or 'dữ liệu đã chọn'}” theo câu hỏi của bạn."


def _tokenize_name(name: str) -> set[str]:
    """Extract lowercase alphanumeric word tokens from a column name or string."""
    plain = _plain(name)
    tokens = set(plain.split())
    stop_words = {"of", "the", "a", "an", "in", "on", "at", "to", "for", "and", "or", "by", "is", "it", "va", "cua", "theo", "cac", "tung", "moi", "nhom"}
    return {t for t in tokens if len(t) > 1 and t not in stop_words}


COLUMN_SYNONYMS: dict[str, tuple[str, ...]] = {
    # Lương / Thu nhập / Thù lao
    "luong": ("salary", "salary_estimate", "avg_salary", "min_salary", "max_salary", "wage", "compensation", "income", "pay", "earning", "rate", "remuneration"),
    "muc luong": ("salary", "salary_estimate", "avg_salary", "wage", "income", "pay"),
    "thu nhap": ("income", "salary", "wage", "earnings", "revenue", "compensation"),
    "thu lao": ("compensation", "salary", "fee", "pay"),
    # Giá cả / Chi phí / Tiền tệ
    "gia": ("price", "cost", "amount", "fee", "rate", "revenue", "val", "spend", "expense", "salary"),
    "gia ca": ("price", "cost", "amount", "fee"),
    "chi phi": ("cost", "expense", "spend", "expenditure", "fee", "price"),
    "gia tien": ("price", "amount", "cost", "total"),
    "tien": ("money", "amount", "cash", "price", "cost", "salary", "revenue"),
    "price": ("price", "cost", "amount", "fee"),
    # Doanh thu / Doanh số / Lợi nhuận
    "doanh thu": ("revenue", "sales", "turnover", "income", "gross_revenue", "total_revenue"),
    "doanh so": ("sales", "revenue", "volume", "units_sold", "turnover"),
    "ban hang": ("sales", "sell", "order", "revenue"),
    "loi nhuan": ("profit", "margin", "gain", "net_profit", "ebitda"),
    # Đánh giá / Điểm số / Xếp hạng
    "danh gia": ("rating", "score", "rank", "diem", "eval", "review", "stars", "feedback"),
    "diem": ("rating", "score", "point", "rank", "grade", "diem"),
    "diem so": ("score", "rating", "point", "grade"),
    "diem danh gia": ("rating", "score", "review_rating"),
    "sao": ("stars", "rating", "score"),
    # Số lượng / Đếm / Tần suất
    "so luong": ("quantity", "qty", "volume", "count", "num", "units", "sl", "total", "amount"),
    "so": ("count", "number", "num", "quantity", "amount", "total"),
    "tong so": ("total", "sum", "count", "aggregate", "amount"),
    "quantity": ("quantity", "qty", "volume", "count", "num"),
    # Ngành nghề / Lĩnh vực
    "nganh": ("industry", "sector", "category", "field", "domain", "discipline"),
    "nganh nghe": ("industry", "sector", "occupation", "job", "career"),
    "nganh cong nghiep": ("industry", "sector", "manufacturing"),
    "linh vuc": ("sector", "industry", "field", "domain", "area"),
    "danh muc": ("category", "cat", "type", "genre", "group", "class", "industry", "sector"),
    # Công việc / Chức danh / Vị trí
    "cong viec": ("job", "job_title", "title", "role", "position", "occupation", "career"),
    "vi tri cong viec": ("job_title", "job", "title", "role", "position"),
    "chuc danh": ("title", "job_title", "role", "position", "designation"),
    "chuc vu": ("role", "title", "position", "job_title", "job"),
    "nghe nghiep": ("occupation", "job", "career", "profession", "title"),
    "tin tuyen dung": ("job", "job_title", "title", "posting", "opening", "listing"),
    "tuyen dung": ("recruitment", "hiring", "job", "opening", "posting"),
    # Công ty / Doanh nghiệp / Tổ chức
    "cong ty": ("company", "company_name", "employer", "firm", "corp", "enterprise", "business", "org"),
    "ten cong ty": ("company_name", "company", "employer", "business_name"),
    "doanh nghiep": ("company", "enterprise", "business", "firm", "corp"),
    "nha tuyen dung": ("employer", "company", "company_name", "recruiter"),
    "to chuc": ("organization", "org", "company", "institution"),
    # Loại hình / Sở hữu / Cơ cấu
    "loai hinh": ("type", "type_of_ownership", "ownership", "kind", "category", "class"),
    "loai hinh cong ty": ("type_of_ownership", "ownership", "company_type", "type"),
    "loai hinh so huu": ("type_of_ownership", "ownership", "owner_type"),
    "so huu": ("ownership", "type_of_ownership", "owner", "holder"),
    "chu so huu": ("owner", "ownership", "type_of_ownership"),
    "hinh thuc": ("type", "form", "mode", "category", "ownership"),
    "loai": ("type", "kind", "class", "category", "genre"),
    # Địa điểm / Khu vực / Vị trí địa lý
    "dia diem": ("location", "city", "state", "region", "address", "site", "place", "headquarters", "hq"),
    "noi lam viec": ("location", "workplace", "site", "office"),
    "thanh pho": ("city", "location", "town", "metro", "municipality"),
    "tinh thanh": ("state", "province", "city", "region", "location"),
    "khu vuc": ("region", "area", "zone", "location", "district"),
    "tru so": ("headquarters", "hq", "location", "main_office"),
    "tru so chinh": ("headquarters", "hq", "location"),
    "vi tri": ("location", "position", "site", "place", "job_title", "role"),
    "quoc gia": ("country", "nation", "nationality"),
    # Quy mô / Kích thước / Nhân sự
    "quy mo": ("size", "scale", "headcount", "employees", "staff", "company_size"),
    "kich thuoc": ("size", "dimension", "scale"),
    "nhan su": ("employees", "staff", "headcount", "size", "workforce"),
    "nhan vien": ("employees", "staff", "headcount", "size", "workers"),
    # Năm thành lập / Tuổi / Thời gian
    "nam thanh lap": ("founded", "year_founded", "established", "year"),
    "thanh lap": ("founded", "year_founded", "established", "creation"),
    "tuoi": ("age", "founded", "tenure", "years"),
    "do tuoi": ("age", "age_group"),
    "kinh nghiem": ("experience", "years_experience", "seniority", "tenure"),
    "so nam kinh nghiem": ("years_experience", "experience", "seniority"),
    "tham nien": ("seniority", "tenure", "experience", "years"),
    # Thời gian / Ngày tháng
    "ngay": ("date", "time", "day", "created_at", "updated_at", "timestamp", "order_date"),
    "thang": ("month", "date", "time", "period"),
    "quy": ("quarter", "date", "period"),
    "nam": ("year", "founded", "date", "period"),
    "thoi gian": ("date", "time", "timestamp", "created_at", "period", "duration"),
    # Đối thủ / Khách hàng / Sản phẩm / Kho
    "doi thu": ("competitors", "rivals", "competition"),
    "doi thu canh tranh": ("competitors", "rivals"),
    "khach hang": ("customer", "client", "buyer", "user", "consumer", "account"),
    "san pham": ("product", "item", "goods", "sku", "title", "name"),
    "don hang": ("order", "invoice", "transaction", "purchase"),
    "kho": ("warehouse", "store", "location", "facility", "site", "depot"),
    "trang thai": ("status", "state", "condition", "stage"),
    "ky nang": ("skill", "skills", "competency", "tools", "tech_stack"),
    "mo ta": ("description", "desc", "job_description", "summary", "detail"),
    "mo ta cong viec": ("job_description", "description", "details"),
}


def _best_column(question: str, columns: list[str], preferred: tuple[str, ...] = ()) -> str | None:
    if not columns:
        return None
    intent = _plain(question)
    intent_tokens = _tokenize_name(intent)

    best_match: str | None = None
    best_score = -1

    for column in columns:
        col_plain = _plain(column)
        col_tokens = _tokenize_name(col_plain)
        score = 0

        # Exact full column match
        if col_plain == intent:
            score = 120
        # Substring in question
        elif col_plain in intent:
            score = 100
        else:
            # Multi-word or single-word synonym matches
            for key, tokens in COLUMN_SYNONYMS.items():
                is_matched = False
                key_plain = _plain(key)
                if " " in key_plain:
                    if key_plain in intent:
                        is_matched = True
                else:
                    if key_plain in intent_tokens or key_plain in intent.split():
                        is_matched = True

                if is_matched:
                    for token in tokens:
                        if token in col_plain or any(token == ct for ct in col_tokens):
                            weight = 85 if " " in key_plain else 65
                            score = max(score, weight)
                            break

            # Token overlap between column name and question
            if col_tokens and (col_tokens & intent_tokens):
                overlap = len(col_tokens & intent_tokens)
                score = max(score, 55 + overlap * 10)

            # Preferred fallback keywords
            for token in preferred:
                if token in col_plain:
                    score = max(score, 30)

        if score > best_score:
            best_score = score
            best_match = column

    if best_match and best_score > 0:
        return best_match

    # Fallback to preferred tokens
    for token in preferred:
        for column in columns:
            if token in _plain(column):
                return column

    return columns[0]


def _best_dimension(question: str, dimensions: list[str]) -> str | None:
    if not dimensions:
        return None
    text = _plain(question)
    match = re.search(r"(?:top\s*\d*|xep hang|danh sach|so sanh|theo|theo tung|theo cac|giua cac|giua|theo moi|theo nhom|phan theo|nhom theo|cua cac|cua moi|cho cac|cho tung|cac|tung)\s+([^,.;]+)", text)
    if match:
        target = match.group(1).strip()
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
    elif times and _mentions(text, ("thang", "quy", "nam", "ngay", "xu huong", "thay doi", "trend", "over time", "lich su", "timeline")):
        problem: ProblemType = "trend"
    elif _mentions(text, ("tang theo", "ty le thuan", "ty le voi", "in proportion", "proportionally")):
        # Explicit proportionality is a relationship question, not a
        # composition/share question, even though both may contain "proportion".
        problem = "relationship"
    elif _mentions(text, ("missing", "null", "thieu du lieu", "du lieu thieu", "cardinality", "unique", "trung lap", "outlier chart", "ty le outlier", "outlier theo cot", "missing_bar", "missing_heatmap", "chat luong")):
        problem = "quality"
    elif _mentions(text, ("ty trong", "co cau", "thanh phan", "chiem bao nhieu", "pie", "donut", "phan tram", "ty le phan tram", "share", "proportion", "breakdown")):
        problem = "composition"
    elif _mentions(text, ("phan phoi", "phan bo", "histogram", "tan suat", "box plot", "violin", "outlier", "ngoai le", "boxplot", "do lech", "khoang gia tri")):
        problem = "distribution"
    elif _mentions(text, ("tuong quan", "moi quan he", "quan he", "lien he", "anh huong", "tang theo", "ty le thuan", "ty le voi", "in proportion", "proportionally", "relationship", "correlation", "scatter", "heatmap", "ma tran")):
        problem = "relationship"
    elif _mentions(text, ("top ", "cao nhat", "thap nhat", "nhieu nhat", "it nhat", "dan dau", "xep hang", "ranking", "leaderboard", "hang dau", "bar chart", "bieu do cot", "cot")):
        problem = "ranking"
    elif not dimensions or _mentions(text, ("tong cong", "kpi", "toan bo", "kpi card", "tong quat")):
        problem = "summary"
    else:
        problem = "compare"

    measure = _best_column(
        question,
        measures,
        ("price", "revenue", "sales", "amount", "total", "doanh thu", "doanh so", "value", "rating", "cost", "salary", "score", "income", "compensation"),
    )
    if not measure and _mentions(text, ("gia", "price", "cost", "fee", "luong", "salary", "rating", "score", "income", "thu nhap")):
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
    elif _mentions(text, ("so luong", "bao nhieu", "count", "dem", "tong so")):
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
    elif problem == "trend":
        x_column = time_column
        time_grain = "month" if "thang" in text or "month" in text else "quarter" if "quy" in text or "quarter" in text else "year" if "nam" in text or "year" in text else "month"
    elif problem == "composition":
        algorithm = "donut"
        x_column = dimension or (dimensions[0] if dimensions else None)
        y_column = None
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
        has_group = _mentions(text, ("theo", "giua", "by", "per", "across", "phan theo"))
        x_column = dimension if (algorithm in {"box", "violin"} and has_group) else None
        y_column = measure or (measures[0] if measures else None)
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
        if len(dimensions) >= 2 and _mentions(text, ("ma tran", "matrix", "bang cheo", "cross tab", "pivot", "2 chieu", "hai chieu")):
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


def chart_planning_rejection_reason(
    question: str, context: dict[str, Any], column_stats: dict[str, Any]
) -> str | None:
    """Return a user-facing reason when the available data cannot support a chart."""

    dimensions = list(context.get("dimensions") or [])
    measures = list(context.get("measures") or [])
    times = _time_columns(context, column_stats)
    text = _plain(question)
    if not dimensions and not measures:
        return "Profile chưa có cột phân loại hoặc cột số đã được duyệt. Hãy xác nhận ngữ nghĩa dữ liệu trước."

    asks_for_time = _mentions(text, ("thang", "quy", "nam", "ngay", "xu huong", "thay doi", "trend", "over time", "lich su", "timeline", "forecast", "du bao"))
    asks_for_relationship = _mentions(text, ("tuong quan", "moi quan he", "quan he", "lien he", "anh huong", "tang theo", "ty le thuan", "ty le voi", "in proportion", "proportionally", "relationship", "correlation", "scatter"))
    asks_for_distribution = _mentions(text, ("phan phoi", "phan bo", "histogram", "tan suat", "box plot", "violin", "boxplot", "do lech", "khoang gia tri"))
    if asks_for_time and not times:
        return "Câu hỏi cần phân tích theo thời gian, nhưng profile chưa có cột ngày/thời gian đã được duyệt."
    if asks_for_relationship and len(measures) < 2:
        return "Câu hỏi cần so sánh mối quan hệ, nhưng profile cần tối thiểu hai cột số (measure) khác nhau."
    if asks_for_distribution and not measures:
        return "Biểu đồ phân phối cần ít nhất một cột số (measure), nhưng profile hiện chưa có."

    inferred = _fallback_candidate(question, context, column_stats)
    if inferred.problem in {"trend", "forecast"} and not times:
        return "Câu hỏi cần phân tích theo thời gian, nhưng profile chưa có cột ngày/thời gian đã được duyệt."
    if inferred.problem == "relationship" and len(measures) < 2:
        return "Câu hỏi cần so sánh mối quan hệ, nhưng profile cần tối thiểu hai cột số (measure) khác nhau."
    if inferred.problem == "distribution" and not measures:
        return "Biểu đồ phân phối cần ít nhất một cột số (measure), nhưng profile hiện chưa có."
    if inferred.problem in {"ranking", "compare", "composition", "geographic"} and not dimensions:
        return "Câu hỏi cần chia dữ liệu theo nhóm, nhưng profile chưa có cột phân loại (dimension) đã được duyệt."
    return None


def build_chart_plan(
    question: str,
    context: dict[str, Any],
    column_stats: dict[str, Any],
    candidate: ChartPlanCandidate | None = None,
    *,
    planning_mode: Literal["agent", "rules_fallback", "auto_profile"] = "agent",
) -> dict[str, Any]:
    """Normalize an agent proposal into a bounded executable chart plan."""

    fallback = _fallback_candidate(question, context, column_stats)
    dimensions = list(context.get("dimensions") or [])
    measures = list(context.get("measures") or [])
    profile_columns = list(
        dict.fromkeys([*dimensions, *measures, *(context.get("keys") or [])])
    )
    times = _time_columns(context, column_stats)
    candidate_accepted = candidate is not None
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
    else:
        proposed = candidate or fallback

    problem = proposed.problem
    algorithm = proposed.algorithm
    if problem == "forecast" and not times:
        problem, algorithm = fallback.problem, fallback.algorithm
    if algorithm not in PROBLEM_ALGORITHMS[problem]:
        # Keep the model's declared analytical question stable.  An algorithm
        # from another problem family is incompatible and must fall back to a
        # deterministic plan instead of silently changing the question.
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
        if measures and algorithm in {"histogram", "box", "violin", "mean", "median"}:
            y_column = measures[0]
        else:
            problem, algorithm = "summary", "count"
            x_column = y_column = second_dimension = None
            time_grain = None
    if problem == "composition" and not x_column and dimensions:
        x_column = dimensions[0]
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
    rationale = _localized_rationale(
        proposed.rationale, problem, x_column, y_column
    )
    cardinality = 0
    if x_column and x_column in column_stats:
        cardinality = column_stats[x_column].get("cardinality", 0)

    if problem == "composition":
        if cardinality <= 10 or cardinality == 0:
            chart_type = "donut"
            algorithm = "donut"
            rationale += " (Hệ thống xác nhận: Phân tích tỷ trọng thành phần ưu tiên dùng Pie/Donut)."
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

    ranking_limit = _requested_top_limit(question)

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
            "limit": ranking_limit if problem == "ranking" else 50,
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
    "ChartPlanCandidate",
    "build_auto_profile_pack",
    "build_chart_plan",
    "chart_planning_rejection_reason",
]
