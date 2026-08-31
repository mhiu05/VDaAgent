from __future__ import annotations

from src.services.qa_validation import validate_answer_evidence


def _result(*, run_id: str = "run-1", artifact: str = "column_stats", data: dict | None = None) -> dict:
    return {
        "tool": "get_column_profile",
        "profile_run_id": run_id,
        "data": data or {"null_pct": 12.5},
        "evidence": [{"artifact": artifact, "run_version": 1}],
    }


def _source(*, run_id: str = "run-1", tool: str = "get_column_profile", status: str = "ok") -> dict:
    return {
        "type": "tool",
        "tool": tool,
        "status": status,
        "profile_run_id": run_id,
    }


def test_valid_evidence_is_verified() -> None:
    outcome = validate_answer_evidence(
        question="null_pct của sales là bao nhiêu?",
        profile_run_id="run-1",
        sources=[_source()],
        tool_results=[_result()],
        answer="12.5%",
    )
    assert outcome.valid is True
    assert outcome.evidence_status == "verified"


def test_missing_evidence_abstains() -> None:
    outcome = validate_answer_evidence(
        question="null_pct của sales là bao nhiêu?",
        profile_run_id="run-1",
        sources=[],
        tool_results=[],
        answer="12.5%",
    )
    assert outcome.valid is False
    assert outcome.evidence_status == "no_evidence"


def test_stale_or_wrong_source_is_rejected() -> None:
    outcome = validate_answer_evidence(
        question="null_pct của sales là bao nhiêu?",
        profile_run_id="run-1",
        sources=[_source(run_id="run-old")],
        tool_results=[_result()],
        answer="12.5%",
    )
    assert outcome.valid is False


def test_wrong_workspace_or_citation_source_is_rejected() -> None:
    result = {**_result(), "workspace_id": "workspace-a"}
    source = {**_source(), "workspace_id": "workspace-b"}

    workspace_outcome = validate_answer_evidence(
        question="null_pct của sales là bao nhiêu?",
        profile_run_id="run-1",
        sources=[source],
        tool_results=[result],
        answer="12.5%",
        workspace_id="workspace-a",
    )
    assert workspace_outcome.valid is False

    citation_outcome = validate_answer_evidence(
        question="null_pct của sales là bao nhiêu?",
        profile_run_id="run-1",
        sources=[_source(status="error"), _source()],
        tool_results=[_result()],
        answer="12.5% [S1]",
    )
    assert citation_outcome.valid is False


def test_wrong_artifact_source_is_rejected() -> None:
    outcome = validate_answer_evidence(
        question="null_pct của sales là bao nhiêu?",
        profile_run_id="run-1",
        sources=[_source()],
        tool_results=[_result(artifact="external_knowledge")],
        answer="12.5%",
    )
    assert outcome.valid is False


def test_unsupported_metric_abstains() -> None:
    outcome = validate_answer_evidence(
        question="mối quan hệ hồi quy giữa age và salary là gì?",
        profile_run_id="run-1",
        sources=[_source()],
        tool_results=[_result()],
        answer="Hệ số hồi quy là 0.4",
    )
    assert outcome.valid is False


def test_unsupported_value_abstains() -> None:
    outcome = validate_answer_evidence(
        question="null_pct của sales là bao nhiêu?",
        profile_run_id="run-1",
        sources=[_source()],
        tool_results=[_result()],
        answer="99.9%",
    )
    assert outcome.valid is False
