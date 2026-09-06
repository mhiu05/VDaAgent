"""Narrow, evidence-aware semantic cache for deterministic P2 chat intents.

"Semantic" here means a finite, deterministic intent equivalence class such
as ``how many rows`` / ``row count``. It does *not* use embedding similarity
to decide an answer is safe to reuse.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

from src.agents.fast_paths import execute_fast_path, resolve_fast_path
from src.services.qa_validation import validate_answer_evidence

_VALIDATOR_VERSION = "qa-validation-p1-v2"
_ELIGIBLE_INTENTS = frozenset({"dataset_overview", "row_count", "column_count", "duplicate_rows"})


@dataclass(frozen=True)
class CacheCandidate:
    key: str
    intent: str
    dimensions: dict[str, Any]
    exact_question_hash: str


def _hash(value: dict[str, Any]) -> str:
    rendered = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(rendered.encode("utf-8")).hexdigest()


def cache_candidate(
    *,
    question: str,
    workspace_id: str,
    profile_run: dict[str, Any] | None,
    profile_run_id: str | None,
    context_version_id: str | None,
    analysis_execution_id: str | None,
    answer_detail: str,
    has_history: bool,
) -> CacheCandidate | None:
    """Return a key only for a safe, context-independent intent."""

    spec = resolve_fast_path(question)
    if (
        not spec
        or spec.intent not in _ELIGIBLE_INTENTS
        or not profile_run_id
        or not profile_run
        or profile_run.get("status") != "completed"
        or has_history
        or analysis_execution_id
    ):
        return None
    dimensions = {
        "workspace_id": workspace_id,
        "profile_run_id": profile_run_id,
        # Completed runs are immutable, but include artifact/version identity
        # defensively so a restored or migrated record cannot inherit a cache.
        "profile_version": profile_run.get("version"),
        "source_content_sha256": profile_run.get("source_content_sha256"),
        "source_version": profile_run.get("source_version"),
        "scan_mode": profile_run.get("scan_mode"),
        "row_count": profile_run.get("row_count"),
        "context_version_id": context_version_id,
        "intent": spec.intent,
        "answer_detail": answer_detail,
        "tool_version": "fast-path-v1",
        "validator_version": _VALIDATOR_VERSION,
    }
    return CacheCandidate(
        key=_hash(dimensions),
        intent=spec.intent,
        dimensions=dimensions,
        exact_question_hash=_hash({"question": question.casefold().strip()}),
    )


def revalidate_cache_hit(
    *,
    cached: dict[str, Any],
    candidate: CacheCandidate,
    question: str,
    profile_run_id: str,
    workspace_id: str,
) -> dict[str, Any] | None:
    """Re-run the bounded aggregate tool before trusting a cache payload."""

    if (
        cached.get("intent") != candidate.intent
        or cached.get("dimensions") != candidate.dimensions
        or cached.get("validator_version") != _VALIDATOR_VERSION
    ):
        return None
    response = cached.get("response")
    if not isinstance(response, dict) or response.get("evidence_status") != "verified":
        return None
    fresh = execute_fast_path(question=question, profile_run_id=profile_run_id, workspace_id=workspace_id)
    if not fresh or fresh.get("intent") != candidate.intent or fresh.get("answer") != response.get("answer"):
        return None
    validation = validate_answer_evidence(
        question=question,
        profile_run_id=profile_run_id,
        sources=fresh.get("sources") or [],
        tool_results=fresh.get("tool_results") or [],
        answer=str(response.get("answer") or ""),
        workspace_id=workspace_id,
    )
    if not validation.valid or validation.evidence_status != "verified":
        return None
    # Use freshly acquired public source links; the cached response never gets
    # to resurrect an old source artifact or a different workspace binding.
    return {
        **response,
        "sources": fresh.get("sources") or [],
        "deterministic_claims": fresh.get("claims") or [],
        "cache_status": (
            "exact_hit"
            if response.get("question_hash") == candidate.exact_question_hash
            else "semantic_hit"
        ),
    }


def cache_response_payload(
    *,
    answer: str,
    sources: list[dict[str, Any]],
    evidence_status: str,
    question_type: str | None,
    deterministic_claims: list[dict[str, Any]] | None,
    answerability: str,
    clarification: dict[str, Any] | None,
    question_hash: str,
) -> dict[str, Any] | None:
    if evidence_status != "verified":
        return None
    return {
        "answer": answer,
        "sources": sources,
        "evidence_status": evidence_status,
        "question_type": question_type,
        "deterministic_claims": deterministic_claims or [],
        "answerability": answerability,
        "clarification": clarification,
        "question_hash": question_hash,
    }


__all__ = ["CacheCandidate", "cache_candidate", "cache_response_payload", "revalidate_cache_hit", "_VALIDATOR_VERSION"]
