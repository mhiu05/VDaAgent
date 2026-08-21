"""API for the bounded, evidence-first Data Analyst workspace."""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from src.agents.prompts import CHART_PLANNER_PROMPT
from src.agents.runtime.context import ExecutionContext, execution_scope
from src.agents.runtime.trace import (
    complete_agent_run,
    fail_agent_run,
    invoke_model,
    start_agent_run,
)
from src.api.dependencies import RequestContext, require_permission
from src.config import get_settings
from src.models.analysis_schemas import (
    AnalysisSessionCreate,
    AutoChartPlanRequest,
    ContextApprove,
    ContextCreate,
    ExecutionCreate,
    PreviewCreate,
    PreviewPromote,
    QualityAcknowledge,
)
from src.services.analysis_engine import (
    AnalysisEngine,
    AnalysisQueryError,
    ExecutionControl,
)
from src.services.analysis_repository import get_analysis_repository
from src.services.chart_planner import (
    ChartPlanCandidate,
    build_auto_profile_pack,
    build_chart_plan,
)
from src.services.forecasting import forecast_algorithm_catalog
from src.services.llm import get_llm
from src.services.permissions import ANALYSIS_RUN
from src.services.quality_gate import evaluate_quality_gate
from src.services.repository import get_repository
from src.services.security import get_audit, get_rate_limiter

router = APIRouter(prefix="/analysis-sessions", tags=["analysis"])
profile_router = APIRouter(prefix="/profile", tags=["command-center"])


def _audit(context: RequestContext, event: str, **fields: Any) -> None:
    get_audit().log(
        event,
        workspace_id=context.workspace_id,
        actor_user_id=context.user_id,
        **fields,
    )


def _session_or_404(session_id: str, context: RequestContext) -> dict[str, Any]:
    session = get_analysis_repository().get_session(
        session_id, workspace_id=context.workspace_id
    )
    if not session:
        raise HTTPException(status_code=404, detail="Không tìm thấy analysis session.")
    return session


def _require_command_center() -> None:
    if not get_settings().ux_command_center_enabled:
        raise HTTPException(status_code=404, detail="Command Center is not enabled.")


def _quick_context(run_id: str, workspace_id: str) -> dict[str, Any]:
    repo = get_repository()
    stats = repo.get_column_stats(run_id)
    restricted = repo.confirmed_pii_columns(run_id)
    dimensions: list[str] = []
    measures: list[str] = []
    for name, stat in stats.items():
        if name in restricted:
            continue
        if stat.get("mean") is not None or str(stat.get("dtype", "")).lower() in {
            "int",
            "float",
            "double",
            "bigint",
            "integer",
        }:
            measures.append(name)
        else:
            dimensions.append(name)
    return {
        "row_grain": "One source row",
        "entity": None,
        "keys": [],
        "time_column": None,
        "timezone": None,
        "dimensions": dimensions[:100],
        "measures": measures[:100],
        "ignored_columns": sorted(restricted),
        "limitations": [],
    }


async def _execute_bounded(**kwargs: Any) -> dict[str, Any]:
    timeout = get_settings().ux_preview_timeout_seconds
    control = ExecutionControl()
    task = asyncio.create_task(
        asyncio.to_thread(
            AnalysisEngine(get_repository()).execute, control=control, **kwargs
        )
    )
    try:
        return await asyncio.wait_for(
            asyncio.shield(task),
            timeout=timeout,
        )
    except TimeoutError as exc:
        # ``wait_for`` also propagates a TimeoutError raised by the worker
        # itself (for example an intermittent Google Drive download timeout).
        # Only cancel and label this as an Explorer timeout when our own
        # bounded wait actually expired and the worker is still running.
        if task.done():
            try:
                return task.result()
            except AnalysisQueryError:
                raise
            except Exception as worker_exc:
                raise HTTPException(
                    status_code=503,
                    detail=(
                        "explorer_source_unavailable: unable to prepare the "
                        "dataset source; retry the preview"
                    ),
                ) from worker_exc
        control.cancel()
        # Give DuckDB a short opportunity to acknowledge interrupt without
        # holding the HTTP response open behind a non-cooperative worker.
        try:
            await asyncio.wait_for(task, timeout=1)
        except (AnalysisQueryError, TimeoutError):
            pass
        raise HTTPException(
            status_code=408,
            detail="explorer_timeout: query exceeded the bounded execution window",
        ) from exc


