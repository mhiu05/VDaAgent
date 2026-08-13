"""Agent workflow orchestration around deterministic profiling results.

The workflow enriches a raw profile with governance metadata, masks PII, emits
trace events, creates HITL records, and produces a safe summary for the UI.
"""

from __future__ import annotations

from time import perf_counter

from src.agents.hitl import hitl_store
from src.agents.persistence import agent_repository
from src.agents.pii import mask_profile_columns
from src.agents.tracing import trace_store
from src.models.schemas import AgentRun, AgentRunSummary, AgentWorkflowStatus, ProfileResult


class ProfilingAgentWorkflow:
    def __init__(self, trace_service=None, hitl_service=None, repository=None) -> None:
        self.trace_store = trace_service or trace_store
        self.hitl_store = hitl_service or hitl_store
        self.repository = repository or agent_repository

    def complete_profile(self, profile: ProfileResult, user_id: str = "anonymous") -> ProfileResult:
        started = perf_counter()
        run = self.trace_store.start_run(profile.source.name, profile.source.type)
        run.metrics = {"user_id": user_id}
        self.repository.save_run(run)

        self.trace_store.add_event(
            run.run_id,
            event_type="workflow_step",
            component="agent_workflow",
            tool_name="ingest_source",
            input_summary=f"{profile.source.type}:{profile.source.name}",
            output_summary="Source accepted for governance workflow.",
        )
        self.trace_store.add_event(
            run.run_id,
            event_type="workflow_step",
            component="agent_workflow",
            tool_name="schema_inspection",
            input_summary="Profile schema summary only.",
            output_summary=f"{profile.dataset_summary.column_count} columns, {profile.dataset_summary.row_count} rows.",
        )

        with self.trace_store.span(run.run_id, "agent_tool", "pii_detection", "Column samples and top values"):
            masking = mask_profile_columns(profile.columns)

        with self.trace_store.span(run.run_id, "agent_tool", "hitl_proposal", "Governance-sensitive findings"):
            hitl_records = self.hitl_store.create_from_profile(run.run_id, profile)

        warning_count = profile.quality_summary.warning_count
        critical_count = profile.quality_summary.critical_count
        pii_findings = sum(len(column.pii_detection) for column in profile.columns)
        metrics = {
            "user_id": user_id,
            "profiling_runtime_ms": int((perf_counter() - started) * 1000),
            "rows_profiled": profile.dataset_summary.row_count,
            "columns_profiled": profile.dataset_summary.column_count,
            "null_findings_count": sum(1 for finding in profile.findings if "missing" in finding.message.lower() or "null" in finding.message.lower()),
            "pii_findings_count": pii_findings,
            "warnings_count": warning_count,
            "critical_count": critical_count,
            "hitl_pending_count": len(hitl_records),
            "hitl_approved_count": 0,
            "hitl_rejected_count": 0,
            "masked_values_count": masking.masked_value_count,
            "tool_success_rate": 1.0,
            "tool_error_rate": 0.0,
            "token_usage_prompt": None,
            "token_usage_completion": None,
        }
        finished_run = self.trace_store.finish_run(run.run_id, "completed", metrics)

        profile.agent_run = _build_run_summary(finished_run)
        profile.agent_status = AgentWorkflowStatus(
            run_id=run.run_id,
            status="completed",
            current_step="report_generation",
            steps=[
                "ingest_source",
                "inspect_schema",
                "select_profiling_plan",
                "run_profiling_tools",
                "detect_findings",
                "detect_pii",
                "create_hitl_items",
                "generate_report",
            ],
            safe_summary=(
                f"Profiled {profile.dataset_summary.row_count} rows and "
                f"{profile.dataset_summary.column_count} columns. "
                f"{pii_findings} PII signal(s) were detected and masked. "
                f"{len(hitl_records)} HITL decision(s) are pending."
            ),
        )
        profile.governance = {
            "pii_columns": masking.pii_columns,
            "masked_values_count": masking.masked_value_count,
            "hitl_pending_count": len(hitl_records),
            "trace_url": f"/monitoring/runs/{run.run_id}",
        }

        self.trace_store.add_event(
            run.run_id,
            event_type="workflow_step",
            component="agent_workflow",
            tool_name="report_generation",
            input_summary="Safe profile summary.",
            output_summary=profile.agent_status.safe_summary,
        )
        self.repository.save_profile_report(profile, user_id=user_id)
        return profile


def _build_run_summary(run: AgentRun) -> AgentRunSummary:
    return AgentRunSummary(
        run_id=run.run_id,
        trace_id=run.run_id,
        status=run.status,
        metrics=run.metrics,
    )
