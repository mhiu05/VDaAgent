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
_NUMBER_RE = re.compile(r"(?<![\w])\d+(?:[.,]\d+)?%?")


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


def _numeric_values(value: Any) -> list[float]:
    values: list[float] = []
    if isinstance(value, bool):
        return values
    if isinstance(value, (int, float)):
        values.append(float(value))
    elif isinstance(value, dict):
        for item in value.values():
            values.extend(_numeric_values(item))
    elif isinstance(value, list):
        for item in value[:50]:
            values.extend(_numeric_values(item))
    return values


def _answer_numbers(answer: str) -> list[float]:
    values: list[float] = []
    for match in _NUMBER_RE.finditer(answer):
        line_start = answer.rfind("\n", 0, match.start()) + 1
        prefix = answer[line_start : match.start()].strip()
        # Markdown list/heading numbering is structure, not a factual claim.
        if re.fullmatch(r"[#>*-]*", prefix) and answer[match.end() : match.end() + 1] in {".", ")"}:
            continue
        token = match.group(0).rstrip("%")
        try:
            values.append(float(token.replace(",", "")))
        except ValueError:
            continue
    return values


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
    evidence_numbers = [
        number
        for result in valid_results
        for number in _numeric_values(result.get("data"))
    ]
    if answer_numbers and evidence_numbers and any(
        not any(abs(number - observed) <= 1e-9 for observed in evidence_numbers)
        for number in answer_numbers
    ):
        return EvidenceValidation(False, "no_evidence", "unsupported_value")

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