@profile_router.post("/{run_id}/explorer/session", status_code=201)
async def ensure_explorer_session(
    run_id: str,
    context: RequestContext = Depends(require_permission(ANALYSIS_RUN)),
) -> dict[str, Any]:
    """Create the hidden quick session only when Explorer is first opened."""
    _require_command_center()
    get_rate_limiter().check(context.user_id)
    repo = get_repository()
    run = repo.get_profile_run(run_id, workspace_id=context.workspace_id)
    if not run:
        raise HTTPException(status_code=404, detail="Profile run was not found.")
    if run["status"] != "completed":
        raise HTTPException(
            status_code=409, detail="Profile must be completed before opening Explorer."
        )
    analyses = get_analysis_repository()
    session = next(
        (
            item
            for item in analyses.list_sessions(
                run_id, workspace_id=context.workspace_id
            )
            if item.get("creator") == context.user_id and item.get("mode") == "quick"
        ),
        None,
    )
    if not session:
        session = analyses.create_session(
            {
                "mode": "quick",
                "goal": "Explore this completed profile",
                "output": "chart",
            },
            profile_run_id=run_id,
            creator=context.user_id,
            workspace_id=context.workspace_id,
        )
    else:
        # list_sessions intentionally returns only session rows. Hydrate the
        # selected quick session before deciding whether it needs a context;
        # otherwise every Preview would create a new context version.
        session = _session_or_404(str(session["id"]), context)
    if not session.get("context"):
        analyses.add_context(
            session["id"], _quick_context(run_id, context.workspace_id)
        )
        session = _session_or_404(session["id"], context)
    _audit(
        context,
        "command_center_explorer_opened",
        resource_type="analysis_session",
        resource_id=session["id"],
        profile_run_id=run_id,
    )
    return session


@profile_router.post("/{run_id}/charts/auto-plan")
async def auto_plan_chart(
    run_id: str,
    payload: AutoChartPlanRequest,
    context: RequestContext = Depends(require_permission(ANALYSIS_RUN)),
) -> dict[str, Any]:
    """Turn one business question into a bounded, executable chart plan."""

    _require_command_center()
    get_rate_limiter().check(context.user_id)
    session = await ensure_explorer_session(run_id, context)
    semantic = session.get("context") or {}
    approved_context = semantic.get("context") or {}
    stats = get_repository().get_column_stats(run_id)
    allowed_columns = set(approved_context.get("dimensions") or []) | set(
        approved_context.get("measures") or []
    )
    safe_stats = {
        name: {
            "dtype": str((stats.get(name) or {}).get("dtype", "unknown")),
            "cardinality": (stats.get(name) or {}).get("cardinality"),
        }
        for name in sorted(allowed_columns)
    }
    planning_input = {
        "business_question": payload.question,
        "profile_metadata": {
            "dimensions": approved_context.get("dimensions") or [],
            "measures": approved_context.get("measures") or [],
            "time_column": approved_context.get("time_column"),
            "column_dtypes": safe_stats,
            "limitations": approved_context.get("limitations") or [],
        },
    }
    agent_run_id = start_agent_run(
        workspace_id=context.workspace_id,
        actor_user_id=context.user_id,
        run_type="chart_planner",
        resource_bindings={
            "profile_run_id": run_id,
            "analysis_session_id": str(session["id"]),
            "context_version_id": str(semantic.get("id") or ""),
        },
        request_for_hash=planning_input,
    )
    candidate: ChartPlanCandidate | None = None
    planning_mode = "agent"
    try:
        planner = get_llm().with_structured_output(ChartPlanCandidate)

        def _invoke() -> ChartPlanCandidate:
            messages = [
                ("system", CHART_PLANNER_PROMPT),
                ("human", json.dumps(planning_input, ensure_ascii=False)),
            ]
            if not agent_run_id:
                return invoke_model(planner, messages, prompt_id="chart_planner")
            with execution_scope(
                ExecutionContext(
                    agent_run_id=agent_run_id,
                    workspace_id=context.workspace_id,
                    actor_user_id=context.user_id,
                    effective_permissions=context.workspace.effective_permissions,
                    resource_bindings={
                        "profile_run_id": run_id,
                        "analysis_session_id": str(session["id"]),
                    },
                )
            ):
                return invoke_model(planner, messages, prompt_id="chart_planner")

        candidate = await asyncio.to_thread(_invoke)
        complete_agent_run(agent_run_id, workspace_id=context.workspace_id)
    except Exception as exc:  # noqa: BLE001 - deterministic fallback is intentional
        planning_mode = "rules_fallback"
        fail_agent_run(
            agent_run_id,
            workspace_id=context.workspace_id,
            error=exc,
            error_code="chart_planner_fallback",
        )

    plan = build_chart_plan(
        payload.question,
        approved_context,
        stats,
        candidate,
        planning_mode=planning_mode,
    )
    _audit(
        context,
        "chart_auto_planned",
        resource_type="profile_run",
        resource_id=run_id,
        profile_run_id=run_id,
        analysis_session_id=session["id"],
        agent_run_id=agent_run_id,
        planning_mode=plan["planning_mode"],
        problem=plan["problem"],
        algorithm=plan["algorithm"],
        chart_type=plan["chart_type"],
    )
    return {
        **plan,
        "agent_run_id": agent_run_id,
        "context_version_id": semantic.get("id"),
    }


