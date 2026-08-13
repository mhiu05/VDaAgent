"""Compute engine xác định (ADR-005) — DuckDB + pandas/numpy.

Ràng buộc cốt lõi của dự án: **LLM không bao giờ tự tính số**. Mọi con số trong
báo cáo đều đi ra từ module này. LLM chỉ đọc số đã tính và diễn đạt lại.

Sampling (ADR-006): khi chạy chế độ `sample`, mọi ColumnStat được gắn
`is_approximate=True` + `margin_of_error` để báo cáo không in số ước lượng như
thể là số chính xác.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any, Literal

import duckdb
import numpy as np
import pandas as pd
from src.services.storage import materialize_source

ScanMode = Literal["full", "sample"]

# --------------------------------------------------------------------------- #
# PII detection — heuristic tên cột + regex trên giá trị
# --------------------------------------------------------------------------- #
PII_NAME_PATTERNS: dict[str, str] = {
    "email": r"(e[-_]?mail)",
    "phone": r"(phone|mobile|tel|sdt|so_dien_thoai)",
    "national_id": r"(ssn|cmnd|cccd|national_id|id_card|passport)",
    "address": r"(address|dia_chi|street|zip|postal)",
    "full_name": r"(full_?name|ho_?ten|customer_?name|user_?name|first_?name|last_?name)",
    "credit_card": r"(credit_?card|card_?number|cc_?num)",
    "dob": r"(birth|dob|ngay_?sinh)",
    "ip_address": r"(ip_?addr|ip_?address)",
}

PII_VALUE_PATTERNS: dict[str, str] = {
    "email": r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$",
    # Số điện thoại VN: bắt đầu bằng 0 hoặc +84, 9-11 số. Cố ý CHẶT để cột
    # lương/ngày/mã số không bị nhận nhầm thành số điện thoại.
    "phone": r"^(\+?84|0)[\s.-]?\d{2,3}[\s.-]?\d{3,4}[\s.-]?\d{3,4}$",
    "credit_card": r"^(?:\d[ -]?){13,19}$",
    "ip_address": r"^(\d{1,3}\.){3}\d{1,3}$",
    "national_id": r"^\d{9}$|^\d{12}$",
}

# Các pattern chỉ có nghĩa trên cột chuỗi. Áp lên cột số/ngày sẽ sinh
# false positive (lương 9 chữ số trông giống CMND, ngày trông giống mã số).
_STRING_ONLY_PII = {"phone", "credit_card", "national_id"}

# Cột không phải PII trực tiếp nhưng ghép lại có thể tái định danh cá nhân.
QUASI_IDENTIFIER_PATTERNS = r"(gender|sex|age|tuoi|zip|postal|city|district|province|job|title|salary)"


@dataclass
class ColumnStats:
    """Thống kê một cột. Khớp 1-1 với bảng `column_stats` trong metadata DB."""

    column_name: str
    dtype: str
    row_count: int
    null_count: int
    null_pct: float
    cardinality: int
    uniqueness_ratio: float
    min_value: float | None = None
    max_value: float | None = None
    mean: float | None = None
    median: float | None = None
    std: float | None = None
    q1: float | None = None
    q3: float | None = None
    outlier_count: int | None = None
    outlier_method: str | None = None
    min_length: int | None = None
    max_length: int | None = None
    top_k_values: list[dict[str, Any]] = field(default_factory=list)
    is_approximate: bool = False
    margin_of_error: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return {k: v for k, v in self.__dict__.items()}


@dataclass
class ProfileComputation:
    """Kết quả đầy đủ của một lần compute — không chứa giá trị raw của cột PII."""

    row_count: int
    column_names: list[str]
    stats: dict[str, dict[str, Any]]
    correlation_matrix: dict[str, dict[str, float]]
    pii_flags: list[dict[str, Any]]
    quasi_identifiers: list[str]
    is_approximate: bool
    executed_query: str
    random_seed: int | None
    truncated_columns: list[str] = field(default_factory=list)


# --------------------------------------------------------------------------- #
# Nạp dữ liệu
# --------------------------------------------------------------------------- #
_SAFE_REF = re.compile(r"^[A-Za-z0-9_\-./\\: ]+$")


def _quote(ref: str) -> str:
    """Escape để chèn dataset_ref vào SQL an toàn.

    DuckDB không hỗ trợ parameter binding cho tên file trong `FROM`, nên phải
    tự escape. Chặn ký tự lạ trước, rồi nhân đôi dấu nháy đơn.
    """
    if not _SAFE_REF.match(ref):
        raise ValueError(
            "dataset_ref chứa ký tự không cho phép. Chỉ nhận chữ, số, _ - . / \\ : và khoảng trắng."
        )
    return "'" + ref.replace("'", "''") + "'"


def load_dataset(
    dataset_ref: str,
    scan_mode: ScanMode = "sample",
    sample_size: int = 10_000,
    sample_strategy: str = "reservoir",
    random_seed: int | None = 42,
    max_columns: int = 200,
) -> tuple[pd.DataFrame, str, list[str]]:
    """Nạp dataset vào DataFrame theo `scan_mode`.

    Trả về (dataframe, câu SQL đã chạy, danh sách cột bị cắt).
    Câu SQL được lưu vào ProfileRun.executed_query cho reproducibility (L5).
    """
    with materialize_source(dataset_ref) as path:
        src = _quote(str(path))
        con = duckdb.connect(database=":memory:")
        try:
            if random_seed is not None:
                con.execute(f"SELECT setseed({(random_seed % 1000) / 1000.0})")

            if scan_mode == "full":
                query = f"SELECT * FROM {src}"
            elif sample_strategy == "tablesample":
                # TABLESAMPLE nhanh hơn nhưng phân phối kém đều hơn reservoir.
                query = f"SELECT * FROM {src} USING SAMPLE {int(sample_size)} ROWS (system)"
            else:
                query = f"SELECT * FROM {src} USING SAMPLE {int(sample_size)} ROWS (reservoir)"

            df = con.execute(query).df()
        finally:
            con.close()

    # Không lưu temporary path vào evidence. Dataset reference ổn định của
    # Supabase vẫn đủ để truy vết; lần đọc sau sẽ materialize file tạm mới.
    if dataset_ref.startswith("supabase://"):
        query = query.replace(str(path), dataset_ref)

    truncated: list[str] = []
    if len(df.columns) > max_columns:
        truncated = list(df.columns[max_columns:])
        df = df.iloc[:, :max_columns]

    return df, query, truncated


# --------------------------------------------------------------------------- #
# Thống kê mô tả
# --------------------------------------------------------------------------- #
def _margin_of_error(sample_size: int, proportion: float = 0.5) -> float:
    """Sai số biên 95% cho tỉ lệ ước lượng từ sample (z = 1.96)."""
    if sample_size <= 1:
        return 1.0
    p = min(max(proportion, 0.0), 1.0)
    return round(1.96 * math.sqrt(max(p * (1 - p), 1e-9) / sample_size), 6)


def _cardinality_margin(sample_size: int, cardinality: int) -> float:
    """Sai số tương đối của cardinality ước lượng.

    Cardinality nhạy với sampling hơn null_pct nhiều: cột có nhiều giá trị unique
    thì sample chỉ thấy được một phần. Dùng xấp xỉ standard error của HyperLogLog
    (~1.04/sqrt(m)) làm sàn, cộng thêm phần chưa quan sát được.
    """
    if sample_size <= 0:
        return 1.0
    hll_error = 1.04 / math.sqrt(sample_size)
    unseen = cardinality / sample_size
    return round(min(1.0, hll_error + 0.5 * unseen), 6)


def _outliers(series: pd.Series, method: str) -> tuple[int | None, str | None]:
    """Đếm outlier bằng IQR và/hoặc z-score. Trả (số lượng, tên phương pháp)."""
    clean = series.dropna()
    if clean.empty or len(clean) < 4:
        return None, None

    counts: dict[str, int] = {}
    if method in ("iqr", "both"):
        q1, q3 = clean.quantile(0.25), clean.quantile(0.75)
        iqr = q3 - q1
        if iqr > 0:
            lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
            counts["iqr"] = int(((clean < lo) | (clean > hi)).sum())
    if method in ("zscore", "both"):
        std = clean.std()
        if std and std > 0:
            counts["zscore"] = int((((clean - clean.mean()) / std).abs() > 3).sum())

    if not counts:
        return None, None
    if len(counts) == 1:
        name, value = next(iter(counts.items()))
        return value, name
    # "both": lấy hợp lý nhất là số lớn hơn để không bỏ sót cảnh báo.
    return max(counts.values()), "iqr+zscore"


def _float_or_none(value: Any) -> float | None:
    """Chuẩn hoá về float JSON-safe: NaN/Inf -> None."""
    if value is None:
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return None if (math.isnan(out) or math.isinf(out)) else out


def compute_column_stats(
    df: pd.DataFrame,
    scan_mode: ScanMode = "sample",
    top_k: int = 10,
    outlier_method: str = "iqr",
    pii_columns: set[str] | None = None,
) -> dict[str, dict[str, Any]]:
    """Tính thống kê mô tả từng cột. Cột PII không lấy top_k_values."""
    pii_columns = pii_columns or set()
    is_sample = scan_mode == "sample"
    n = len(df)
    out: dict[str, dict[str, Any]] = {}

    for col in df.columns:
        series = df[col]
        null_count = int(series.isna().sum())
        null_pct = round(null_count / n * 100, 4) if n else 0.0
        cardinality = int(series.nunique(dropna=True))
        non_null = n - null_count

        stats = ColumnStats(
            column_name=str(col),
            dtype=str(series.dtype),
            row_count=n,
            null_count=null_count,
            null_pct=null_pct,
            cardinality=cardinality,
            uniqueness_ratio=round(cardinality / non_null, 6) if non_null else 0.0,
        )

        if pd.api.types.is_numeric_dtype(series) and not pd.api.types.is_bool_dtype(series):
            clean = series.dropna()
            if not clean.empty:
                stats.min_value = _float_or_none(clean.min())
                stats.max_value = _float_or_none(clean.max())
                stats.mean = _float_or_none(clean.mean())
                stats.median = _float_or_none(clean.median())
                stats.std = _float_or_none(clean.std())
                stats.q1 = _float_or_none(clean.quantile(0.25))
                stats.q3 = _float_or_none(clean.quantile(0.75))
                stats.outlier_count, stats.outlier_method = _outliers(clean, outlier_method)
        elif pd.api.types.is_datetime64_any_dtype(series):
            clean = series.dropna()
            if not clean.empty:
                # Min/max ngày giữ dạng chuỗi ISO trong top_k_values để không mất
                # thông tin khi serialize; min_value/max_value chỉ dành cho số.
                stats.top_k_values = [
                    {"value": str(clean.min()), "label": "min"},
                    {"value": str(clean.max()), "label": "max"},
                ]
        else:
            as_str = series.dropna().astype(str)
            if not as_str.empty:
                lengths = as_str.str.len()
                stats.min_length = int(lengths.min())
                stats.max_length = int(lengths.max())

        # top_k_values: bỏ qua cột PII (eval case C-01/E-01 — không lộ giá trị thật).
        if str(col) not in pii_columns and not stats.top_k_values:
            counts = series.value_counts(dropna=True).head(top_k)
            stats.top_k_values = [
                {"value": str(idx), "count": int(cnt)} for idx, cnt in counts.items()
            ]

        if is_sample:
            stats.is_approximate = True
            # null_pct là tỉ lệ -> dùng MOE của proportion; cardinality dùng công thức riêng.
            stats.margin_of_error = _margin_of_error(n, null_count / n if n else 0.0)

        out[str(col)] = stats.to_dict()
        if is_sample:
            out[str(col)]["cardinality_margin_of_error"] = _cardinality_margin(n, cardinality)

    return out


def compute_correlation_matrix(df: pd.DataFrame) -> dict[str, dict[str, float]]:
    """Ma trận tương quan Pearson giữa các cột số."""
    numeric = df.select_dtypes(include=[np.number])
    if numeric.shape[1] < 2:
        return {}
    corr = numeric.corr(method="pearson", numeric_only=True)
    return {
        str(row): {
            str(col): round(float(val), 6)
            for col, val in corr.loc[row].items()
            if val is not None and not pd.isna(val)
        }
        for row in corr.index
    }


# --------------------------------------------------------------------------- #
# PII
# --------------------------------------------------------------------------- #
def detect_pii(df: pd.DataFrame, sample_rows: int = 500) -> list[dict[str, Any]]:
    """Phát hiện PII bằng heuristic tên cột + regex trên giá trị mẫu.

    Trả về flag kèm `detection_method`, `confidence`, `evidence` để node
    `propose_metadata` nâng thành PiiProposal (ADR-003).
    Evidence chỉ ghi tỉ lệ khớp — KHÔNG kèm giá trị thật.
    """
    flags: list[dict[str, Any]] = []

    for col in df.columns:
        name = str(col).lower()
        name_hit: str | None = None
        for pii_type, pattern in PII_NAME_PATTERNS.items():
            if re.search(pattern, name):
                name_hit = pii_type
                break

        raw = df[col].dropna()
        series = raw.astype(str).head(sample_rows)
        # Cột số/ngày đã được DuckDB parse thành dtype tương ứng; regex kiểu
        # phone/CMND/thẻ chỉ áp cho cột chuỗi.
        is_textual = not (
            pd.api.types.is_numeric_dtype(raw) or pd.api.types.is_datetime64_any_dtype(raw)
        )

        value_hit: str | None = None
        match_ratio = 0.0
        if not series.empty:
            for pii_type, pattern in PII_VALUE_PATTERNS.items():
                if pii_type in _STRING_ONLY_PII and not is_textual:
                    continue
                ratio = float(series.str.match(pattern).mean())
                if ratio > match_ratio and ratio >= 0.5:
                    match_ratio, value_hit = ratio, pii_type

        # Tên cột gợi ý loại A nhưng giá trị khớp loại B thì tin tên cột hơn:
        # tên cột do người đặt, mang ý nghĩa nghiệp vụ rõ hơn regex.
        if name_hit and value_hit and name_hit != value_hit:
            name_pattern = PII_VALUE_PATTERNS.get(name_hit)
            if name_pattern is None or not float(series.str.match(name_pattern).mean()) >= 0.5:
                value_hit = None
                match_ratio = 0.0

        if not name_hit and not value_hit:
            continue

        # Khớp cả tên cột lẫn giá trị -> tin cậy cao nhất.
        if name_hit and value_hit:
            method, pii_type = "heuristic+regex", value_hit
            confidence = round(min(0.99, 0.75 + 0.25 * match_ratio), 4)
            evidence = (
                f"Tên cột khớp mẫu '{name_hit}'; {match_ratio:.0%} giá trị mẫu khớp regex {value_hit}."
            )
        elif value_hit:
            method, pii_type = "regex", value_hit
            confidence = round(min(0.95, 0.55 + 0.4 * match_ratio), 4)
            evidence = f"{match_ratio:.0%} giá trị mẫu khớp regex {value_hit} (tên cột không gợi ý)."
        else:
            method, pii_type = "heuristic", name_hit or "unknown"
            confidence = 0.6
            evidence = f"Tên cột khớp mẫu '{name_hit}' nhưng giá trị không khớp regex nào."

        flags.append(
            {
                "column_name": str(col),
                "pii_type": pii_type,
                "detection_method": method,
                "confidence": confidence,
                "evidence": evidence,
            }
        )

    return flags


def detect_quasi_identifiers(df: pd.DataFrame, pii_columns: set[str]) -> list[str]:
    """Cột không phải PII nhưng ghép lại có rủi ro tái định danh."""
    out: list[str] = []
    for col in df.columns:
        name = str(col)
        if name in pii_columns:
            continue
        if re.search(QUASI_IDENTIFIER_PATTERNS, name.lower()):
            out.append(name)
    return out


# --------------------------------------------------------------------------- #
# Candidate key
# --------------------------------------------------------------------------- #
def find_candidate_keys(
    df: pd.DataFrame,
    stats: dict[str, dict[str, Any]],
    max_composite: int = 2,
) -> list[dict[str, Any]]:
    """Tìm candidate key: cột đơn unique 100% + null 0%, rồi thử tổ hợp 2 cột.

    Uniqueness/null tính bằng pandas (số thật), confidence suy ra từ đó —
    không có LLM tham gia.
    """
    n = len(df)
    if n == 0:
        return []

    proposals: list[dict[str, Any]] = []
    single_keys: list[str] = []

    for col, st in stats.items():
        uniqueness = st.get("uniqueness_ratio", 0.0)
        null_pct = st.get("null_pct", 100.0)
        if uniqueness >= 1.0 and null_pct == 0.0:
            single_keys.append(col)
            proposals.append(
                {
                    "columns": [col],
                    "confidence": 0.99,
                    "evidence": (
                        f"uniqueness = 100% ({st['cardinality']}/{n} giá trị phân biệt), null% = 0%."
                    ),
                }
            )
        elif uniqueness >= 0.98 and null_pct < 1.0:
            proposals.append(
                {
                    "columns": [col],
                    "confidence": round(0.5 + 0.4 * uniqueness, 4),
                    "evidence": (
                        f"uniqueness = {uniqueness:.2%}, null% = {null_pct:.2f}% "
                        f"— gần unique nhưng chưa tuyệt đối."
                    ),
                }
            )

    # Composite key: chỉ thử khi chưa có key đơn nào chắc chắn, tránh nổ tổ hợp.
    if not single_keys and max_composite >= 2:
        candidates = [
            c
            for c, st in sorted(
                stats.items(), key=lambda kv: kv[1].get("uniqueness_ratio", 0.0), reverse=True
            )
            if st.get("null_pct", 100.0) == 0.0
        ][:6]
        for i, a in enumerate(candidates):
            for b in candidates[i + 1 :]:
                combo = df[[a, b]].dropna()
                if combo.empty:
                    continue
                distinct = len(combo.drop_duplicates())
                ratio = distinct / len(combo)
                if ratio >= 0.999:
                    proposals.append(
                        {
                            "columns": [a, b],
                            "confidence": round(min(0.95, ratio), 4),
                            "evidence": (
                                f"Tổ hợp ({a}, {b}) có {distinct}/{len(combo)} "
                                f"= {ratio:.4%} giá trị phân biệt, không null."
                            ),
                        }
                    )

    proposals.sort(key=lambda p: p["confidence"], reverse=True)
    return proposals[:10]


# --------------------------------------------------------------------------- #
# Semantic type
# --------------------------------------------------------------------------- #
def _infer_semantic_type_base(column: str, st: dict[str, Any]) -> dict[str, Any]:
    """Suy luận semantic type bằng luật trên số liệu — deterministic, không LLM.

    LLM chỉ được dùng để tinh chỉnh trường hợp `confidence` thấp (xem node
    `propose_metadata`), và mỗi bảng gộp thành 1 lần gọi (Known Limitation L4).
    """
    dtype = str(st.get("dtype", ""))
    uniqueness = st.get("uniqueness_ratio", 0.0)
    cardinality = st.get("cardinality", 0)
    name = column.lower()

    if "datetime" in dtype or re.search(r"(_at$|_date$|date_|time)", name):
        return {"type": "datetime", "confidence": 0.9, "evidence": f"dtype = {dtype}, tên cột gợi ý thời gian."}

    if uniqueness >= 0.99 and (re.search(r"(_id$|^id$|_key$|uuid|code)", name) or "int" in dtype):
        return {
            "type": "ID",
            "confidence": 0.96,
            "evidence": f"uniqueness = {uniqueness:.2%}, tên cột/dtype mang dạng định danh.",
        }

    if "bool" in dtype or cardinality == 2:
        return {
            "type": "categorical",
            "confidence": 0.95,
            "evidence": f"chỉ có {cardinality} giá trị phân biệt (nhị phân).",
        }

    is_numeric = "float" in dtype or "int" in dtype

    # Số nguyên ít giá trị phân biệt (1..5, 0/1/2...) thường là thang đo thứ bậc.
    if "int" in dtype and 2 < cardinality <= 10:
        return {
            "type": "ordinal",
            "confidence": 0.75,
            "evidence": f"số nguyên với {cardinality} bậc giá trị — có thể là thang đo thứ bậc.",
        }

    if is_numeric:
        return {
            "type": "continuous",
            "confidence": 0.88 if "float" in dtype or uniqueness > 0.5 else 0.82,
            "evidence": f"dtype = {dtype}, cardinality = {cardinality}, uniqueness = {uniqueness:.2%}.",
        }

    if cardinality <= 20:
        return {
            "type": "categorical",
            "confidence": 0.9,
            "evidence": f"cardinality thấp ({cardinality} giá trị phân biệt).",
        }

    if st.get("max_length") and st["max_length"] > 80:
        return {
            "type": "free-text",
            "confidence": 0.8,
            "evidence": f"độ dài tối đa {st['max_length']} ký tự.",
        }

    # Chuỗi gần như unique (email, mã đơn, username) — categorical là sai vì
    # không có nhóm nào để gộp.
    if uniqueness >= 0.9:
        return {
            "type": "ID",
            "confidence": 0.78,
            "evidence": (
                f"chuỗi gần như duy nhất (uniqueness = {uniqueness:.2%}) — mang tính định danh "
                f"hơn là phân nhóm."
            ),
        }

    if uniqueness >= 0.5:
        return {
            "type": "free-text",
            "confidence": 0.7,
            "evidence": f"chuỗi đa dạng (uniqueness = {uniqueness:.2%}), không gộp nhóm được.",
        }

    return {
        "type": "categorical",
        "confidence": 0.65,
        "evidence": (
            f"cardinality = {cardinality}, uniqueness = {uniqueness:.2%} — nhiều giá trị lặp "
            f"nên nghiêng về phân nhóm, nhưng chưa chắc chắn."
        ),
    }


_BUSINESS_TERMS = {
    "invoice": "hóa đơn",
    "billing": "thanh toán",
    "bill": "hóa đơn",
    "order": "đơn hàng",
    "customer": "khách hàng",
    "user": "người dùng",
    "product": "sản phẩm",
    "shipment": "vận chuyển",
    "delivery": "giao hàng",
    "payment": "thanh toán",
    "employee": "nhân viên",
    "account": "tài khoản",
}
_TIME_TERMS = {
    "date": "ngày",
    "time": "thời điểm",
    "timestamp": "mốc thời gian",
    "created": "tạo",
    "updated": "cập nhật",
    "issued": "phát hành",
    "issue": "phát hành",
    "due": "đến hạn",
    "paid": "thanh toán",
}


def _column_tokens(column: str) -> list[str]:
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", column)
    return [token.lower() for token in re.split(r"[^A-Za-z0-9]+", spaced) if token]


def semantic_description(column: str, semantic_type: str, dtype: str) -> str:
    """Sinh mô tả nghiệp vụ có kiểm soát từ tên cột và dtype, không dùng LLM."""
    tokens = _column_tokens(column)
    business = [_BUSINESS_TERMS[token] for token in tokens if token in _BUSINESS_TERMS]
    temporal = [_TIME_TERMS[token] for token in tokens if token in _TIME_TERMS]

    if semantic_type == "datetime":
        if business and temporal:
            role = temporal[-1]
            return (
                f"Trường thời gian liên quan đến {business[-1]} ({role}); "
                "cần Analyst xác nhận đây là ngày lập, phát hành, ghi nhận hay đến hạn."
            )
        if business:
            return f"Trường thời gian liên quan đến {business[-1]}; cần xác nhận vai trò nghiệp vụ cụ thể."
        return f"Trường thời gian ({dtype}); chưa xác định được vai trò nghiệp vụ từ tên cột."
    if semantic_type == "ID" and business:
        return f"Mã định danh cho {business[-1]}."
    if semantic_type == "categorical" and business:
        return f"Thuộc tính phân loại liên quan đến {business[-1]}."
    return f"Semantic type được suy ra là {semantic_type} từ tên cột và thống kê dữ liệu."


def infer_semantic_type(column: str, st: dict[str, Any]) -> dict[str, Any]:
    """Suy luận semantic type và mô tả nghiệp vụ có thể giải thích được."""
    result = _infer_semantic_type_base(column, st)
    result["description"] = semantic_description(column, result["type"], str(st.get("dtype", "")))
    return result


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #
def profile_dataset(
    dataset_ref: str,
    scan_mode: ScanMode = "sample",
    sample_size: int = 10_000,
    sample_strategy: str = "reservoir",
    random_seed: int | None = 42,
    top_k: int = 10,
    outlier_method: str = "iqr",
    max_columns: int = 200,
) -> tuple[ProfileComputation, pd.DataFrame]:
    """Chạy trọn một lần profiling. Trả về (kết quả, dataframe để dùng tiếp)."""
    df, query, truncated = load_dataset(
        dataset_ref,
        scan_mode=scan_mode,
        sample_size=sample_size,
        sample_strategy=sample_strategy,
        random_seed=random_seed,
        max_columns=max_columns,
    )

    pii_flags = detect_pii(df)
    pii_columns = {f["column_name"] for f in pii_flags}

    stats = compute_column_stats(
        df,
        scan_mode=scan_mode,
        top_k=top_k,
        outlier_method=outlier_method,
        pii_columns=pii_columns,
    )

    result = ProfileComputation(
        row_count=len(df),
        column_names=[str(c) for c in df.columns],
        stats=stats,
        correlation_matrix=compute_correlation_matrix(df),
        pii_flags=pii_flags,
        quasi_identifiers=detect_quasi_identifiers(df, pii_columns),
        is_approximate=scan_mode == "sample",
        executed_query=query,
        random_seed=random_seed,
        truncated_columns=truncated,
    )
    return result, df


__all__ = [
    "ColumnStats",
    "ProfileComputation",
    "compute_column_stats",
    "compute_correlation_matrix",
    "detect_pii",
    "detect_quasi_identifiers",
    "find_candidate_keys",
    "infer_semantic_type",
    "load_dataset",
    "profile_dataset",
]
