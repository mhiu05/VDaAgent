"""Tenant-scoped, public-safe execution trace API.

These generic endpoints are intentionally unavailable to Viewer. Published
reports will use a narrower provenance projection in a later rollout.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from src.agents.runtime.schemas import (
    AgentRunRecord,
    CanonicalEvidence,
    TraceEventRecord,
    TraceSummary,
)
from src.agents.runtime.trace import redact_trace_payload
from src.api.dependencies import RequestContext, require_permission
from src.config import get_settings
from src.services.permissions import AGENT_RUN_READ, AGENT_TRACE_READ
from src.services.repository import get_repository

router = APIRouter(tags=["agent-runtime"])
_agent_run_read = Depends(require_permission(AGENT_RUN_READ))
_agent_trace_read = Depends(require_permission(AGENT_TRACE_READ))


def _run_or_404(run_id: str, context: RequestContext) -> dict[str, Any]:
    run = get_repository().get_agent_run(run_id, workspace_id=context.workspace_id)
    if not run:
        # Do not reveal whether an ID belongs to another workspace.
        raise HTTPException(
            status_code=404, detail="Không tìm thấy agent run trong workspace."
        )
    return run


@router.get("/agent-runs/{run_id}", response_model=AgentRunRecord)
async def get_agent_run(
    run_id: str,
    context: RequestContext = _agent_run_read,
) -> AgentRunRecord:
    return AgentRunRecord(**_run_or_404(run_id, context))


@router.get("/agent-runs/{run_id}/trace", response_model=list[TraceEventRecord])
async def get_agent_trace(
    run_id: str,
    after_sequence: int = Query(default=0, ge=0),
    limit: int | None = Query(default=None, ge=1, le=2_000),
    context: RequestContext = _agent_trace_read,
) -> list[TraceEventRecord]:
    _run_or_404(run_id, context)
    events = get_repository().list_agent_trace_events(
        run_id,
        workspace_id=context.workspace_id,
        after_sequence=after_sequence,
        limit=limit or get_settings().agent_trace_event_limit,
    )
    return [TraceEventRecord(**redact_trace_payload(event)) for event in events]


@router.get("/agent-runs/{run_id}/evidence", response_model=list[CanonicalEvidence])
async def get_agent_evidence(
    run_id: str,
    context: RequestContext = _agent_trace_read,
) -> list[CanonicalEvidence]:
    _run_or_404(run_id, context)
    evidence = get_repository().list_agent_evidence(
        run_id, workspace_id=context.workspace_id
    )
    return [CanonicalEvidence(**redact_trace_payload(item)) for item in evidence]


@router.get("/agent-runs/{run_id}/plan")
async def get_agent_plan(
    run_id: str,
    context: RequestContext = _agent_run_read,
) -> dict[str, Any]:
    _run_or_404(run_id, context)
    # Planner is still feature-flagged; returning null is a stable compatibility
    # response rather than leaking an internal implementation detail as 404.
    plan = get_repository().get_agent_plan(run_id, workspace_id=context.workspace_id)
    return {"plan": redact_trace_payload(plan) if plan else None}


@router.get("/agent-runs/{run_id}/trace-summary", response_model=TraceSummary)
async def get_agent_trace_summary(
    run_id: str,
    context: RequestContext = _agent_trace_read,
) -> TraceSummary:
    summary = get_repository().agent_trace_summary(
        run_id, workspace_id=context.workspace_id
    )
    if not summary:
        raise HTTPException(
            status_code=404, detail="Không tìm thấy agent run trong workspace."
        )
    return TraceSummary(**summary)


__all__ = ["router"]