@profile_router.post("/{run_id}/charts/auto-profile-pack")
async def auto_profile_pack(
    run_id: str,
    context: RequestContext = Depends(require_permission(ANALYSIS_RUN)),
) -> dict[str, Any]:
    """Build a domain-neutral multi-chart profiling pack from Profile Context.

    No business question is required.  The planner uses only approved semantic
    fields and persisted profile statistics; each returned plan still has to go
    through the normal bounded Preview/Official workflow.
    """

    _require_command_center()
    get_rate_limiter().check(context.user_id)
    session = await ensure_explorer_session(run_id, context)
    semantic = session.get("context") or {}
    approved_context = semantic.get("context") or {}
    stats = get_repository().get_column_stats(run_id)
    plans = build_auto_profile_pack(approved_context, stats)
    planning_input = {
        "profile_run_id": run_id,
        "analysis_session_id": str(session["id"]),
        "context_version_id": str(semantic.get("id") or ""),
        "profile_metadata": {
            "dimensions": approved_context.get("dimensions") or [],
            "measures": approved_context.get("measures") or [],
            "time_column": approved_context.get("time_column"),
            "column_stats": {
                name: {
                    "dtype": str((stats.get(name) or {}).get("dtype", "unknown")),
                    "cardinality": (stats.get(name) or {}).get("cardinality"),
                }
                for name in set(approved_context.get("dimensions") or [])
                | set(approved_context.get("measures") or [])
            },
        },
        "objectives": [plan.get("objective") for plan in plans],
    }
    agent_run_id = start_agent_run(
        workspace_id=context.workspace_id,
        actor_user_id=context.user_id,
        run_type="chart_auto_profile_pack",
        resource_bindings={
            "profile_run_id": run_id,
            "analysis_session_id": str(session["id"]),
            "context_version_id": str(semantic.get("id") or ""),
        },
        request_for_hash=planning_input,
    )
    complete_agent_run(agent_run_id, workspace_id=context.workspace_id)
    _audit(
        context,
        "chart_auto_profile_pack_created",
        resource_type="profile_run",
        resource_id=run_id,
        profile_run_id=run_id,
        analysis_session_id=session["id"],
        context_version_id=semantic.get("id"),
        agent_run_id=agent_run_id,
        objectives=[plan.get("objective") for plan in plans],
        chart_count=len(plans),
    )
    return {
        "profile_run_id": run_id,
        "context_version_id": semantic.get("id"),
        "agent_run_id": agent_run_id,
        "objectives": [plan.get("objective") for plan in plans],
        "plans": plans,
    }


@profile_router.get("/{run_id}/charts/algorithms")
async def list_chart_algorithms(
    run_id: str,
    context: RequestContext = Depends(require_permission(ANALYSIS_RUN)),
) -> dict[str, Any]:
    """Expose model capability without importing or executing unavailable packages."""

    _require_command_center()
    get_rate_limiter().check(context.user_id)
    run = get_repository().get_profile_run(run_id, workspace_id=context.workspace_id)
    if not run:
        raise HTTPException(status_code=404, detail="Profile run was not found.")
    return {"algorithms": forecast_algorithm_catalog()}


