"""Persistent human-in-the-loop service for governance decisions.

The store records candidates that the agent is not allowed to treat as trusted
metadata until a human reviewer approves them.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from src.agents.persistence import AgentRepository, agent_repository
from src.models.schemas import HitlDecisionRequest, HitlRecord, ProfileFinding, ProfileResult


class HitlStore:
    def __init__(self, repository: AgentRepository | None = None) -> None:
        self.repository = repository or agent_repository

    def create_from_profile(self, run_id: str, profile: ProfileResult) -> list[HitlRecord]:
        created: list[HitlRecord] = []
        for finding in profile.findings:
            hitl_type = _classify_finding(finding)
            if not hitl_type:
                continue
            record = HitlRecord(
                id=str(uuid4()),
                run_id=run_id,
                type=hitl_type,
                severity=finding.severity,
                source=profile.source.name,
                table=finding.column or profile.source.name,
                columns=[finding.column] if finding.column else [],
                evidence=finding.message,
                proposed_action=_proposed_action(hitl_type),
                status="pending",
                reviewer=None,
                reviewed_at=None,
                comment=None,
            )
            self.repository.save_hitl_record(record)
            created.append(record)
        return created

    def list_records(
        self,
        status: str | None = None,
        run_id: str | None = None,
        limit: int = 200,
        offset: int = 0,
    ) -> list[HitlRecord]:
        return self.repository.list_hitl_records(
            status=status,
            run_id=run_id,
            limit=limit,
            offset=offset,
        )

    def decide(self, record_id: str, status: str, request: HitlDecisionRequest) -> HitlRecord | None:
        record = self.repository.get_hitl_record(record_id)
        if not record:
            return None
        record.status = status
        record.reviewer = request.reviewer
        record.reviewed_at = datetime.now(UTC).isoformat()
        record.comment = request.comment
        saved = self.repository.save_hitl_record(record)
        self._update_run_metrics(record.run_id)
        return saved

    def _update_run_metrics(self, run_id: str) -> None:
        run = self.repository.get_run(run_id)
        if run is None:
            return
        records = self.repository.list_hitl_records(run_id=run_id, limit=500)
        run.metrics = {
            **run.metrics,
            "hitl_pending_count": sum(record.status == "pending" for record in records),
            "hitl_approved_count": sum(record.status == "approved" for record in records),
            "hitl_rejected_count": sum(record.status == "rejected" for record in records),
        }
        run.updated_at = datetime.now(UTC).isoformat()
        self.repository.save_run(run)


hitl_store = HitlStore()


def _classify_finding(finding: ProfileFinding) -> str | None:
    message = finding.message.lower()
    if "may contain" in message and "confidence" in message:
        return "possible_pii_column"
    if "identifier candidate" in message:
        return "possible_primary_key"
    if "identifier-like" in message and "duplicate" in message:
        return "duplicate_identifier"
    if "relationship" in message:
        return "relationship_candidate"
    if "invalid range" in message:
        return "invalid_range_assumption"
    return None


def _proposed_action(hitl_type: str) -> str:
    actions = {
        "possible_pii_column": "Confirm whether this column must be governed and masked in downstream reports.",
        "possible_primary_key": "Approve only if the column is a trusted key in the source system.",
        "duplicate_identifier": "Confirm whether duplicates are expected or indicate a data quality issue.",
        "relationship_candidate": "Approve only after validating the relationship with domain knowledge.",
        "invalid_range_assumption": "Confirm the accepted business range before enforcing a rule.",
    }
    return actions.get(hitl_type, "Review and approve or reject the agent proposal.")
