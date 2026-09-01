"""Focused P2 chat persistence, cache, verifier, and suggestion guarantees."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, select, update

from src.models.schemas import ChatFeedbackRequest
from src.services import chat_cache
from src.services.chat_cache import cache_candidate, cache_response_payload, revalidate_cache_hit
from src.services.chat_suggestions import generate_contextual_suggestions
from src.services.chat_verifier import verify_public_projection
from src.services.repository import Repository, conversations, evaluation_candidates


def _repository() -> Repository:
    return Repository(engine=create_engine("sqlite:///:memory:"))


def test_conversation_turn_is_workspace_scoped_and_keeps_its_first_context() -> None:
    repository = _repository()
    conversation = repository.create_conversation(
        workspace_id="workspace-a", actor_user_id="analyst-a", conversation_id="conversation-a"
    )
    first_snapshot = {"profile_run_id": "run-a", "row_scope": "full"}
    repository.start_conversation_turn(
        conversation_id=conversation["id"],
        workspace_id="workspace-a",
        actor_user_id="analyst-a",
        request_id="request-a",
        user_message_id="user-message-a",
        assistant_message_id="assistant-message-a",
        question="How many rows are in this Profile Run?",
        context_snapshot=first_snapshot,
        profile_run_id="run-a",
        dataset_id=None,
    )

    assert repository.get_conversation(conversation["id"], workspace_id="workspace-b") is None
    with pytest.raises(LookupError):
        repository.get_conversation_messages(conversation["id"], workspace_id="workspace-b")

    assert repository.complete_conversation_message(
        "assistant-message-a",
        workspace_id="workspace-a",
        agent_run_id="agent-run-a",
        text="The Profile Run contains 12 rows. [S1]",
        answer_envelope={"schema_version": "v2", "evidence_status": "verified"},
        context_snapshot={"profile_run_id": "run-b"},
    )
    # Completion is intentionally one-way. It must not overwrite the context
    # captured when the turn began or a completed answer itself.
    assert not repository.complete_conversation_message(
        "assistant-message-a",
        workspace_id="workspace-a",
        agent_run_id="agent-run-a",
        text="A different answer",
        answer_envelope=None,
        context_snapshot={"profile_run_id": "run-c"},
    )

    messages, next_before = repository.get_conversation_messages(
        conversation["id"], workspace_id="workspace-a"
    )
    assert next_before is None
    assert [item["id"] for item in messages] == ["user-message-a", "assistant-message-a"]
    assert messages[-1]["text"] == "The Profile Run contains 12 rows. [S1]"
    assert messages[-1]["context_snapshot"] == first_snapshot
    assert repository.get_conversation(conversation["id"], workspace_id="workspace-a")["title"].startswith("How many rows")  # type: ignore[index]


def test_feedback_is_idempotent_and_soft_deleted_history_can_expire() -> None:
    repository = _repository()
    conversation = repository.create_conversation(
        workspace_id="workspace-a", actor_user_id="analyst-a", conversation_id="conversation-a"
    )
    feedback, created = repository.record_conversation_feedback(
        workspace_id="workspace-a",
        actor_user_id="analyst-a",
        agent_run_id="agent-run-a",
        message_id="legacy-message-a",
        polarity="not_helpful",
        reason_code="bad_citation",
        metadata_payload={"intent": "row_count", "evidence_status": "verified"},
    )
    assert created is True
    same_feedback, created_again = repository.record_conversation_feedback(
        workspace_id="workspace-a",
        actor_user_id="analyst-a",
        agent_run_id="agent-run-a",
        message_id="legacy-message-a",
        polarity="helpful",
        reason_code=None,
        metadata_payload={"intent": "row_count", "evidence_status": "verified"},
    )
    assert created_again is False
    assert same_feedback["id"] == feedback["id"]
    assert repository.feedback_analytics(workspace_id="workspace-a")["helpful"] == 1
    with repository.engine.connect() as connection:
        candidate = connection.execute(
            select(evaluation_candidates.c.case_spec).where(
                evaluation_candidates.c.feedback_id == feedback["id"]
            )
        ).scalar_one()
    assert candidate == {
        "intent": "row_count", "execution_path": None, "evidence_status": "verified",
        "answer_detail": None, "reason_code": "bad_citation", "source": "user_feedback",
    }
    assert "question" not in candidate and "answer" not in candidate

    assert repository.soft_delete_conversation(conversation["id"], workspace_id="workspace-a")
    with repository.engine.begin() as connection:
        connection.execute(
            update(conversations)
            .where(conversations.c.id == conversation["id"])
            .values(deleted_at=datetime.now(UTC) - timedelta(days=31))
        )
    assert repository.purge_expired_deleted_conversations(retention_days=30) == 1
    assert repository.get_conversation(conversation["id"], workspace_id="workspace-a", include_deleted=True) is None


def _completed_profile() -> dict[str, object]:
    return {
        "status": "completed",
        "version": 3,
        "source_content_sha256": "sha256-a",
        "source_version": "dataset-v3",
        "scan_mode": "full",
        "row_count": 12,
    }


def test_semantic_cache_never_crosses_dimensions_and_revalidates(monkeypatch: pytest.MonkeyPatch) -> None:
    exact = cache_candidate(
        question="How many rows are in this dataset?",
        workspace_id="workspace-a",
        profile_run=_completed_profile(),
        profile_run_id="run-a",
        context_version_id="context-a",
        analysis_execution_id=None,
        answer_detail="standard",
        has_history=False,
    )
    semantic = cache_candidate(
        question="What is the row count?",
        workspace_id="workspace-a",
        profile_run=_completed_profile(),
        profile_run_id="run-a",
        context_version_id="context-a",
        analysis_execution_id=None,
        answer_detail="standard",
        has_history=False,
    )
    other_workspace = cache_candidate(
        question="How many rows are in this dataset?",
        workspace_id="workspace-b",
        profile_run=_completed_profile(),
        profile_run_id="run-a",
        context_version_id="context-a",
        analysis_execution_id=None,
        answer_detail="standard",
        has_history=False,
    )
    assert exact and semantic and other_workspace
    assert exact.key == semantic.key
    assert exact.key != other_workspace.key

    answer = "The Profile Run contains 12 rows. [S1]"
    cached = {
        "intent": exact.intent,
        "dimensions": exact.dimensions,
        "validator_version": chat_cache._VALIDATOR_VERSION,
        "response": cache_response_payload(
            answer=answer,
            sources=[{"type": "tool", "citation_id": "S1", "profile_run_id": "run-a", "workspace_id": "workspace-a"}],
            evidence_status="verified",
            question_type="fact",
            deterministic_claims=[],
            answerability="answerable",
            clarification=None,
            question_hash=exact.exact_question_hash,
        ),
    }
    monkeypatch.setattr(chat_cache, "execute_fast_path", lambda **_: {
        "intent": "row_count", "answer": answer, "claims": [],
        "sources": [{"type": "tool", "citation_id": "S1", "profile_run_id": "run-a", "workspace_id": "workspace-a"}],
        "tool_results": [],
    })
    monkeypatch.setattr(
        chat_cache, "validate_answer_evidence", lambda **_: SimpleNamespace(valid=True, evidence_status="verified")
    )
    result = revalidate_cache_hit(
        cached=cached, candidate=semantic, question="What is the row count?",
        profile_run_id="run-a", workspace_id="workspace-a",
    )
    assert result and result["cache_status"] == "semantic_hit"


def test_verifier_flags_cross_tenant_high_risk_projection() -> None:
    decision = verify_public_projection(
        answer="The result is 12 rows.",
        sources=[{"type": "tool", "profile_run_id": "run-b", "workspace_id": "workspace-b"}],
        workspace_id="workspace-a",
        profile_run_id="run-a",
        qa_path="retrieval_llm",
        is_approximate=False,
        answer_detail="deep",
        answerability="answerable",
        threshold=3,
    )
    assert decision.should_run is True
    assert decision.valid is False
    assert {"workspace_binding_mismatch", "profile_binding_mismatch", "numeric_claim_without_public_citation"} <= set(decision.violations)


def test_suggestions_are_profile_scoped_and_omit_confirmed_pii() -> None:
    class SuggestionRepository:
        def get_profile_run(self, run_id: str, *, workspace_id: str):
            assert (run_id, workspace_id) == ("run-a", "workspace-a")
            return {"status": "completed"}

        def pending_count(self, run_id: str) -> int:
            return 0

        def get_column_stats(self, run_id: str):
            return {
                "email": {"dtype": "string", "null_pct": 99},
                "revenue": {"dtype": "float64", "null_pct": 14},
            }

        def confirmed_pii_columns(self, run_id: str):
            return ["email"]

        def get_proposals(self, run_id: str, *, kind: str):
            return {"candidate_key": [{"column_name": "email"}]}

    suggestions = generate_contextual_suggestions(
        SuggestionRepository(), workspace_id="workspace-a", profile_run_id="run-a"
    )
    assert 2 <= len(suggestions) <= 4
    assert any(item.question == "Hiển thị phân phối của cột revenue." for item in suggestions)
    assert all("Show the distribution" not in item.question for item in suggestions)
    assert all("email" not in item.question.casefold() for item in suggestions)
    assert all("email" not in item.referenced_columns for item in suggestions)


def test_feedback_reason_codes_are_bounded() -> None:
    assert ChatFeedbackRequest(agent_run_id="run", message_id="message", polarity="not_helpful", reason_code="bad_citation").reason_code == "bad_citation"
    with pytest.raises(ValueError):
        ChatFeedbackRequest(agent_run_id="run", message_id="message", polarity="not_helpful", reason_code="unreviewed_reason")