@profile_router.post("/{run_id}/explorer/previews", status_code=201)
async def execute_preview(
    run_id: str,
    payload: PreviewCreate,
    idempotency_header: str | None = Header(default=None, alias="Idempotency-Key"),
    context: RequestContext = Depends(require_permission(ANALYSIS_RUN)),
) -> dict[str, Any]:
    _require_command_center()
    get_rate_limiter().check(context.user_id)
    session = await ensure_explorer_session(run_id, context)
    session_id = session["id"]
    source = session.get("source") or {}
    run_id = source.get("profile_run_id")
    run = (
        get_repository().get_profile_run(str(run_id), workspace_id=context.workspace_id)
        if run_id
        else None
    )
    if not run or run.get("status") != "completed":
        raise HTTPException(status_code=409, detail="Profile is not ready for preview.")
    semantic_context = session.get("context")
    if not semantic_context:
        raise HTTPException(
            status_code=409, detail="Explorer session has no semantic context."
        )
    key = idempotency_header or payload.idempotency_key
    analyses = get_analysis_repository()
    existing = analyses.find_execution_by_idempotency(session_id, key)
    query = payload.query.model_dump()
    query["limit"] = min(query["limit"], get_settings().ux_preview_result_limit)
    if existing:
        if (
            existing.get("query_spec") != query
            or existing.get("execution_kind") != "preview"
        ):
            raise HTTPException(
                status_code=409,
                detail="idempotency_conflict: key was used for a different preview",
            )
        return existing
    try:
        output = await _execute_bounded(
            profile_run_id=str(run_id),
            context=semantic_context["context"],
            query=query,
            execution_kind="preview",
            preview_row_budget=get_settings().ux_preview_row_budget,
        )
    except AnalysisQueryError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    execution = analyses.save_execution(
        session_id,
        semantic_context["id"],
        output["canonical_query"],
        output["result"],
        output["result_hash"],
        approximate=True,
        limitations=output["limitations"],
        duration_ms=output["duration_ms"],
        execution_kind="preview",
        requested_by_user_id=context.user_id,
        expires_at=datetime.now(UTC) + timedelta(hours=1),
        idempotency_key=key,
    )
    _audit(
        context,
        "explorer_preview_ready",
        resource_type="analysis_session",
        resource_id=session_id,
        execution_id=execution["id"],
        profile_run_id=run_id,
    )
    return {
        **execution,
        "query_summary": output["query_summary"],
        "next_action": "promote",
    }


@profile_router.post("/{run_id}/explorer/previews/{preview_id}/promote", status_code=201)
async def promote_preview(
    run_id: str,
    preview_id: str,
    payload: PreviewPromote,
    idempotency_header: str | None = Header(default=None, alias="Idempotency-Key"),
    context: RequestContext = Depends(require_permission(ANALYSIS_RUN)),
) -> dict[str, Any]:
    _require_command_center()
    get_rate_limiter().check(context.user_id)
    analyses = get_analysis_repository()
    preview = analyses.get_execution(preview_id, workspace_id=context.workspace_id)
    if not preview or preview.get("execution_kind") != "preview":
        raise HTTPException(status_code=404, detail="Preview execution was not found.")
    session_id = str(preview["session_id"])
    session = _session_or_404(session_id, context)
    if (session.get("source") or {}).get("profile_run_id") != run_id:
        raise HTTPException(status_code=404, detail="Preview execution was not found.")
    if preview.get("expires_at") and preview["expires_at"] < datetime.now(UTC):
        raise HTTPException(
            status_code=409,
            detail="preview_expired: run a new preview before promotion",
        )
    semantic_context = session.get("context")
    preview_context_id = preview.get("context_version_id")
    if (
        not semantic_context
        or not preview_context_id
        or semantic_context["id"] != preview_context_id
        or payload.expected_context_version_id != preview_context_id
    ):
        raise HTTPException(
            status_code=409,
            detail="context_stale: reload Explorer and confirm the latest context",
        )
    if semantic_context["status"] != "approved":
        analyses.approve_context(session_id, semantic_context["id"], context.user_id)
        session = _session_or_404(session_id, context)
        semantic_context = session.get("context")
    assert semantic_context
    source = session.get("source") or {}
    run_id = source.get("profile_run_id")
    run = (
        get_repository().get_profile_run(str(run_id), workspace_id=context.workspace_id)
        if run_id
        else None
    )
    if not run or run.get("status") != "completed":
        raise HTTPException(
            status_code=409,
            detail="profile_stale: profile is no longer ready for official execution",
        )
    gate = session.get("quality_gate")
    if not gate or gate.get("context_version_id") != semantic_context["id"]:
        decision, issues = evaluate_quality_gate(
            get_repository(), str(run_id), semantic_context["context"]
        )
        gate = analyses.save_gate(session_id, semantic_context["id"], decision, issues)
    if gate["decision"] == "blocked":
        raise HTTPException(
            status_code=409,
            detail={
                "code": "quality_blocked",
                "issues": gate.get("issues", []),
                "next_action": "resolve_or_acknowledge",
            },
        )
    key = idempotency_header or payload.idempotency_key
    existing = analyses.find_execution_by_idempotency(session_id, key)
    if existing:
        if (
            existing.get("execution_kind") != "official"
            or existing.get("query_spec") != preview["query_spec"]
        ):
            raise HTTPException(
                status_code=409,
                detail="idempotency_conflict: key was used for a different execution",
            )
        return existing
    try:
        output = await _execute_bounded(
            profile_run_id=str(run_id),
            context=semantic_context["context"],
            query=preview["query_spec"],
            execution_kind="official",
        )
    except AnalysisQueryError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    execution = analyses.save_execution(
        session_id,
        semantic_context["id"],
        output["canonical_query"],
        output["result"],
        output["result_hash"],
        approximate=False,
        limitations=output["limitations"],
        duration_ms=output["duration_ms"],
        execution_kind="official",
        quality_gate_run_id=gate["id"],
        requested_by_user_id=context.user_id,
        idempotency_key=key,
    )
    _audit(
        context,
        "explorer_official_ready",
        resource_type="analysis_session",
        resource_id=session_id,
        execution_id=execution["id"],
        profile_run_id=run_id,
    )
    return {
        **execution,
        "query_summary": output["query_summary"],
        "next_action": "pin_or_explain",
    }


