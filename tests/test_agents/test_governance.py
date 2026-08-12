from pathlib import Path
from uuid import uuid4

from src.agents.chat import ChatStore
from src.agents.hitl import HitlStore
from src.agents.persistence import AgentRepository
from src.agents.pii import mask_value
from src.agents.tracing import TraceStore
from src.agents.workflow import ProfilingAgentWorkflow
from src.models.schemas import (
    ColumnProfile,
    DatasetSummary,
    HitlDecisionRequest,
    PiiDetection,
    ProfileMetadata,
    ProfileRelationships,
    ProfileResult,
    ProfileSource,
    QualitySummary,
)


def test_mask_value_redacts_email():
    assert mask_value("john.doe@example.com", "email") == "jo***@example.com"


def test_agent_workflow_masks_pii_and_adds_governance():
    profile = ProfileResult(
        profile_metadata=ProfileMetadata(generated_at="2026-08-12T00:00:00+00:00"),
        source=ProfileSource(name="customers.csv", type="file"),
        dataset_summary=DatasetSummary(row_count=2, column_count=1),
        columns=[
            ColumnProfile(
                name="email",
                data_type="VARCHAR",
                null_count=0,
                distinct_count=2,
                sample_values=["john.doe@example.com", "jane@example.com"],
                pii_detection=[
                    PiiDetection(
                        pii_type="email",
                        confidence=1.0,
                        reason="Sampled values match email pattern.",
                    )
                ],
            )
        ],
        relationships=ProfileRelationships(),
        findings=[],
        quality_summary=QualitySummary(),
    )

    repository = AgentRepository(_database_path("workflow"))
    result = ProfilingAgentWorkflow(
        trace_service=TraceStore(repository),
        hitl_service=HitlStore(repository),
    ).complete_profile(profile)

    assert result.agent_run is not None
    assert result.agent_status is not None
    assert result.governance["masked_values_count"] == 2
    assert "john.doe@example.com" not in result.columns[0].sample_values
    assert result.columns[0].sample_values[0] == "jo***@example.com"


def test_hitl_store_creates_pii_record_from_finding():
    profile = ProfileResult(
        profile_metadata=ProfileMetadata(generated_at="2026-08-12T00:00:00+00:00"),
        source=ProfileSource(name="customers.csv", type="file"),
        dataset_summary=DatasetSummary(row_count=1, column_count=1),
        columns=[],
        relationships=ProfileRelationships(),
        findings=[
            {
                "severity": "warning",
                "column": "email",
                "message": "Column 'email' may contain email (100% confidence).",
            }
        ],
        quality_summary=QualitySummary(warning_count=1),
    )

    repository = AgentRepository(_database_path("governance"))
    trace_store = TraceStore(repository)
    run = trace_store.start_run("customers.csv", "file")
    records = HitlStore(repository).create_from_profile(run.run_id, profile)

    assert len(records) == 1
    assert records[0].type == "possible_pii_column"
    assert records[0].status == "pending"
    decided = HitlStore(repository).decide(
        records[0].id,
        "approved",
        HitlDecisionRequest(reviewer="tester"),
    )
    assert decided.status == "approved"
    assert repository.get_run(run.run_id).metrics["hitl_approved_count"] == 1


def test_agent_state_and_chat_survive_repository_restart():
    database_path = _database_path("agent-state")
    first_repository = AgentRepository(database_path)
    first_trace_store = TraceStore(first_repository)
    first_hitl_store = HitlStore(first_repository)
    first_chat_store = ChatStore(first_repository)

    run = first_trace_store.start_run("customers.csv", "file")
    first_trace_store.add_event(
        run.run_id,
        event_type="tool_call",
        component="test",
        tool_name="schema_inspection",
        input_summary="One schema summary.",
    )
    first_hitl_store.create_from_profile(run.run_id, _pii_profile())
    conversation = first_chat_store.create_conversation("user-1", "Customer review")
    first_chat_store.add_message(
        conversation.id,
        "user",
        "Contact john.doe@example.com about this profile",
        run_id=run.run_id,
    )

    restarted_repository = AgentRepository(database_path)
    assert restarted_repository.get_run(run.run_id) is not None
    assert len(restarted_repository.list_trace_events(run.run_id)) == 1
    assert len(restarted_repository.list_hitl_records(run_id=run.run_id)) == 1
    messages = restarted_repository.list_chat_messages(conversation.id)
    assert len(messages) == 1
    assert "john.doe@example.com" not in messages[0].content
    assert "jo***@example.com" in messages[0].content


def _pii_profile():
    return ProfileResult(
        profile_metadata=ProfileMetadata(generated_at="2026-08-12T00:00:00+00:00"),
        source=ProfileSource(name="customers.csv", type="file"),
        dataset_summary=DatasetSummary(row_count=1, column_count=1),
        columns=[],
        relationships=ProfileRelationships(),
        findings=[
            {
                "severity": "warning",
                "column": "email",
                "message": "Column 'email' may contain email (100% confidence).",
            }
        ],
        quality_summary=QualitySummary(warning_count=1),
    )


def _database_path(prefix: str) -> Path:
    return Path("data") / f"test-{prefix}-{uuid4()}.db"
