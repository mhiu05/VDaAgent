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


def test_percentage_rounding_is_allowed_but_wrong_unit_is_rejected() -> None:
    rounded = validate_answer_evidence(
        question="What percentage of sales values are null?",
        profile_run_id="run-1",
        sources=[_source()],
        tool_results=[_result(data={"null_pct": 18.37})],
        answer="18.4% [S1]",
    )
    bare_fraction = validate_answer_evidence(
        question="What percentage of sales values are null?",
        profile_run_id="run-1",
        sources=[_source()],
        tool_results=[_result(data={"null_pct": 18.37})],
        answer="0.184 [S1]",
    )
    labeled_fraction = validate_answer_evidence(
        question="What percentage of sales values are null?",
        profile_run_id="run-1",
        sources=[_source()],
        tool_results=[_result(data={"null_pct": 18.37})],
        answer="0.184 (fraction) [S1]",
    )

    assert rounded.valid is True
    assert bare_fraction.valid is False
    assert bare_fraction.reason == "unsupported_value_or_unit"
    assert labeled_fraction.valid is True


def test_percentage_denominator_pair_must_be_consistent() -> None:
    outcome = validate_answer_evidence(
        question="What percentage of sales values are null?",
        profile_run_id="run-1",
        sources=[_source()],
        tool_results=[_result(data={"null_count": 20, "row_count": 100, "null_pct": 18.4})],
        answer="18.4% [S1]",
    )

    assert outcome.valid is False
    assert outcome.reason == "inconsistent_percentage_denominator"


def test_sampled_numeric_answer_must_disclose_approximation() -> None:
    sampled = _result(data={"null_pct": 12.5})
    sampled["is_approximate"] = True
    missing_disclosure = validate_answer_evidence(
        question="What percentage of sales values are null?",
        profile_run_id="run-1",
        sources=[_source()],
        tool_results=[sampled],
        answer="12.5% [S1]",
    )
    disclosed = validate_answer_evidence(
        question="What percentage of sales values are null?",
        profile_run_id="run-1",
        sources=[_source()],
        tool_results=[sampled],
        answer="Approximately 12.5% based on the sample. [S1]",
    )

    assert missing_disclosure.valid is False
    assert missing_disclosure.reason == "approximation_not_disclosed"
    assert disclosed.valid is True


def test_time_or_filter_claim_needs_matching_scope_evidence() -> None:
    outcome = validate_answer_evidence(
        question="What was August sales missingness?",
        profile_run_id="run-1",
        sources=[_source()],
        tool_results=[_result(data={"null_pct": 12.5})],
        answer="August missingness was 12.5%. [S1]",
    )

    assert outcome.valid is False
    assert outcome.reason == "unsupported_time_or_filter_scope"
