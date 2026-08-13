"""API for the bounded, evidence-first Data Analyst workspace."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from src.api.dependencies import RequestContext, require_permission
from src.models.analysis_schemas import (
    AnalysisSessionCreate,
    ContextApprove,
    ContextCreate,
    ExecutionCreate,
    QualityAcknowledge,
)
from src.services.analysis_engine import AnalysisEngine, AnalysisQueryError
from src.services.analysis_repository import get_analysis_repository
from src.services.permissions import ANALYSIS_RUN
from src.services.quality_gate import evaluate_quality_gate
from src.services.repository import get_repository
from src.services.security import get_audit, get_rate_limiter

router = APIRouter(prefix="/analysis-sessions", tags=["analysis"])


def _audit(context: RequestContext, event: str, **fields: Any) -> None:
    get_audit().log(event, workspace_id=context.workspace_id, actor_user_id=context.user_id, **fields)


def _session_or_404(session_id: str, context: RequestContext) -> dict[str, Any]:
    session = get_analysis_repository().get_session(session_id, workspace_id=context.workspace_id)
    if not session:
        raise HTTPException(status_code=404, detail="Không tìm thấy analysis session.")
    return session


@router.get("")
async def list_analysis_sessions(
    profile_run_id: str | None = Query(default=None),
    context: RequestContext = Depends(require_permission(ANALYSIS_RUN)),
) -> list[dict[str, Any]]:
    get_rate_limiter().check(context.user_id)
    return get_analysis_repository().list_sessions(profile_run_id=profile_run_id, workspace_id=context.workspace_id)


@router.post("", status_code=201)
async def create_analysis_session(
    payload: AnalysisSessionCreate, context: RequestContext = Depends(require_permission(ANALYSIS_RUN))
) -> dict[str, Any]:
    get_rate_limiter().check(context.user_id)
    try:
        session = get_analysis_repository().create_session(
            payload.model_dump(), profile_run_id=payload.profile_run_id, creator=context.user_id, workspace_id=context.workspace_id
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    _audit(context, "analysis_session_created",
        session_id=session["id"],
        profile_run_id=payload.profile_run_id,
        resource_type="analysis_session",
        resource_id=session["id"],
        mode=payload.mode,
    )
    return session


@router.get("/{session_id}")
async def get_analysis_session(
    session_id: str, context: RequestContext = Depends(require_permission(ANALYSIS_RUN))
) -> dict[str, Any]:
    get_rate_limiter().check(context.user_id)
    return _session_or_404(session_id, context)


@router.post("/{session_id}/context-versions", status_code=201)
async def create_context(
    session_id: str, payload: ContextCreate, context: RequestContext = Depends(require_permission(ANALYSIS_RUN))
) -> dict[str, Any]:
    get_rate_limiter().check(context.user_id)
    _session_or_404(session_id, context)
    item = get_analysis_repository().add_context(session_id, payload.model_dump())
    _audit(context, "analysis_context_created",
        session_id=session_id,
        context_version_id=item["id"],
        resource_type="analysis_session",
        resource_id=session_id,
    )
    return item


@router.post("/{session_id}/context-versions/{context_id}/approve")
async def approve_context(
    session_id: str,
    context_id: str,
    payload: ContextApprove,
    context: RequestContext = Depends(require_permission(ANALYSIS_RUN)),
) -> dict[str, Any]:
    get_rate_limiter().check(context.user_id)
    _session_or_404(session_id, context)
    item = get_analysis_repository().approve_context(
        session_id, context_id, context.user_id
    )
    if not item:
        raise HTTPException(status_code=404, detail="Không tìm thấy context version.")
    _audit(context, "analysis_context_approved",
        session_id=session_id,
        context_version_id=context_id,
        resource_type="analysis_session",
        resource_id=session_id,
        approved_by_user_id=context.user_id,
    )
    return item


@router.post("/{session_id}/quality-gate")
async def run_quality_gate(
    session_id: str, context: RequestContext = Depends(require_permission(ANALYSIS_RUN))
) -> dict[str, Any]:
    get_rate_limiter().check(context.user_id)
    session = _session_or_404(session_id, context)
    semantic_context = session.get("context")
    source = session.get("source")
    if not source or not source.get("profile_run_id"):
        raise HTTPException(status_code=409, detail="Analysis session chua co profile du lieu hop le.")
    if not semantic_context or semantic_context["status"] != "approved":
        raise HTTPException(
            status_code=409, detail="Cần approve semantic context trước quality gate."
        )
    decision, issues = evaluate_quality_gate(
        get_repository(), source["profile_run_id"], semantic_context["context"]
    )
    gate = get_analysis_repository().save_gate(
        session_id, semantic_context["id"], decision, issues
    )
    _audit(context, "analysis_quality_gate",
        session_id=session_id,
        resource_type="analysis_session",
        resource_id=session_id,
        decision=decision,
        issue_count=len(issues),
    )
    return gate


@router.post("/{session_id}/quality-issues/{issue_id}/acknowledge")
async def acknowledge_quality_issue(
    session_id: str,
    issue_id: str,
    payload: QualityAcknowledge,
    context: RequestContext = Depends(require_permission(ANALYSIS_RUN)),
) -> dict[str, bool]:
    get_rate_limiter().check(context.user_id)
    _session_or_404(session_id, context)
    if not get_analysis_repository().acknowledge_issue(
        session_id, issue_id, payload.resolution_note
    ):
        raise HTTPException(status_code=404, detail="Không tìm thấy quality issue.")
    _audit(context, "analysis_quality_acknowledged",
        session_id=session_id,
        issue_id=issue_id,
        resource_type="analysis_session",
        resource_id=session_id,
    )
    return {"acknowledged": True}


@router.post("/{session_id}/executions", status_code=201)
async def execute_analysis(
    session_id: str, payload: ExecutionCreate, context: RequestContext = Depends(require_permission(ANALYSIS_RUN))
) -> dict[str, Any]:
    get_rate_limiter().check(context.user_id)
    session = _session_or_404(session_id, context)
    semantic_context = session.get("context")
    gate = session.get("quality_gate")
    if (
        not semantic_context
        or semantic_context["status"] != "approved"
        or semantic_context["id"] != payload.expected_context_version_id
    ):
        raise HTTPException(
            status_code=409, detail="Context version stale hoặc chưa được approve."
        )
    if not gate:
        raise HTTPException(
            status_code=409, detail="Cần chạy quality gate trước execution."
        )
    if gate["decision"] == "blocked":
        raise HTTPException(
            status_code=409,
            detail="Quality gate đang block; hãy resolve source/context trước.",
        )
    source = session.get("source")
    if not source or not source.get("profile_run_id"):
        raise HTTPException(status_code=409, detail="Analysis session chua co profile du lieu hop le.")
    try:
        output = AnalysisEngine(get_repository()).execute(
            profile_run_id=source["profile_run_id"],
            context=semantic_context["context"],
            query=payload.query.model_dump(),
        )
    except AnalysisQueryError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    execution = get_analysis_repository().save_execution(
        session_id,
        semantic_context["id"],
        output["canonical_query"],
        output["result"],
        output["result_hash"],
        approximate=output["is_approximate"],
        limitations=output["limitations"],
        duration_ms=output["duration_ms"],
    )
    _audit(context, "analysis_execution",
        session_id=session_id,
        execution_id=execution["id"],
        resource_type="analysis_session",
        resource_id=session_id,
        result_hash=output["result_hash"],
    )
    return {
        **execution,
        "evidence": {
            "execution_id": execution["id"],
            "query_spec": execution["query_spec"],
            "result_hash": execution["result_hash"],
        },
    }


@router.get("/{session_id}/executions")
async def list_executions(
    session_id: str, context: RequestContext = Depends(require_permission(ANALYSIS_RUN))
) -> list[dict[str, Any]]:
    get_rate_limiter().check(context.user_id)
    _session_or_404(session_id, context)
    return get_analysis_repository().executions(session_id)
