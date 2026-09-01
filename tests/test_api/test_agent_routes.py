"""Public agent trace routes must project repository rows before validation."""

from __future__ import annotations

from datetime import UTC, datetime

from src.agents.runtime.schemas import AgentRunRecord, TraceEventRecord
from src.api.agent_routes import _public_record


def test_public_agent_run_projection_drops_internal_repository_fields() -> None:
    run = {
        "id": "run-1",
        "run_type": "qa",
        "status": "failed",
        "workspace_id": "workspace-1",
        "runtime_version": "runtime-1",
        "policy_version": "policy-1",
        "created_at": datetime.now(UTC),
        "idempotency_key": "internal-idempotency-key",
        "request_hash": "sha256:internal-request-hash",
        "updated_at": datetime.now(UTC),
    }

    projected = _public_record(run, AgentRunRecord)

    assert "idempotency_key" not in projected
    assert "request_hash" not in projected
    assert "updated_at" not in projected
    assert AgentRunRecord(**projected).id == "run-1"


def test_public_trace_projection_drops_workspace_only_storage_fields() -> None:
    event = {
        "id": "event-1",
        "agent_run_id": "run-1",
        "sequence": 1,
        "event_type": "run",
        "payload": {"request_hash": "safe-to-redact"},
        "created_at": datetime.now(UTC),
        "workspace_id": "workspace-1",
        "schema_version": "1",
    }

    projected = _public_record(event, TraceEventRecord)

    assert "workspace_id" not in projected
    assert "schema_version" not in projected
    assert TraceEventRecord(**projected).payload["request_hash"] == "safe-to-redact"
