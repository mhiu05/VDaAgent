"""Versioned, backend-authored presentation contracts for chat answers.

The evidence validator remains responsible for whether an answer may be
verified.  This module only projects that already-safe result into the
additive V2 presentation contract; it never upgrades an evidence status or
creates a source relationship that was not supplied by the answer/tool path.
"""

from __future__ import annotations

import re
from typing import Any

from src.models.schemas import (
    AnswerCitation,
    AnswerEnvelopeV2,
    AnswerFinding,
    AnswerProvenance,
)

_CITATION_RE = re.compile(r"\[(S\d+)\]", re.IGNORECASE)


def _source_type(source: dict[str, Any]) -> str | None:
    value = str(source.get("type") or "")
    return value if value in {"profile_report", "tool", "external_knowledge"} else None


def _citation_for(source: dict[str, Any], *, claim: str | None = None) -> AnswerCitation | None:
    source_type = _source_type(source)
    citation_id = str(source.get("citation_id") or "")
    if not source_type or not citation_id:
        return None
    return AnswerCitation(
        citation_id=citation_id,
        source_type=source_type,
        claim=claim,
        # Tool names are stable aggregate provenance labels. They are not
        # shown as a metric to users unless a deterministic renderer supplies
        # a stronger field/metric mapping below.
        metric=str(source.get("tool")) if source_type == "tool" and source.get("tool") else None,
        source_artifact=str(source.get("source_artifact")) if source.get("source_artifact") else None,
        source_field=str(source.get("source_field")) if source.get("source_field") else None,
        profile_run_id=str(source.get("profile_run_id")) if source.get("profile_run_id") else None,
        sample_scope=source.get("sample_scope") if source.get("sample_scope") in {"full", "sample"} else None,
        is_approximate=bool(source.get("is_approximate")),
    )


def _findings_from_answer(answer: str, sources: list[dict[str, Any]]) -> list[AnswerFinding]:
    """Keep only explicit ``[S#]`` relationships written by the backend path.

    Parsing a sentence that already contains a backend/model citation is a
    deterministic transport of that relationship.  The browser never guesses
    citations from proximity or source ordering.
    """

    source_by_id = {
        str(source.get("citation_id") or "").casefold(): source
        for source in sources
        if isinstance(source, dict)
    }
    findings: list[AnswerFinding] = []
    for raw in re.split(r"(?<=[.!?])\s+|\n+", answer):
        text = raw.strip()
        labels = _CITATION_RE.findall(text)
        if not text or not labels:
            continue
        citations = [
            citation
            for label in labels
            if (source := source_by_id.get(label.casefold())) is not None
            if (citation := _citation_for(source, claim=text)) is not None
        ]
        if citations:
            findings.append(AnswerFinding(text=text, citations=citations))
    return findings[:8]


def build_answer_envelope(
    *,
    answer: str,
    sources: list[dict[str, Any]],
    evidence_status: str,
    is_approximate: bool,
    provenance: AnswerProvenance,
    deterministic_claims: list[dict[str, Any]] | None = None,
    answer_detail: str = "standard",
    answerability: str = "answerable",
    clarification: dict[str, Any] | None = None,
) -> AnswerEnvelopeV2:
    """Build a V2 envelope without altering validated V1 content."""

    findings: list[AnswerFinding] = []
    for raw in deterministic_claims or []:
        if not isinstance(raw, dict) or not isinstance(raw.get("text"), str):
            continue
        citations: list[AnswerCitation] = []
        for raw_citation in raw.get("citations") or []:
            if not isinstance(raw_citation, dict):
                continue
            try:
                citations.append(AnswerCitation.model_validate(raw_citation))
            except (TypeError, ValueError):
                # A malformed optional presentation mapping must not affect a
                # validated answer or make the API fail.
                continue
        findings.append(AnswerFinding(text=raw["text"], citations=citations))
    if not findings:
        findings = _findings_from_answer(answer, sources)

    no_evidence = evidence_status == "no_evidence"
    allowed_detail = answer_detail if answer_detail in {"quick", "standard", "deep"} else "standard"
    allowed_answerability = (
        answerability
        if answerability in {"answerable", "needs_clarification", "insufficient_evidence"}
        else "insufficient_evidence" if no_evidence else "answerable"
    )
    # Quick is a presentation contract. It trims only the structured finding
    # list; sources, approximation, uncertainty, and the V1 answer remain
    # intact for compatibility and auditability.
    if allowed_detail == "quick":
        findings = findings[:3]
    return AnswerEnvelopeV2(
        summary=answer.strip() or None,
        findings=findings,
        limitations=(
            ["The available evidence does not support a safe conclusion."]
            if no_evidence
            else []
        ),
        actions=(
            ["Choose a completed Profile Run or run the required deterministic check, then ask again."]
            if no_evidence
            else []
        ),
        evidence_status=(
            evidence_status
            if evidence_status in {"verified", "profile_only", "no_evidence"}
            else "no_evidence"
        ),
        is_approximate=is_approximate,
        provenance=provenance,
        answer_detail=allowed_detail,
        answerability=allowed_answerability,
        clarification=clarification,
    )


__all__ = ["build_answer_envelope"]
