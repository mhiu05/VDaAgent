"""Explicit deterministic QA fast-path registry.

Each entry is tied to an existing bounded read-only tool and is still passed
through ``validate_answer_evidence`` by the caller.  The registry intentionally
does not inspect rows, execute SQL, or cache natural-language answers.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Any, Callable

from src.agents.tools.registry import run_tool


def _plain(value: str) -> str:
    # ``đ`` does not decompose under NFD, so map it explicitly before
    # stripping Vietnamese combining marks (``đổi`` -> ``doi``).
    value = value.replace("đ", "d").replace("Đ", "D")
    normalized = unicodedata.normalize("NFD", value.casefold())
    normalized = "".join(char for char in normalized if unicodedata.category(char) != "Mn")
    return re.sub(r"[^a-z0-9%]+", " ", normalized).strip()


def _has_any(question: str, values: tuple[str, ...]) -> bool:
    return any(value in question for value in values)


@dataclass(frozen=True)
class FastPath:
    intent: str
    tool_name: str
    tool_args: dict[str, Any]
    matches: Callable[[str], bool]
    render: Callable[[dict[str, Any], str], tuple[str, list[dict[str, Any]]] | None]


def _overview_matches(question: str) -> bool:
    return _has_any(question, ("dataset overview", "profile overview", "tong quan du lieu"))


def _row_count_matches(question: str) -> bool:
    return _has_any(question, ("row count", "number of rows", "how many rows", "bao nhieu dong", "so dong"))


def _column_count_matches(question: str) -> bool:
    return _has_any(question, ("column count", "number of columns", "how many columns", "bao nhieu cot", "so cot"))


def _missingness_matches(question: str) -> bool:
    return _has_any(question, ("missing", "null", "thieu")) and _has_any(
        question, ("most", "highest", "top", "nhieu nhat", "cao nhat", "columns")
    )


def _duplicates_matches(question: str) -> bool:
    return _has_any(question, ("duplicate rows", "duplicate records", "duplicates", "dong trung", "ban ghi trung"))


def _category_ranking_matches(question: str) -> bool:
    """Recognize a highest-frequency category question without an LLM hop."""

    asks_for_highest = _has_any(
        question,
        ("cao nhat", "nhieu nhat", "highest", "most", "top category", "top group"),
    )
    asks_for_count = _has_any(
        question,
        ("so luong", "count", "frequency", "tan suat", "ban ghi", "records"),
    )
    return asks_for_highest and asks_for_count


def is_distribution_question(question: str) -> bool:
    """Recognize a concrete column-distribution request without an LLM hop."""

    normalized = _plain(question)
    return _has_any(normalized, ("distribution", "phan phoi", "tan suat"))


def _is_chart_recommendation(question: str) -> bool:
    return _has_any(
        question,
        ("bieu do", "chart", "visualization", "visualisation", "plot", "graph"),
    ) and _has_any(
        question,
        ("de xuat", "goi y", "nen dung", "recommend", "suggest", "which"),
    )


def _numeric_pair_insight_matches(question: str) -> bool:
    """Recognize a verifiable comparison request for two numeric columns."""

    return _has_any(question, ("so sanh", "compare", "comparison")) and _has_any(
        question,
        ("insight", "kiem chung", "profile run", "verify", "verifiable"),
    )


def _is_column_evidence_request(question: str) -> bool:
    return _has_any(
        question,
        ("bang chung", "dan chung", "evidence", "provenance", "profile run"),
    )


def _citation(
    citation_id: str,
    *,
    metric: str,
    value: float | int | str,
    unit: str | None = None,
    field: str | None = None,
    is_approximate: bool = False,
) -> dict[str, Any]:
    return {
        "citation_id": citation_id,
        "source_type": "tool",
        "metric": metric,
        "value": value,
        "unit": unit,
        "field": field,
        "is_approximate": is_approximate,
    }


def _render_overview(data: dict[str, Any], citation_id: str) -> tuple[str, list[dict[str, Any]]] | None:
    rows, columns = data.get("row_count"), data.get("column_count")
    if not isinstance(rows, int) or not isinstance(columns, int):
        return None
    text = f"Dataset đã profiling có {rows:,} dòng và {columns:,} cột. [{citation_id}]"
    return text, [{"text": text, "citations": [
        _citation(citation_id, metric="row_count", value=rows, unit="rows"),
        _citation(citation_id, metric="column_count", value=columns, unit="columns"),
    ]}]


def _render_row_count(data: dict[str, Any], citation_id: str) -> tuple[str, list[dict[str, Any]]] | None:
    value = data.get("row_count")
    if not isinstance(value, int):
        return None
    text = f"Profile Run có {value:,} dòng. [{citation_id}]"
    return text, [{"text": text, "citations": [_citation(citation_id, metric="row_count", value=value, unit="rows")]}]


def _render_column_count(data: dict[str, Any], citation_id: str) -> tuple[str, list[dict[str, Any]]] | None:
    value = data.get("column_count")
    if not isinstance(value, int):
        return None
    text = f"Profile Run có {value:,} cột. [{citation_id}]"
    return text, [{"text": text, "citations": [_citation(citation_id, metric="column_count", value=value, unit="columns")]}]


def _render_missingness(data: dict[str, Any], citation_id: str) -> tuple[str, list[dict[str, Any]]] | None:
    rows = data.get("per_column")
    if not isinstance(rows, list) or not rows:
        return None
    findings: list[dict[str, Any]] = []
    text_items: list[str] = []
    for row in rows[:5]:
        if not isinstance(row, dict):
            continue
        column, pct = row.get("column_name"), row.get("null_pct")
        if not isinstance(column, str) or not isinstance(pct, (int, float)):
            continue
        item = f"{column}: thiếu {pct:g}%"
        text_items.append(item)
        findings.append({"text": f"{item}. [{citation_id}]", "citations": [
            _citation(citation_id, metric="null_pct", value=float(pct), unit="percent", field=column),
        ]})
    if not text_items:
        return None
    text = "Các cột có tỷ lệ thiếu dữ liệu cao nhất là " + "; ".join(text_items) + f". [{citation_id}]"
    return text, findings


def _render_duplicates(data: dict[str, Any], citation_id: str) -> tuple[str, list[dict[str, Any]]] | None:
    value = data.get("duplicate_row_count")
    if not isinstance(value, int):
        return None
    text = f"Profile Run có {value:,} dòng trùng lặp. [{citation_id}]"
    return text, [{"text": text, "citations": [
        _citation(citation_id, metric="duplicate_row_count", value=value, unit="rows"),
    ]}]


def _render_category_ranking(
    data: dict[str, Any], citation_id: str
) -> tuple[str, list[dict[str, Any]]] | None:
    """Render the already-sorted first category from a persisted distribution."""

    column = data.get("column_name")
    values = data.get("values")
    if not isinstance(column, str) or not isinstance(values, list) or not values:
        return None
    leader = values[0]
    if not isinstance(leader, dict):
        return None
    category, count = leader.get("value"), leader.get("count")
    if not isinstance(category, str) or not isinstance(count, int) or isinstance(count, bool):
        return None
    text = (
        f"{category} là nhóm có số lượng cao nhất trong cột {column}: "
        f"{count:,} bản ghi. [{citation_id}]"
    )
    return text, [{"text": text, "citations": [
        _citation(
            citation_id,
            metric="frequency_count",
            value=count,
            unit="rows",
            field=column,
        ),
    ]}]


def _distribution_value(value: Any) -> str | None:
    """Format an aggregate category without inventing a value or precision."""

    if value is None:
        return "(trống)"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return format(value, "g")
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _render_distribution(
    data: dict[str, Any], citation_id: str
) -> tuple[str, list[dict[str, Any]]] | None:
    """Render a bounded persisted distribution with its evidence limits."""

    column = data.get("column_name")
    values = data.get("values")
    if not isinstance(column, str) or not isinstance(values, list) or not values:
        return None
    findings: list[dict[str, Any]] = []
    items: list[str] = []
    for row in values[:5]:
        if not isinstance(row, dict):
            continue
        value = _distribution_value(row.get("value"))
        count = row.get("count")
        if value is None or not isinstance(count, int) or isinstance(count, bool):
            continue
        item = f"`{value}`: {count:,} bản ghi"
        items.append(item)
        findings.append(
            {
                "text": f"{item}. [{citation_id}]",
                "citations": [
                    _citation(
                        citation_id,
                        metric="frequency_count",
                        value=count,
                        unit="rows",
                        field=column,
                    )
                ],
            }
        )
    if not items:
        return None
    text = (
        f"Phân phối đã lưu của cột {column} gồm các giá trị xuất hiện nhiều nhất: "
        + "; ".join(items)
        + f". Đây là các nhóm giá trị đã được profiling lưu lại, không phải toàn bộ dữ liệu thô. [{citation_id}]"
    )
    return text, findings


def _column_metric_request(question: str) -> tuple[str, str, str | None] | None:
    """Map an explicit one-column aggregate question to one persisted field."""

    patterns = (
        (("ty le thieu", "missing rate", "null rate"), "null_pct", "tỷ lệ thiếu", "percent"),
        (("bao nhieu gia tri thieu", "bao nhieu gia tri bi thieu", "bao nhieu gia tri trong", "null count", "missing count", "missingness"), "null_count", "số giá trị thiếu", "values"),
        (("ty le duy nhat", "uniqueness ratio"), "uniqueness_ratio", "tỷ lệ duy nhất", "percent"),
        (("bao nhieu gia tri phan biet", "bao nhieu nhom", "cardinality", "distinct count"), "cardinality", "số giá trị phân biệt", "values"),
        (("trung binh", "average", "mean"), "mean", "trung bình", None),
        (("trung vi", "median"), "median", "trung vị", None),
        (("do lech chuan", "standard deviation"), "std", "độ lệch chuẩn", None),
        (("gia tri nho nhat", "minimum", " min "), "min_value", "giá trị nhỏ nhất", None),
        (("gia tri lon nhat", "maximum", " max "), "max_value", "giá trị lớn nhất", None),
    )
    padded = f" {question} "
    for markers, field, label, unit in patterns:
        if any(marker in padded for marker in markers):
            return field, label, unit
    return None


def _column_is_unique_request(question: str) -> bool:
    """Recognize a boolean uniqueness question, not a percentage request."""

    return _has_any(
        question,
        (
            "duy nhat cho tung dong",
            "duy nhat tren tung dong",
            "duy nhat o moi dong",
            "unique for every row",
            "all values unique",
        ),
    )


def _render_column_is_unique(
    data: dict[str, Any], citation_id: str
) -> tuple[str, list[dict[str, Any]]] | None:
    column = data.get("column_name")
    ratio = data.get("uniqueness_ratio")
    null_count = data.get("null_count")
    if (
        not isinstance(column, str)
        or not isinstance(ratio, (int, float))
        or isinstance(ratio, bool)
    ):
        return None
    is_unique = float(ratio) == 1.0 and (
        null_count == 0 if isinstance(null_count, int) else True
    )
    conclusion = "Có" if is_unique else "Không"
    text = (
        f"{conclusion}. Cột {column} "
        + ("có giá trị duy nhất cho từng dòng" if is_unique else "không có giá trị duy nhất cho từng dòng")
        + f" trong Profile Run. [{citation_id}]"
    )
    return text, [
        {
            "text": text,
            "citations": [
                _citation(
                    citation_id,
                    metric="uniqueness_ratio",
                    value=float(ratio),
                    field=column,
                )
            ],
        }
    ]


def _render_column_metric(
    data: dict[str, Any],
    citation_id: str,
    *,
    field: str,
    label: str,
    unit: str | None,
) -> tuple[str, list[dict[str, Any]]] | None:
    column, value = data.get("column_name"), data.get(field)
    if not isinstance(column, str) or not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    display_value: float | int = value
    if field == "uniqueness_ratio":
        display_value = float(value) * 100
    suffix = "%" if unit == "percent" else ""
    if isinstance(display_value, int):
        rendered_value = f"{display_value:,}"
    else:
        rendered_value = f"{display_value:,.6f}".rstrip("0").rstrip(".")
    text = f"Cột {column} có {label} là {rendered_value}{suffix}. [{citation_id}]"
    return text, [{"text": text, "citations": [
        _citation(citation_id, metric=field, value=value, unit=unit, field=column),
    ]}]


def _render_column_evidence(
    data: dict[str, Any], citation_id: str
) -> tuple[str, list[dict[str, Any]]] | None:
    """Render one compact, objectively bindable fact for a named column."""

    column = data.get("column_name")
    if not isinstance(column, str):
        return None
    for field, label, unit in (
        ("null_count", "số giá trị thiếu", "values"),
        ("distinct_count", "số giá trị phân biệt", "values"),
        ("uniqueness_ratio", "tỷ lệ duy nhất", None),
    ):
        value = data.get(field)
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            continue
        rendered = f"{value:,}" if isinstance(value, int) else f"{float(value):.6g}"
        text = (
            f"Bằng chứng từ Profile Run: cột {column} có {label} là {rendered}. "
            f"[{citation_id}]"
        )
        return text, [{
            "text": text,
            "citations": [
                _citation(citation_id, metric=field, value=value, unit=unit, field=column)
            ],
        }]
    return None


def _render_correlation(
    data: dict[str, Any], citation_id: str
) -> tuple[str, list[dict[str, Any]]] | None:
    column_a, column_b, value = data.get("column_a"), data.get("column_b"), data.get("pearson_r")
    if not isinstance(column_a, str) or not isinstance(column_b, str) or not isinstance(value, (int, float)):
        return None
    text = (
        f"Hệ số tương quan Pearson giữa {column_a} và {column_b} là {float(value):.6g}. "
        f"Tương quan không chứng minh quan hệ nhân quả. [{citation_id}]"
    )
    return text, [{"text": text, "citations": [
        _citation(citation_id, metric="pearson_r", value=float(value), field=f"{column_a},{column_b}"),
    ]}]


def _render_outliers(
    data: dict[str, Any], citation_id: str
) -> tuple[str, list[dict[str, Any]]] | None:
    column, count = data.get("column_name"), data.get("outlier_count")
    if not isinstance(column, str) or not isinstance(count, int) or isinstance(count, bool):
        return None
    method = str(data.get("outlier_method") or "persisted profile")
    text = f"Cột {column} có {count:,} giá trị bất thường theo phương pháp {method}. [{citation_id}]"
    return text, [{"text": text, "citations": [
        _citation(citation_id, metric="outlier_count", value=count, unit="values", field=column),
    ]}]


def _drift_matches(question: str) -> bool:
    return _has_any(question, ("drift", "thay doi", "thay doi", "le ch", "shift"))


def _render_drift(
    data: dict[str, Any],
    citation_id: str,
    *,
    question: str = "",
    mentioned_columns: list[str] | None = None,
) -> tuple[str, list[dict[str, Any]]] | None:
    findings = data.get("findings")
    if not isinstance(findings, list):
        return None
    requested_column = (mentioned_columns or [None])[0]
    asks_top_category = _has_any(
        question,
        (
            "pho bien nhat",
            "nhieu nhat",
            "most common",
            "top category",
        ),
    )
    if asks_top_category:
        snapshot = next(
            (
                item
                for item in findings
                if isinstance(item, dict)
                and item.get("metric") == "top_category"
                and (
                    not requested_column
                    or item.get("column_name") == requested_column
                )
            ),
            None,
        )
        if snapshot:
            baseline_requested = bool(
                re.search(r"\b(?:drift\s*)?v1\b|\bbaseline\b", question)
            )
            side = "before" if baseline_requested else "after"
            value = snapshot.get(side)
            if value is not None:
                field = str(snapshot.get("column_name") or "")
                version = "baseline" if baseline_requested else "current"
                text = (
                    f"Giá trị phổ biến nhất của {field} ở phiên bản {version} "
                    f"là `{value}`. [{citation_id}]"
                )
                return text, [
                    {
                        "text": text,
                        "citations": [
                            _citation(
                                citation_id,
                                metric=f"top_category_{version}",
                                value=str(value),
                                field=field,
                            )
                        ],
                    }
                ]
    candidates = [
        item for item in findings
        if isinstance(item, dict) and item.get("before") is not None and item.get("after") is not None
    ]
    metric_markers = (
        (("so dong", "row count", "number of rows"), "row_count"),
        (("trung binh", "average", "mean"), "mean"),
        (("trung vi", "median"), "median"),
        (("ty le thieu", "missing", "null"), "null_pct"),
        (("cardinality", "phan biet", "distinct"), "cardinality"),
        (("do lech chuan", "standard deviation", "std"), "std"),
    )
    requested_metric = next(
        (metric for markers, metric in metric_markers if _has_any(question, markers)),
        None,
    )
    selected = next(
        (
            item for item in candidates
            if (not requested_column or item.get("column_name") == requested_column)
            and (not requested_metric or item.get("metric") == requested_metric)
        ),
        next(
            (item for item in candidates if not requested_column or item.get("column_name") == requested_column),
            candidates[0] if candidates else None,
        ),
    )
    if not selected:
        return None
    before, after = selected.get("before"), selected.get("after")
    if not isinstance(before, (int, float)) or not isinstance(after, (int, float)):
        return None
    metric = str(selected.get("metric") or selected.get("drift_type") or "change")
    change = float(after) - float(before)
    field = str(selected.get("column_name") or "")
    # Keep the public numeric claim to the requested delta.  The raw before /
    # after values remain in the citation payload, while emitting all three
    # numbers would make the fail-closed validator require three independent
    # metric bindings.
    rendered_change = f"{change:,.6f}".rstrip("0").rstrip(".")
    suffix = "%" if metric == "null_pct" else ""
    text = f"Metric {metric} của {field} thay đổi {rendered_change}{suffix}. [{citation_id}]"
    return text, [{"text": text, "citations": [_citation(citation_id, metric=f"{metric}_change", value=change, field=field)]}]


FAST_PATH_REGISTRY: tuple[FastPath, ...] = (
    FastPath("dataset_overview", "get_profile_overview", {}, _overview_matches, _render_overview),
    FastPath("row_count", "get_profile_overview", {}, _row_count_matches, _render_row_count),
    FastPath("column_count", "get_profile_overview", {}, _column_count_matches, _render_column_count),
    FastPath("missingness_ranking", "get_missingness_patterns", {"limit": 5}, _missingness_matches, _render_missingness),
    FastPath("duplicate_rows", "get_duplicate_analysis", {}, _duplicates_matches, _render_duplicates),
)


def resolve_fast_path(question: str) -> FastPath | None:
    normalized = _plain(question)
    return next((item for item in FAST_PATH_REGISTRY if item.matches(normalized)), None)


def is_fast_path_question(question: str, mentioned_columns: list[str] | None = None) -> bool:
    """Return whether the request is handled by the deterministic registry.

    ``resolve_fast_path`` covers the fixed registry entries.  The metric,
    correlation, outlier and drift handlers are parameterized, so the router
    needs the same capability check to avoid an unnecessary LLM classification
    hop before ``execute_fast_path`` gets a chance to run.
    """

    normalized = _plain(question)
    columns = mentioned_columns or []
    if _is_chart_recommendation(normalized):
        return False
    return bool(
        resolve_fast_path(question)
        or (is_distribution_question(normalized) and len(columns) == 1)
        or (_category_ranking_matches(normalized) and len(columns) == 1)
        or (_has_any(normalized, ("tuong quan", "correlation")) and len(columns) == 2)
        or (_numeric_pair_insight_matches(normalized) and len(columns) == 2)
        or (_has_any(normalized, ("bat thuong", "outlier", "cuc tri")) and len(columns) == 1)
        or (_drift_matches(normalized))
        or (_column_is_unique_request(normalized) and len(columns) == 1)
        or (_is_column_evidence_request(normalized) and len(columns) == 1)
        or (len(columns) == 1 and _column_metric_request(normalized) is not None)
    )


def execute_fast_path(
    *,
    question: str,
    profile_run_id: str,
    workspace_id: str | None,
    mentioned_columns: list[str] | None = None,
) -> dict[str, Any] | None:
    """Return one bounded tool result plus a deterministic answer, if supported."""

    normalized = _plain(question)
    if _is_chart_recommendation(normalized):
        return None
    # Drift wording takes precedence over ordinary row/column metric matches.
    spec = None if _drift_matches(normalized) else resolve_fast_path(question)
    if spec is not None:
        tool_name, tool_args, intent, render = (
            spec.tool_name,
            spec.tool_args,
            spec.intent,
            spec.render,
        )
    elif is_distribution_question(normalized) and len(mentioned_columns or []) == 1:
        tool_name, tool_args, intent, render = (
            "get_distribution",
            {"column_name": mentioned_columns[0], "limit": 5},
            "column_distribution",
            _render_distribution,
        )
    elif _category_ranking_matches(normalized) and len(mentioned_columns or []) == 1:
        tool_name, tool_args, intent, render = (
            "get_distribution",
            {"column_name": mentioned_columns[0], "limit": 1},
            "highest_frequency_category",
            _render_category_ranking,
        )
    elif (
        _has_any(normalized, ("tuong quan", "correlation"))
        or _numeric_pair_insight_matches(normalized)
    ) and len(mentioned_columns or []) == 2:
        tool_name, tool_args, intent, render = (
            "get_correlation",
            {"column_a": mentioned_columns[0], "column_b": mentioned_columns[1]},
            "column_correlation",
            _render_correlation,
        )
    elif _has_any(normalized, ("bat thuong", "outlier", "cuc tri")) and len(mentioned_columns or []) == 1:
        tool_name, tool_args, intent, render = (
            "get_outlier_summary",
            {"column_name": mentioned_columns[0]},
            "column_outliers",
            _render_outliers,
        )
    elif _column_is_unique_request(normalized) and len(mentioned_columns or []) == 1:
        tool_name, tool_args, intent, render = (
            "get_column_profile",
            {
                "column_name": mentioned_columns[0],
                "fields": ["uniqueness_ratio", "null_count"],
            },
            "column_is_unique",
            _render_column_is_unique,
        )
    elif len(mentioned_columns or []) == 1 and not _drift_matches(normalized) and (metric := _column_metric_request(normalized)):
        field, label, unit = metric
        tool_name, tool_args, intent, render = (
            "get_column_profile",
            {"column_name": mentioned_columns[0], "fields": [field]},
            f"column_{field}",
            lambda data, citation_id: _render_column_metric(
                data, citation_id, field=field, label=label, unit=unit
            ),
        )
    elif _is_column_evidence_request(normalized) and len(mentioned_columns or []) == 1:
        tool_name, tool_args, intent, render = (
            "get_column_profile",
            {"column_name": mentioned_columns[0]},
            "column_evidence",
            _render_column_evidence,
        )
    elif _drift_matches(normalized):
        tool_name, tool_args, intent, render = (
            "get_drift_findings",
            (
                {"column_name": mentioned_columns[0]}
                if len(mentioned_columns or []) == 1
                else {}
            ),
            "drift_metric_change",
            lambda data, citation_id: _render_drift(
                data,
                citation_id,
                question=normalized,
                mentioned_columns=mentioned_columns,
            ),
        )
    else:
        return None

    result = run_tool(tool_name, tool_args, profile_run_id=profile_run_id)
    if not isinstance(result, dict) or result.get("error") or result.get("error_code"):
        return None
    citation_id = "S1"
    rendered = render(result.get("data") or {}, citation_id)
    if rendered is None:
        return None
    answer, claims = rendered
    if intent == "drift_metric_change" and isinstance(result.get("data"), dict):
        for claim in claims:
            for citation in claim.get("citations") or []:
                metric = citation.get("metric") if isinstance(citation, dict) else None
                if isinstance(metric, str) and metric.endswith("_change"):
                    result["data"][metric] = citation.get("value")
    evidence = next(
        (item for item in result.get("evidence") or [] if isinstance(item, dict)),
        {},
    )
    is_approximate = bool(result.get("is_approximate"))
    sample_scope = "sample" if is_approximate else "full"
    for claim in claims:
        for citation in claim.get("citations") or []:
            if isinstance(citation, dict):
                citation.update({
                    "source_artifact": evidence.get("artifact"),
                    "profile_run_id": profile_run_id,
                    "sample_scope": sample_scope,
                    "is_approximate": is_approximate,
                })
    if is_approximate:
        answer += " Kết quả này là ước lượng vì Profile Run dùng dữ liệu mẫu."
    source = {
        "type": "tool",
        "citation_id": citation_id,
        "tool": tool_name,
        "args": tool_args,
        "status": "ok",
        "profile_run_id": profile_run_id,
        "workspace_id": workspace_id,
        "source_artifact": evidence.get("artifact"),
        "sample_scope": sample_scope,
        "is_approximate": is_approximate,
    }
    return {
        "intent": intent,
        "answer": answer,
        "claims": claims,
        "sources": [source],
        "tool_results": [{**result, "workspace_id": workspace_id}],
    }


__all__ = [
    "FAST_PATH_REGISTRY",
    "execute_fast_path",
    "is_fast_path_question",
    "is_distribution_question",
    "resolve_fast_path",
]
