"""Conditional deterministic second-pass verifier for Chat P2.

It is independent from graph routing and does not call another model.  The
existing numeric/evidence validator remains authoritative for deterministic
claims; this pass checks that the final public projection did not lose its
workspace/profile/citation bindings.  A verifier never invents replacement
facts or overrides deterministic evidence.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Any

_NUMBER = re.compile(r"(?<![\w-])\d+(?:[,.]\d+)?%?")
_CITATION = re.compile(r"\[S\d+\]", re.IGNORECASE)


@dataclass(frozen=True)
class VerificationDecision:
    risk_score: int
    signals: tuple[str, ...]
    should_run: bool
    valid: bool
    violations: tuple[str, ...]


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def evaluate_verifier_risk(
    *,
    answer: str,
    sources: list[dict[str, Any]],
    qa_path: str | None,
    is_approximate: bool,
    answer_detail: str,
    answerability: str,
    threshold: int,
) -> tuple[int, tuple[str, ...], bool]:
    signals: list[str] = []
    score = 0
    number_count = len(_NUMBER.findall(answer))
    if number_count:
        score += min(number_count, 3)
        signals.append("quantitative_claims")
    source_types = {str(source.get("type") or "") for source in sources if isinstance(source, dict)}
    if len(source_types) > 1:
        score += 2
        signals.append("mixed_evidence_classes")
    if "external_knowledge" in source_types:
        score += 2
        signals.append("external_dataset_synthesis")
    if is_approximate:
        score += 1
        signals.append("sampled_evidence")
    if qa_path in {"tool_llm", "retrieval_llm"}:
        score += 2
        signals.append("model_synthesis")
    if answer_detail == "deep":
        score += 1
        signals.append("deep_presentation")
    if answerability == "needs_clarification":
        score += 1
        signals.append("clarification_context")
    return score, tuple(signals), score >= threshold


def verify_public_projection(
    *,
    answer: str,
    sources: list[dict[str, Any]],
    workspace_id: str,
    profile_run_id: str | None,
    qa_path: str | None,
    is_approximate: bool,
    answer_detail: str,
    answerability: str,
    threshold: int,
) -> VerificationDecision:
    score, signals, should_run = evaluate_verifier_risk(
        answer=answer,
        sources=sources,
        qa_path=qa_path,
        is_approximate=is_approximate,
        answer_detail=answer_detail,
        answerability=answerability,
        threshold=threshold,
    )
    if not should_run:
        return VerificationDecision(score, signals, False, True, ())

    violations: list[str] = []
    if profile_run_id and not sources and answerability == "answerable":
        violations.append("missing_sources_for_profile_answer")
    for source in sources:
        if not isinstance(source, dict):
            violations.append("invalid_source_shape")
            continue
        source_workspace = source.get("workspace_id")
        if source_workspace is not None and source_workspace != workspace_id:
            violations.append("workspace_binding_mismatch")
        source_profile = source.get("profile_run_id")
        if source.get("type") in {"tool", "profile_report"} and profile_run_id and source_profile != profile_run_id:
            violations.append("profile_binding_mismatch")
    if _NUMBER.search(answer) and sources and not _CITATION.search(answer):
        # Numeric claims need an explicit public citation relationship. This
        # does not re-interpret values; the original validator already did so.
        violations.append("numeric_claim_without_public_citation")
    return VerificationDecision(score, signals, True, not violations, tuple(sorted(set(violations))))


def verification_payload(decision: VerificationDecision, *, mode: str) -> dict[str, Any]:
    return {
        "status": "not_eligible" if not decision.should_run else "passed" if decision.valid else "failed",
        "mode": mode,
        "risk_score": decision.risk_score,
        "risk_signals": list(decision.signals),
        "violations": list(decision.violations),
        "verifier_version": "p2-deterministic-v1",
    }


__all__ = ["VerificationDecision", "verify_public_projection", "verification_payload", "_digest"]
