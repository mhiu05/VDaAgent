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


def _citation(
    citation_id: str,
    *,
    metric: str,
    value: float | int,
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
    text = f"The profiled dataset has {rows:,} rows and {columns:,} columns. [{citation_id}]"
    return text, [{"text": text, "citations": [
        _citation(citation_id, metric="row_count", value=rows, unit="rows"),
        _citation(citation_id, metric="column_count", value=columns, unit="columns"),
    ]}]


def _render_row_count(data: dict[str, Any], citation_id: str) -> tuple[str, list[dict[str, Any]]] | None:
    value = data.get("row_count")
    if not isinstance(value, int):
        return None
    text = f"The Profile Run contains {value:,} rows. [{citation_id}]"
    return text, [{"text": text, "citations": [_citation(citation_id, metric="row_count", value=value, unit="rows")]}]


def _render_column_count(data: dict[str, Any], citation_id: str) -> tuple[str, list[dict[str, Any]]] | None:
    value = data.get("column_count")
    if not isinstance(value, int):
        return None
    text = f"The Profile Run contains {value:,} columns. [{citation_id}]"
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
        item = f"{column}: {pct:g}% missing"
        text_items.append(item)
        findings.append({"text": f"{item}. [{citation_id}]", "citations": [
            _citation(citation_id, metric="null_pct", value=float(pct), unit="percent", field=column),
        ]})
    if not text_items:
        return None
    text = "Columns with the most missing values are " + "; ".join(text_items) + f". [{citation_id}]"
    return text, findings


def _render_duplicates(data: dict[str, Any], citation_id: str) -> tuple[str, list[dict[str, Any]]] | None:
    value = data.get("duplicate_row_count")
    if not isinstance(value, int):
        return None
    text = f"The Profile Run has {value:,} duplicate rows. [{citation_id}]"
    return text, [{"text": text, "citations": [
        _citation(citation_id, metric="duplicate_row_count", value=value, unit="rows"),
    ]}]


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


def execute_fast_path(
    *, question: str, profile_run_id: str, workspace_id: str | None
) -> dict[str, Any] | None:
    """Return one bounded tool result plus a deterministic answer, if supported."""

    spec = resolve_fast_path(question)
    if spec is None:
        return None
    result = run_tool(spec.tool_name, spec.tool_args, profile_run_id=profile_run_id)
    if not isinstance(result, dict) or result.get("error") or result.get("error_code"):
        return None
    citation_id = "S1"
    rendered = spec.render(result.get("data") or {}, citation_id)
    if rendered is None:
        return None
    answer, claims = rendered
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
        answer += " This result is approximate because the Profile Run used a sample."
    source = {
        "type": "tool",
        "citation_id": citation_id,
        "tool": spec.tool_name,
        "args": spec.tool_args,
        "status": "ok",
        "profile_run_id": profile_run_id,
        "workspace_id": workspace_id,
        "source_artifact": evidence.get("artifact"),
        "sample_scope": sample_scope,
        "is_approximate": is_approximate,
    }
    return {
        "intent": spec.intent,
        "answer": answer,
        "claims": claims,
        "sources": [source],
        "tool_results": [{**result, "workspace_id": workspace_id}],
    }


__all__ = ["FAST_PATH_REGISTRY", "execute_fast_path", "resolve_fast_path"]