@router.get("")
async def list_analysis_sessions(
    profile_run_id: str | None = Query(default=None),
    context: RequestContext = Depends(require_permission(ANALYSIS_RUN)),
) -> list[dict[str, Any]]:
    get_rate_limiter().check(context.user_id)
    return get_analysis_repository().list_sessions(
        profile_run_id=profile_run_id, workspace_id=context.workspace_id
    )


@router.post("", status_code=201)
async def create_analysis_session(
    payload: AnalysisSessionCreate,
    context: RequestContext = Depends(require_permission(ANALYSIS_RUN)),
) -> dict[str, Any]:
    get_rate_limiter().check(context.user_id)
    try:
        session = get_analysis_repository().create_session(
            payload.model_dump(),
            profile_run_id=payload.profile_run_id,
            creator=context.user_id,
            workspace_id=context.workspace_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    _audit(
        context,
        "analysis_session_created",
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
    session_id: str,
    payload: ContextCreate,
    context: RequestContext = Depends(require_permission(ANALYSIS_RUN)),
) -> dict[str, Any]:
    get_rate_limiter().check(context.user_id)
    _session_or_404(session_id, context)
    item = get_analysis_repository().add_context(session_id, payload.model_dump())
    _audit(
        context,
        "analysis_context_created",
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
    _audit(
        context,
        "analysis_context_approved",
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
        raise HTTPException(
            status_code=409, detail="Analysis session chua co profile du lieu hop le."
        )
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
    _audit(
        context,
        "analysis_quality_gate",
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
    _audit(
        context,
        "analysis_quality_acknowledged",
        session_id=session_id,
        issue_id=issue_id,
        resource_type="analysis_session",
        resource_id=session_id,
    )
    return {"acknowledged": True}


@router.post("/{session_id}/executions", status_code=201)
async def execute_analysis(
    session_id: str,
    payload: ExecutionCreate,
    context: RequestContext = Depends(require_permission(ANALYSIS_RUN)),
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
        raise HTTPException(
            status_code=409, detail="Analysis session chua co profile du lieu hop le."
        )
    try:
        output = await _execute_bounded(
            profile_run_id=source["profile_run_id"],
            context=semantic_context["context"],
            query=payload.query.model_dump(),
            execution_kind="official",
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
        execution_kind="official",
        quality_gate_run_id=gate["id"],
        requested_by_user_id=context.user_id,
    )
    _audit(
        context,
        "analysis_execution",
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
        "query_summary": output["query_summary"],
    }


@router.get("/{session_id}/executions")
async def list_executions(
    session_id: str, context: RequestContext = Depends(require_permission(ANALYSIS_RUN))
) -> list[dict[str, Any]]:
    get_rate_limiter().check(context.user_id)
    _session_or_404(session_id, context)
    return get_analysis_repository().executions(session_id)
