"""Versioned answer presentation remains a projection of validated evidence."""

from __future__ import annotations

from src.models.schemas import AnswerProvenance
from src.services.chat_answer import build_answer_envelope


def test_structured_answer_retains_deterministic_claim_provenance() -> None:
    envelope = build_answer_envelope(
        answer="The Profile Run contains 10 rows. [S1]",
        sources=[{
            "type": "tool", "citation_id": "S1", "tool": "get_profile_overview",
            "status": "ok", "profile_run_id": "run-1",
        }],
        evidence_status="verified",
        is_approximate=False,
        provenance=AnswerProvenance(
            workspace_id="workspace-1", dataset_id="dataset-1", profile_run_id="run-1",
            scan_mode="full", agent_run_id="agent-1",
        ),
        deterministic_claims=[{
            "text": "The Profile Run contains 10 rows. [S1]",
            "citations": [{
                "citation_id": "S1", "source_type": "tool", "field": None,
                "metric": "row_count", "value": 10, "unit": "rows",
            }],
        }],
    )

    assert envelope.schema_version == "v2"
    assert envelope.evidence_status == "verified"
    assert envelope.provenance.profile_run_id == "run-1"
    assert envelope.findings[0].citations[0].value == 10
    assert envelope.findings[0].citations[0].metric == "row_count"


def test_no_evidence_envelope_does_not_upgrade_the_answer() -> None:
    envelope = build_answer_envelope(
        answer="I cannot safely conclude.",
        sources=[],
        evidence_status="no_evidence",
        is_approximate=False,
        provenance=AnswerProvenance(profile_run_id="run-1"),
    )

    assert envelope.evidence_status == "no_evidence"
    assert envelope.limitations
    assert envelope.actions
