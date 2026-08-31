"""Deterministic validation for Q&A evidence and abstention.

Models may propose wording, but this module decides whether a factual answer
has a usable, run-scoped deterministic source.  It intentionally works on the
small tool envelopes produced by the registered QA tools and never inspects
raw rows or model reasoning.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Any


ABSTENTION_MESSAGE = (
    "Không có đủ evidence trong Profile Run để kết luận chắc chắn. "
    "Hãy chạy hoặc bổ sung kiểm tra deterministic phù hợp trước khi sử dụng kết quả."
)

_SUCCESS_STATUSES = frozenset({"ok", "completed", "success", "verified"})
_PROFILE_ARTIFACTS = frozenset(
    {
        "profile_runs",
        "column_stats",
        "correlation_matrix",
        "candidate_key_proposals",
        "semantic_type_proposals",
        "pii_proposals",
        "proposals",
        "stats_tests_allowlist",
        "statistical_test_results",
        "drift_reports",
    }
)
_CITATION_RE = re.compile(r"\[S(\d+)\]", re.IGNORECASE)
_NUMBER_RE = re.compile(r"(?<![\w])\d+(?:[.,]\d+)*(?:\s*(?:%|percent(?:age)?|phan\s+tram))?", re.IGNORECASE)
_PERCENT_SUFFIX_RE = re.compile(r"(?:%|percent(?:age)?|phan\s+tram)\s*$", re.IGNORECASE)
_FRACTION_CONTEXT_RE = re.compile(r"\b(?:fraction|ratio|proportion|ty\s*le)\b", re.IGNORECASE)
_APPROXIMATE_RE = re.compile(r"\b(?:approx(?:imate(?:ly)?)?|estimated|sampled?|uoc\s*tinh|mau)\b", re.IGNORECASE)
_TEMPORAL_CLAIM_RE = re.compile(
    r"\b(?:20\d{2}|q[1-4]|quarter|january|february|march|april|may|june|july|august|september|october|november|december|last\s+\d+\s+days?|thang\s*\d+|quy\s*[1-4])\b",
    re.IGNORECASE,
)
_FILTER_CLAIM_RE = re.compile(r"\b(?:where|filter(?:ed)?|cohort|segment|group|among|for\s+(?:customers|orders|users))\b", re.IGNORECASE)


@dataclass(frozen=True)
class EvidenceValidation:
    """Outcome of the final evidence check at the model trust boundary."""

    valid: bool
    evidence_status: str
    reason: str | None = None


def _plain(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value.casefold())
    normalized = "".join(
        char for char in normalized if unicodedata.category(char) != "Mn"
    )
    return re.sub(r"[^a-z0-9%]+", " ", normalized).strip()


def _flatten_keys(value: Any, prefix: str = "") -> set[str]:
    keys: set[str] = set()
    if isinstance(value, dict):
        for key, item in value.items():
            name = str(key).casefold()
            keys.add(name)
            keys.update(_flatten_keys(item, f"{prefix}.{name}"))
    elif isinstance(value, list):
        for item in value[:20]:
            keys.update(_flatten_keys(item, prefix))
    return keys


def _numeric_observations(value: Any, prefix: str = "") -> list[tuple[str, float]]:
    """Flatten evidence values while retaining the semantic source field."""

    values: list[tuple[str, float]] = []
    if isinstance(value, bool):
        return values
    if isinstance(value, (int, float)):
        values.append((prefix.casefold(), float(value)))
    elif isinstance(value, dict):
        for key, item in value.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            values.extend(_numeric_observations(item, path))
    elif isinstance(value, list):
        for index, item in enumerate(value[:50]):
            values.extend(_numeric_observations(item, f"{prefix}[{index}]"))
    return values


def _parse_localized_number(token: str) -> float | None:
    """Parse common thousands/decimal forms without equating units."""

    compact = re.sub(r"\s+", "", token)
    if not compact:
        return None
    if "," in compact and "." in compact:
        decimal = "," if compact.rfind(",") > compact.rfind(".") else "."
        thousands = "." if decimal == "," else ","
        compact = compact.replace(thousands, "").replace(decimal, ".")
    elif "," in compact:
        tail = compact.rsplit(",", 1)[1]
        compact = compact.replace(",", "") if len(tail) == 3 else compact.replace(",", ".")
    elif compact.count(".") > 1:
        tail = compact.rsplit(".", 1)[1]
        compact = compact.replace(".", "") if len(tail) == 3 else compact
    try:
        return float(compact)
    except ValueError:
        return None


def _answer_numbers(answer: str) -> list[tuple[float, bool, bool, int]]:
    """Return value/unit/precision without silently converting fractions."""

    values: list[tuple[float, bool, bool, int]] = []
    for match in _NUMBER_RE.finditer(answer):
        line_start = answer.rfind("\n", 0, match.start()) + 1
        prefix = answer[line_start : match.start()].strip()
        # Markdown list/heading numbering is structure, not a factual claim.
        if re.fullmatch(r"[#>*-]*", prefix) and answer[match.end() : match.end() + 1] in {".", ")"}:
            continue
        raw = match.group(0)
        is_percent = bool(_PERCENT_SUFFIX_RE.search(raw))
        nearby = answer[max(0, match.start() - 16) : match.end() + 36]
        is_fraction = not is_percent and bool(_FRACTION_CONTEXT_RE.search(nearby))
        token = _PERCENT_SUFFIX_RE.sub("", raw).strip()
        value = _parse_localized_number(token)
        if value is None:
            continue
        decimal = re.split(r"[.,]", token)[-1] if re.search(r"[.,]", token) else ""
        values.append((value, is_percent, is_fraction, len(decimal)))
    return values


def _metric_fields(question: str) -> tuple[str, ...]:
    """Map a materially specific question to evidence keys, fail-closed."""

    text = _plain(question)
    if any(token in text for token in ("null", "missing", "thieu")):
        return ("null_pct",) if any(token in text for token in ("pct", "percent", "phan tram", "ty le")) else ("null_pct", "null_count")
    if any(token in text for token in ("row", "dong", "record")):
        return ("row_count", "duplicate_row_count", "duplicate_row_rate")
    if any(token in text for token in ("column", "cot")):
        return ("column_count",)
    if any(token in text for token in ("average", "mean", "trung binh")):
        return ("mean",)
    if any(token in text for token in ("median", "trung vi")):
        return ("median",)
    if any(token in text for token in ("sum", "total", "tong")):
        return ("sum", "total")
    if "cardinality" in text:
        return ("cardinality",)
    if any(token in text for token in ("unique", "uniqueness", "candidate key", "khoa chinh")):
        return ("uniqueness_ratio", "candidate_key")
    return ()


def _rounding_matches(rendered: float, observed: float, decimals: int) -> bool:
    """Permit only the normal half-unit tolerance of the rendered precision."""

    tolerance = 0.5 * (10 ** -min(max(decimals, 0), 12)) + 1e-12
    return abs(rendered - observed) <= tolerance


def _numeric_claim_supported(
    claim: tuple[float, bool, bool, int], observations: list[tuple[str, float]], *, metric_fields: tuple[str, ...]
) -> bool:
    rendered, percent, fraction, decimals = claim
    candidates = [
        (path, value)
        for path, value in observations
        if not metric_fields or any(field in path for field in metric_fields)
    ]
    # Do not silently satisfy a requested metric with an unrelated count from
    # the same envelope.  A missing canonical field is a safe abstention.
    if metric_fields and not candidates:
        return False
    for path, observed in candidates:
        if percent:
            if any(token in path for token in ("_pct", "percent", "percentage")):
                expected = observed
            elif any(token in path for token in ("_ratio", "rate", "proportion")):
                expected = observed * 100.0
            else:
                continue
        elif fraction:
            if any(token in path for token in ("_pct", "percent", "percentage")):
                expected = observed / 100.0
            elif any(token in path for token in ("_ratio", "rate", "proportion")):
                expected = observed
            else:
                continue
        else:
            expected = observed
        if _rounding_matches(rendered, expected, decimals):
            return True
    return False


def _has_scope_metadata(result: dict[str, Any], *, temporal: bool, filtered: bool) -> bool:
    data = result.get("data")
    keys = _flatten_keys(data)
    source = result.get("evidence") or []
    source_keys = _flatten_keys(source)
    combined = keys | source_keys
    if temporal and not any(token in key for key in combined for token in ("time", "date", "period", "window", "month", "quarter")):
        return False
    if filtered and not any(token in key for key in combined for token in ("filter", "cohort", "segment", "group")):
        return False
    return True


def _percentage_denominators_are_consistent(result: dict[str, Any]) -> bool:
    """Validate canonical count/rate pairs when the tool returned both."""

    data = result.get("data")
    if not isinstance(data, dict):
        return True
    null_count, row_count, null_pct = data.get("null_count"), data.get("row_count"), data.get("null_pct")
    if not all(isinstance(value, (int, float)) and not isinstance(value, bool) for value in (null_count, row_count, null_pct)):
        return True
    if float(row_count) <= 0:
        return False
    return _rounding_matches(float(null_pct), 100.0 * float(null_count) / float(row_count), 6)


def _required_artifact(question: str) -> tuple[str, ...]:
    text = _plain(question)
    if any(token in text for token in ("candidate key", "khoa chinh", "unique key")):
        return ("candidate_key",)
    if any(token in text for token in ("quality", "van de", "missing", "null", "outlier")):
        # A null/outlier metric is served by column_stats; a broad quality
        # question must use the deterministic issue derivation.
        if "quality" in text or "van de" in text:
            return ("quality",)
        return ("column_stats",)
    if any(token in text for token in ("correlation", "tuong quan")):
        return ("correlation", "correlation_matrix")
    if any(token in text for token in ("regression", "hoi quy", "causal", "nhan qua")):
        return ("regression",)
    return ()


def _result_artifact(result: dict[str, Any]) -> str:
    evidence = result.get("evidence") or []
    if evidence and isinstance(evidence[0], dict):
        return str(evidence[0].get("artifact") or "")
    return ""


def _supports_requirement(result: dict[str, Any], requirement: str) -> bool:
    artifact = _result_artifact(result).casefold()
    tool = str(result.get("tool") or "").casefold()
    data = result.get("data")
    keys = _flatten_keys(data)
    if requirement == "candidate_key":
        return "candidate_key" in artifact or "candidate_key" in keys
    if requirement == "quality":
        return tool == "list_quality_issues" and artifact == "column_stats" and "issues" in keys
    if requirement in {"correlation", "correlation_matrix"}:
        return artifact == "correlation_matrix" and "pearson_r" in keys
    if requirement == "regression":
        return any(token in keys for token in ("regression", "coefficient", "r_squared", "slope"))
    if requirement == "column_stats":
        return artifact == "column_stats"
    return requirement.casefold() in artifact or requirement.casefold() in keys or tool in {
        "get_column_profile",
        "get_stat",
        "get_outlier_summary",
    }


def validate_answer_evidence(
    *,
    question: str,
    profile_run_id: str | None,
    sources: list[dict[str, Any]],
    tool_results: list[dict[str, Any]],
    answer: str,
    workspace_id: str | None = None,
) -> EvidenceValidation:
    """Validate source binding, provenance, status, and requested artifact.

    The check is deliberately fail-closed: a malformed, stale, errored, or
    unscoped tool result cannot make an answer ``verified``.
    """

    if not profile_run_id:
        return EvidenceValidation(False, "no_evidence", "profile_run_missing")
    if not answer.strip():
        return EvidenceValidation(False, "no_evidence", "empty_answer")
    if not sources or not tool_results:
        return EvidenceValidation(False, "no_evidence", "evidence_missing")

    valid_results: list[dict[str, Any]] = []
    for result in tool_results:
        if not isinstance(result, dict):
            continue
        # Every production tool envelope carries these fields.  Rejecting a
        # bare model-shaped dictionary prevents fake evidence from becoming a
        # verified answer.
        if (
            result.get("profile_run_id") != profile_run_id
            or workspace_id is not None
            and result.get("workspace_id") != workspace_id
            or result.get("error_code")
            or result.get("error")
            or not result.get("evidence")
        ):
            continue
        valid_results.append(result)
    if not valid_results:
        return EvidenceValidation(False, "no_evidence", "invalid_tool_evidence")

    valid_result_tools = {
        str(result.get("tool") or "").casefold() for result in valid_results
    }
    source_tools = set()
    valid_citation_ids: set[str] = set()
    for index, source in enumerate(sources, start=1):
        if not isinstance(source, dict) or source.get("type") != "tool":
            continue
        if source.get("profile_run_id") != profile_run_id:
            continue
        if workspace_id is not None and source.get("workspace_id") != workspace_id:
            continue
        if str(source.get("status") or "").casefold() not in _SUCCESS_STATUSES:
            continue
        tool = str(source.get("tool") or "").casefold()
        if tool not in valid_result_tools:
            continue
        source_tools.add(tool)
        valid_citation_ids.add(
            str(source.get("citation_id") or f"S{index}").casefold()
        )
    if not source_tools:
        return EvidenceValidation(False, "no_evidence", "source_binding_invalid")
    if not any(str(result.get("tool") or "").casefold() in source_tools for result in valid_results):
        return EvidenceValidation(False, "no_evidence", "source_tool_mismatch")

    answer_numbers = _answer_numbers(answer)
    observations = [
        observation
        for result in valid_results
        for observation in _numeric_observations(result.get("data"))
    ]
    metric_fields = _metric_fields(question)
    if answer_numbers and not observations:
        return EvidenceValidation(False, "no_evidence", "numeric_evidence_missing")
    if answer_numbers and any(
        not _numeric_claim_supported(claim, observations, metric_fields=metric_fields)
        for claim in answer_numbers
    ):
        return EvidenceValidation(False, "no_evidence", "unsupported_value_or_unit")

    temporal = bool(_TEMPORAL_CLAIM_RE.search(question) or _TEMPORAL_CLAIM_RE.search(answer))
    filtered = bool(_FILTER_CLAIM_RE.search(question) or _FILTER_CLAIM_RE.search(answer))
    if (temporal or filtered) and not all(
        _has_scope_metadata(result, temporal=temporal, filtered=filtered)
        for result in valid_results
    ):
        return EvidenceValidation(False, "no_evidence", "unsupported_time_or_filter_scope")
    if any(not _percentage_denominators_are_consistent(result) for result in valid_results):
        return EvidenceValidation(False, "no_evidence", "inconsistent_percentage_denominator")
    if any(bool(result.get("is_approximate")) for result in valid_results) and not _APPROXIMATE_RE.search(answer):
        return EvidenceValidation(False, "no_evidence", "approximation_not_disclosed")

    required = _required_artifact(question)
    if not required and not any(
        _result_artifact(result).casefold() in _PROFILE_ARTIFACTS
        for result in valid_results
    ):
        return EvidenceValidation(False, "no_evidence", "wrong_source")
    if required and not all(
        any(_supports_requirement(result, item) for result in valid_results)
        for item in required
    ):
        return EvidenceValidation(False, "no_evidence", "unsupported_metric")

    citations = [int(item) for item in _CITATION_RE.findall(answer)]
    if citations and any(f"s{item}" not in valid_citation_ids for item in citations):
        return EvidenceValidation(False, "no_evidence", "invalid_citation")
    return EvidenceValidation(True, "verified")


def insufficient_evidence_answer() -> str:
    """Return the stable, user-facing abstention response."""

    return ABSTENTION_MESSAGE


__all__ = [
    "ABSTENTION_MESSAGE",
    "EvidenceValidation",
    "insufficient_evidence_answer",
    "validate_answer_evidence",
]
