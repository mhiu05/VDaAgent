"""REST API của agent profiling (ADR-008, ADR-010).

Endpoint:
    POST   /profile                 chạy pipeline tới điểm chờ HITL
    GET    /profile/{id}            đọc hồ sơ (PII đã mask)
    PATCH  /profile/{id}/confirm    Analyst xác nhận đề xuất → chạy tiếp
    POST   /profile/{id}/test       yêu cầu kiểm định thống kê
    POST   /profile/{id}/drift      so sánh hai lần profiling
    POST   /qa                      Q&A trả về một lần
    POST   /qa/stream               Q&A streaming SSE
    POST   /datasets/upload         nhận file CSV/Parquet, trả dataset_ref
    GET    /datasets                danh sách dataset đã profiling
    GET    /datasets/{id}/runs      các lần profiling của một dataset
    GET    /status                  cấu hình hiện tại + phần còn thiếu

Mọi endpoint đều đi qua `require_token` (tắt được bằng config) và rate limiter
theo user. Việc nào thay đổi dữ liệu đều ghi audit log.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import tempfile
from pathlib import Path, PurePath
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from langgraph.types import Command
from src.agents.graph import get_profiling_graph, get_qa_graph
from src.agents.nodes.profiling_nodes import clear_dataframe_cache
from src.agents.runtime.trace import complete_agent_run, fail_agent_run, start_agent_run
from src.agents.state import initial_profiling_state, initial_qa_state
from src.api.dependencies import RequestContext, require_permission
from src.config import get_settings
from src.models.schemas import (
    ConfirmRequest,
    ConfirmResponse,
    DatasetOut,
    DriftRequest,
    DriftResponse,
    ProfileRequest,
    ProfileResponse,
    ProfileRunSummary,
    QARequest,
    QAResponse,
    StatusResponse,
    TestRequest,
    TestResponse,
    UploadResponse,
)
from src.services import drift as drift_service
from src.services.analysis_repository import get_analysis_repository
from src.services.google_drive import (
    GoogleDriveConnectionRequiredError,
    GoogleDriveError,
    GoogleDriveStorage,
    is_google_drive_ref,
    parse_google_drive_ref,
)
from src.services.guardrails import audit_question_fields, enforce_output_guardrails
from src.services.llm import LLMNotConfiguredError, llm_available
from src.services.permissions import (
    DATASET_DELETE,
    DATASET_READ,
    DATASET_UPLOAD,
    DRIFT_RUN,
    PROFILE_READ,
    PROFILE_REVIEW,
    PROFILE_RUN,
    QA_PROFILE_ASK,
    STATS_RUN,
    WORKSPACE_ACTIVITY_READ,
    WORKSPACE_AUDIT_READ,
)
from src.services.repository import get_repository
from src.services.retrieval import get_index
from src.services.security import (
    get_audit,
    get_rate_limiter,
    safe_filename,
)
from src.services.stats_tests import TESTS, run_tests
from src.services.storage import (
    StorageNotConfiguredError,
    StorageUploadError,
    get_storage,
    is_supabase_ref,
    parse_supabase_ref,
)

logger = logging.getLogger(__name__)
router = APIRouter()


# --------------------------------------------------------------------------- #
# Helper
# --------------------------------------------------------------------------- #
def _thread_config(run_id: str) -> dict[str, Any]:
    """Mỗi profile run là một thread trong checkpointer."""
    return {"configurable": {"thread_id": f"profile:{run_id}"}}


def _audit(context: RequestContext, event: str, **fields: Any) -> None:
    get_audit().log(
        event,
        workspace_id=context.workspace_id,
        actor_user_id=context.user_id,
        **fields,
    )


def _build_profile_response(
    run_id: str, workspace_id: str, extra: dict[str, Any] | None = None
) -> ProfileResponse:
    """Dựng response từ DB (không từ state) — DB là nguồn sự thật duy nhất."""
    repo = get_repository()
    settings = get_settings()
    profile = repo.full_profile(
        run_id,
        mask_pii=settings.security_mask_pii_in_answers,
        workspace_id=workspace_id,
    )
    if not profile:
        raise HTTPException(
            status_code=404, detail=f"Không tìm thấy profile run '{run_id}'."
        )

    run = profile["run"]
    dataset = profile["dataset"] or {}
    stats = {row["column_name"]: row for row in profile["column_stats"]}

    payload: dict[str, Any] = {
        "profile_run_id": run["id"],
        "dataset_id": run["dataset_id"],
        "dataset_name": dataset.get("name"),
        "status": run["status"],
        "graph_thread_id": run.get("graph_thread_id"),
        "initial_question": run.get("initial_question"),
        "version": run.get("version"),
        "row_count": run.get("row_count"),
        "column_count": len(stats),
        "scan_mode": run.get("scan_mode"),
        "random_seed": run.get("random_seed"),
        "executed_query": run.get("executed_query"),
        "is_approximate": bool(run.get("is_approximate")),
        "narrative_report": run.get("narrative_report"),
        "risk_warnings": run.get("risk_warnings") or [],
        "quasi_identifiers": run.get("quasi_identifiers") or [],
        "correlation_matrix": run.get("correlation_matrix") or {},
        "pending_proposals": repo.pending_count(run_id),
        "column_stats": stats,
        "proposals": profile["proposals"],
        "test_results": profile["test_results"],
        "question_type": run.get("question_type"),
        "answer": run.get("answer"),
        "answer_sources": run.get("answer_sources") or [],
        "error": run.get("error"),
    }
    payload.update(extra or {})
    return ProfileResponse(**payload)


# --------------------------------------------------------------------------- #
# Profiling
# --------------------------------------------------------------------------- #
@router.post("/profile", response_model=ProfileResponse, status_code=201)
async def create_profile(
    request: ProfileRequest,
    context: RequestContext = Depends(require_permission(PROFILE_RUN)),
) -> ProfileResponse:
    """Chạy pipeline profiling.

    Graph dừng trước `hitl_review`, nên response trả về là **bản nháp**: các đề
    xuất đã có confidence + evidence nhưng chưa ai xác nhận. Analyst gọi
    `PATCH /profile/{id}/confirm` để duyệt và chạy tiếp.
    """
    settings = get_settings()
    get_rate_limiter().check(context.user_id)

    repo = get_repository()
    if request.dataset_id:
        dataset = repo.get_dataset(
            request.dataset_id, workspace_id=context.workspace_id
        )
        if not dataset:
            raise HTTPException(
                status_code=404, detail="Không tìm thấy dataset trong workspace."
            )
        dataset_id = str(dataset["id"])
        dataset_ref = str(dataset["source_ref"])
    else:
        dataset_ref = request.dataset_ref or ""
        if not dataset_ref:
            raise HTTPException(
                status_code=422, detail="Cần dataset_id từ endpoint upload."
            )
        if settings.app_env == "production":
            raise HTTPException(
                status_code=422,
                detail="Production chỉ nhận dataset_id từ endpoint upload.",
            )
        source_type = (
            "parquet"
            if dataset_ref.lower().endswith(".parquet")
            else "json"
            if dataset_ref.lower().endswith(".json")
            else "csv"
        )
        dataset_id = repo.upsert_dataset(
            name=request.dataset_name or dataset_ref,
            source_type=source_type,
            source_ref=dataset_ref,
            workspace_id=context.workspace_id,
        )
    if settings.app_env == "production" and not (
        is_supabase_ref(dataset_ref) or is_google_drive_ref(dataset_ref)
    ):
        raise HTTPException(
            status_code=400,
            detail="Production chỉ nhận dataset_ref từ storage đã cấu hình.",
        )
    scan_mode = request.scan_mode or settings.profiling_default_scan_mode
    sampling_config = request.sampling.model_dump() if request.sampling else None
    run_id = repo.create_profile_run(
        dataset_id=dataset_id,
        scan_mode=scan_mode,
        sampling_strategy=(sampling_config or {}).get("strategy")
        if scan_mode == "sample"
        else None,
        sample_size=(sampling_config or {}).get("sample_size")
        if scan_mode == "sample"
        else None,
        random_seed=(sampling_config or {}).get("random_seed")
        if scan_mode == "sample"
        else None,
        initial_question=request.question,
        workspace_id=context.workspace_id,
    )
    repo.update_profile_run(
        run_id, workspace_id=context.workspace_id, graph_thread_id=f"profile:{run_id}"
    )
    agent_run_id = start_agent_run(
        workspace_id=context.workspace_id,
        actor_user_id=context.user_id,
        run_type="profile",
        resource_bindings={"profile_run_id": run_id, "dataset_id": dataset_id},
        request_for_hash=request.model_dump(),
    )
    state = initial_profiling_state(
        dataset_ref=dataset_ref,
        dataset_name=request.dataset_name or dataset_ref,
        scan_mode=scan_mode,
        sampling_config=sampling_config,
        requested_by=context.user_id,
        question=request.question,
        dataset_id=dataset_id,
        profile_run_id=run_id,
        workspace_id=context.workspace_id,
        agent_run_id=agent_run_id,
    )

    graph = get_profiling_graph()
    try:
        # Graph chạy sync (DuckDB/pandas là blocking) — đẩy sang thread pool để
        # không chặn event loop của FastAPI.
        result = await asyncio.to_thread(graph.invoke, state, _thread_config(run_id))
    except Exception as exc:
        logger.exception("Profiling thất bại")
        fail_agent_run(agent_run_id, workspace_id=context.workspace_id, error=exc)
        raise HTTPException(
            status_code=500, detail=f"Profiling thất bại: {exc}"
        ) from exc

    run_id = result.get("profile_run_id") or run_id
    if not run_id:
        raise HTTPException(
            status_code=400,
            detail=result.get("error") or "Không tạo được profile run.",
        )
    if result.get("error"):
        fail_agent_run(
            agent_run_id,
            workspace_id=context.workspace_id,
            error=str(result["error"]),
            error_code="profile_error",
        )
        # Ingest lỗi (file không tồn tại...) — trả 400 kèm run id để tra audit.
        raise HTTPException(status_code=400, detail=result["error"])

    profile_status = (
        repo.get_profile_run(run_id, workspace_id=context.workspace_id) or {}
    ).get("status")
    complete_agent_run(
        agent_run_id,
        workspace_id=context.workspace_id,
        status="awaiting_approval"
        if profile_status == "pending_review"
        else "completed",
    )
    _audit(
        context,
        "api_profile",
        resource_type="profile_run",
        resource_id=run_id,
        dataset_id=dataset_id,
    )
    summary = (
        repo.agent_trace_summary(agent_run_id, workspace_id=context.workspace_id)
        if agent_run_id
        else None
    )
    return _build_profile_response(
        run_id,
        context.workspace_id,
        {"agent_run_id": agent_run_id, "trace_summary": summary},
    )


@router.get("/profile/{run_id}", response_model=ProfileResponse)
async def get_profile(
    run_id: str, context: RequestContext = Depends(require_permission(PROFILE_READ))
) -> ProfileResponse:
    """Đọc hồ sơ đã profiling. Giá trị mẫu của cột PII bị ẩn (eval C-01)."""
    get_rate_limiter().check(context.user_id)
    return _build_profile_response(run_id, context.workspace_id)


@router.get("/profile/{run_id}/export")
async def export_profile(
    run_id: str, context: RequestContext = Depends(require_permission(PROFILE_READ))
) -> dict[str, Any]:
    """Xuất hồ sơ dạng JSON.

    Chỉ xuất **metadata và thống kê**, không bao giờ xuất dữ liệu thô — kể cả
    khi `allow_raw_export` được bật (eval C-02). Cờ đó chỉ mở phần `top_k_values`
    của cột không phải PII.
    """
    settings = get_settings()
    get_rate_limiter().check(context.user_id)

    profile = get_repository().full_profile(
        run_id, mask_pii=True, workspace_id=context.workspace_id
    )
    if not profile:
        raise HTTPException(
            status_code=404, detail=f"Không tìm thấy profile run '{run_id}'."
        )

    if not settings.security_allow_raw_export:
        for row in profile["column_stats"]:
            row["top_k_values"] = None

    _audit(context, "api_export", resource_type="profile_run", resource_id=run_id)
    return {
        "note": (
            "Đây là hồ sơ thống kê, không phải dữ liệu thô. Agent không xuất dữ liệu "
            "gốc của dataset."
        ),
        "profile": profile,
    }


# --------------------------------------------------------------------------- #
# Combined report source
# --------------------------------------------------------------------------- #
EXPORT_SECTION_KEYS = (
    "overview",
    "technical_profile",
    "quality",
    "tests",
    "drift",
    "agent_summary",
    "analysis",
)


def _parse_export_sections(value: str | None) -> list[str]:
    if not value:
        return list(EXPORT_SECTION_KEYS)
    selected = [
        item.strip() for item in value.split(",") if item.strip() in EXPORT_SECTION_KEYS
    ]
    return selected or list(EXPORT_SECTION_KEYS)


def _report_profile(
    run_id: str, workspace_id: str, sections: str | None = None
) -> dict[str, Any]:
    """Build a bounded, PII-safe source document for report exporters."""
    repo = get_repository()
    profile = repo.full_profile(run_id, mask_pii=True, workspace_id=workspace_id)
    if not profile:
        raise HTTPException(
            status_code=404, detail=f"Không tìm thấy profile run '{run_id}'."
        )

    # Pending PII is sensitive too. Export must fail closed until the proposal
    # is rejected, even though the normal profile response masks confirmed PII.
    pii_columns = {
        str(item.get("column_name"))
        for item in profile["proposals"].get("pii", [])
        if item.get("status") != "rejected" and item.get("column_name")
    }
    for stat in profile["column_stats"]:
        if stat.get("column_name") in pii_columns:
            stat["top_k_values"] = None
            stat["pii_masked"] = True

    # Local source paths are implementation details and must not leave the API.
    dataset = profile.get("dataset") or {}
    profile["dataset"] = {
        key: dataset.get(key)
        for key in ("id", "name", "source_type", "created_at", "last_profiled_at")
    }
    run = profile["run"]
    profile["run"] = {
        key: run.get(key)
        for key in (
            "id",
            "dataset_id",
            "version",
            "created_at",
            "scan_mode",
            "sample_size",
            "random_seed",
            "row_count",
            "status",
            "is_approximate",
            "narrative_report",
            "risk_warnings",
            "quasi_identifiers",
            "correlation_matrix",
        )
    }

    analysis_repo = get_analysis_repository()
    sessions: list[dict[str, Any]] = []
    for item in analysis_repo.list_sessions(
        profile_run_id=run_id, workspace_id=workspace_id
    ):
        session = (
            analysis_repo.get_session(item["id"], workspace_id=workspace_id) or item
        )
        sessions.append(
            {
                "id": session.get("id"),
                "goal": session.get("goal"),
                "mode": session.get("mode"),
                "status": session.get("status"),
                "created_at": session.get("created_at"),
                "updated_at": session.get("updated_at"),
                "context": session.get("context"),
                "quality_gate": session.get("quality_gate"),
                "executions": analysis_repo.executions(session["id"]),
            }
        )

    selected_sections = _parse_export_sections(sections)
    if "technical_profile" not in selected_sections:
        profile["column_stats"] = []
    if "quality" not in selected_sections:
        profile["run"]["risk_warnings"] = []
    if "tests" not in selected_sections:
        profile["test_results"] = []
    if "drift" not in selected_sections:
        profile["drift_reports"] = []
    if "agent_summary" not in selected_sections:
        profile["run"]["narrative_report"] = None
    if "analysis" not in selected_sections:
        sessions = []

    return {
        "profile": profile,
        "analysis_sessions": sessions,
        "export_sections": selected_sections,
        "export_policy": {
            "raw_dataset": False,
            "raw_rows": False,
            "pii_values": False,
            "aggregate_results": True,
            "evidence": True,
        },
    }


@router.get("/profile/{run_id}/report")
async def get_combined_report(
    run_id: str,
    sections: str | None = Query(default=None),
    context: RequestContext = Depends(require_permission(PROFILE_READ)),
) -> dict[str, Any]:
    """Return the bounded source document used by combined report exporters."""
    get_rate_limiter().check(context.user_id)
    payload = _report_profile(run_id, context.workspace_id, sections)
    _audit(
        context, "api_report_export", resource_type="profile_run", resource_id=run_id
    )
    return payload


# --------------------------------------------------------------------------- #
# HITL
# --------------------------------------------------------------------------- #
@router.patch("/profile/{run_id}/confirm", response_model=ConfirmResponse)
async def confirm_proposals(
    run_id: str,
    request: ConfirmRequest,
    context: RequestContext = Depends(require_permission(PROFILE_REVIEW)),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> ConfirmResponse:
    """Analyst xác nhận/từ chối/sửa đề xuất, rồi pipeline chạy tiếp.

    Đây là cửa duy nhất để một proposal chuyển sang `confirmed`. Agent không có
    đường nào tự làm việc này (eval C-03).
    """
    repo = get_repository()
    get_rate_limiter().check(context.user_id)

    run = repo.get_profile_run(run_id, workspace_id=context.workspace_id)
    if not run:
        raise HTTPException(
            status_code=404, detail=f"Profile run '{run_id}' không tồn tại."
        )

    action = request.action
    if action is None:
        if any(item.decision == "reject" for item in request.decisions):
            action = "reject"
        elif any(item.decision == "edit" for item in request.decisions):
            action = "edit"
        else:
            action = "confirm"

    test_requests = [dict(item) for item in request.test_requests]
    for item in request.decisions:
        if item.decision == "edit" and not item.final_type:
            raise HTTPException(status_code=422, detail="decision=edit cần final_type.")
    if action == "request_test":
        if not test_requests:
            raise HTTPException(
                status_code=422, detail="request_test cần ít nhất một test spec."
            )
        columns = set(repo.get_column_stats(run_id))
        for spec in test_requests:
            if spec.get("test_type") not in TESTS:
                raise HTTPException(
                    status_code=422,
                    detail=f"Kiểm định không hỗ trợ: {spec.get('test_type')}.",
                )
            if not isinstance(spec.get("columns"), list) or not spec["columns"]:
                raise HTTPException(
                    status_code=422, detail="Mỗi test spec cần danh sách columns."
                )
            if any(column not in columns for column in spec["columns"]):
                raise HTTPException(
                    status_code=422,
                    detail="Test spec chứa column không thuộc profile run.",
                )
    elif not request.decisions:
        raise HTTPException(
            status_code=422, detail="Review cần decisions hoặc action=request_test."
        )

    applied_result = repo.apply_review_and_start(
        run_id,
        action=action,
        decisions=[item.model_dump() for item in request.decisions],
        confirmed_by=context.user_id,
        idempotency_key=idempotency_key,
        workspace_id=context.workspace_id,
    )
    if not applied_result.get("ok"):
        code = applied_result.get("code")
        if code == "not_found":
            raise HTTPException(
                status_code=404, detail=f"Profile run '{run_id}' không tồn tại."
            )
        if code == "invalid_state":
            raise HTTPException(
                status_code=409,
                detail=f"Run đang ở trạng thái {applied_result.get('status')}, không thể resume.",
            )
        if code == "edit_requires_final_type":
            raise HTTPException(status_code=422, detail="decision=edit cần final_type.")
        if code == "concurrent_review":
            raise HTTPException(
                status_code=409, detail="Review khác đang resume run này."
            )
        raise HTTPException(
            status_code=404,
            detail="Proposal không thuộc profile run hoặc đã được xử lý.",
        )

    for item in request.decisions:
        _audit(
            context,
            "hitl_decision",
            profile_run_id=run_id,
            resource_type="profile_run",
            resource_id=run_id,
            kind=item.kind,
            proposal_id=item.proposal_id,
            decision=item.decision,
            confirmed_by_user_id=context.user_id,
            note=item.note,
        )
    _audit(
        context,
        "workflow_resume",
        resource_type="profile_run",
        resource_id=run_id,
        action=action,
    )

    agent_run_id: str | None = None
    if not applied_result.get("duplicate") and request.resume:
        config = repo.execution_config(run_id, workspace_id=context.workspace_id)
        if not config:
            repo.update_profile_run(
                run_id,
                workspace_id=context.workspace_id,
                status="failed",
                error="Checkpoint config không tồn tại.",
            )
            raise HTTPException(
                status_code=409,
                detail="Profile run không có checkpoint/thread mapping an toàn.",
            )
        payload = {"action": action, "test_requests": test_requests}
        graph = get_profiling_graph()
        try:
            checkpoint = await asyncio.to_thread(graph.get_state, config)
            agent_run_id = (checkpoint.values or {}).get("agent_run_id")
        except Exception:  # noqa: BLE001 - trace lookup must not block compatibility resume
            agent_run_id = None
        try:
            result = await asyncio.to_thread(
                graph.invoke,
                Command(resume=payload, update={"resume_requested": True}),
                config,
            )
            agent_run_id = result.get("agent_run_id") or agent_run_id
        except Exception as exc:
            logger.exception("Workflow resume failed")
            repo.update_profile_run(
                run_id,
                workspace_id=context.workspace_id,
                status="failed",
                error=str(exc),
            )
            fail_agent_run(agent_run_id, workspace_id=context.workspace_id, error=exc)
            _audit(
                context,
                "workflow_error",
                resource_type="profile_run",
                resource_id=run_id,
                action=action,
                outcome="error",
            )
            raise HTTPException(
                status_code=500, detail="Resume workflow thất bại."
            ) from exc

    current = _build_profile_response(run_id, context.workspace_id)
    if agent_run_id:
        complete_agent_run(
            agent_run_id,
            workspace_id=context.workspace_id,
            status="awaiting_approval"
            if current.status == "pending_review"
            else "completed",
        )
    return ConfirmResponse(
        profile_run_id=run_id,
        applied=applied_result.get("applied", 0),
        pending_proposals=current.pending_proposals,
        status=current.status,
        narrative_report=current.narrative_report,
        risk_warnings=current.risk_warnings,
        graph_thread_id=current.graph_thread_id,
        initial_question=current.initial_question,
        question_type=current.question_type,
        answer=current.answer,
        answer_sources=current.answer_sources,
        test_results=current.test_results,
    )


# --------------------------------------------------------------------------- #
# Kiểm định thống kê
# --------------------------------------------------------------------------- #
@router.post("/profile/{run_id}/test", response_model=TestResponse)
async def run_statistical_tests(
    run_id: str,
    request: TestRequest,
    context: RequestContext = Depends(require_permission(STATS_RUN)),
) -> TestResponse:
    """Chạy kiểm định thống kê theo yêu cầu của Analyst.

    Nhiều kiểm định cùng lúc sẽ được hiệu chỉnh đa kiểm định (L1) — p điều chỉnh
    và kết luận sau hiệu chỉnh đều nằm trong response.
    """
    from src.agents.nodes.profiling_nodes import get_dataframe

    settings = get_settings()
    repo = get_repository()
    get_rate_limiter().check(context.user_id)

    if not repo.get_profile_run(run_id, workspace_id=context.workspace_id):
        raise HTTPException(
            status_code=404, detail=f"Không tìm thấy profile run '{run_id}'."
        )

    unknown = [t.test_type for t in request.tests if t.test_type not in TESTS]
    if unknown:
        raise HTTPException(
            status_code=422,
            detail=f"Kiểm định không hỗ trợ: {', '.join(unknown)}. Có sẵn: {', '.join(sorted(TESTS))}.",
        )

    df = await asyncio.to_thread(get_dataframe, run_id)
    if df is None:
        raise HTTPException(
            status_code=409,
            detail="Không nạp lại được dữ liệu của run này (file gốc có thể đã bị xoá/di chuyển).",
        )

    results = await asyncio.to_thread(
        run_tests,
        df,
        [t.model_dump() for t in request.tests],
        request.alpha or settings.stats_alpha,
        request.fdr_method or settings.stats_fdr_method,
        settings.stats_max_tests_per_request,
    )
    repo.save_test_results(run_id, results, requested_by=context.user_id)
    _audit(
        context,
        "api_test",
        profile_run_id=run_id,
        resource_type="profile_run",
        resource_id=run_id,
        requested_by_user_id=context.user_id,
        tests=[t.test_type for t in request.tests],
    )

    real = [r for r in results if r.get("p_value") is not None]
    note = None
    if len(real) > 1:
        method = request.fdr_method or settings.stats_fdr_method
        note = (
            f"Đã hiệu chỉnh đa kiểm định ({method}) cho {len(real)} kiểm định. "
            f"Dùng `significant_after_correction`, không dùng p_value thô."
        )
    return TestResponse(profile_run_id=run_id, results=results, correction_note=note)


# --------------------------------------------------------------------------- #
# Drift
# --------------------------------------------------------------------------- #
@router.post("/profile/{run_id}/drift", response_model=DriftResponse)
async def detect_drift(
    run_id: str,
    request: DriftRequest,
    context: RequestContext = Depends(require_permission(DRIFT_RUN)),
) -> DriftResponse:
    """So sánh hai lần profiling để phát hiện drift (PSI, dịch mean/std, schema)."""
    repo = get_repository()
    get_rate_limiter().check(context.user_id)

    current_id = request.current_run_id or run_id
    for rid in (request.baseline_run_id, current_id):
        if not repo.get_profile_run(rid, workspace_id=context.workspace_id):
            raise HTTPException(
                status_code=404, detail=f"Không tìm thấy profile run '{rid}'."
            )
    if request.baseline_run_id == current_id:
        raise HTTPException(status_code=422, detail="Hai run so sánh phải khác nhau.")

    findings, summary = drift_service.compare_runs(
        repo.column_stats_rows(request.baseline_run_id),
        repo.column_stats_rows(current_id),
    )
    repo.save_drift_report(request.baseline_run_id, current_id, findings, summary)
    _audit(
        context,
        "api_drift",
        profile_run_id=current_id,
        baseline_run_id=request.baseline_run_id,
        resource_type="profile_run",
        resource_id=current_id,
        findings=len(findings),
    )
    return DriftResponse(
        baseline_run_id=request.baseline_run_id,
        current_run_id=current_id,
        summary=summary,
        findings=findings,
    )


# --------------------------------------------------------------------------- #
# Q&A
# --------------------------------------------------------------------------- #
def _qa_state(
    request: QARequest,
    context: RequestContext,
    *,
    agent_run_id: str | None = None,
) -> dict[str, Any]:
    columns: list[str] = []
    if request.profile_run_id:
        repo = get_repository()
        run = repo.get_profile_run(
            request.profile_run_id, workspace_id=context.workspace_id
        )
        if not run:
            raise HTTPException(
                status_code=404,
                detail=f"Không tìm thấy profile run '{request.profile_run_id}'.",
            )
        pending = repo.pending_count(request.profile_run_id)
        if pending:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Profile còn {pending} đề xuất cần review. "
                    "Hãy hoàn tất Review proposals trước khi hỏi Agent về dataset."
                ),
            )
        columns = list(repo.get_column_stats(request.profile_run_id).keys())
    return initial_qa_state(
        question=request.question,
        profile_run_id=request.profile_run_id,
        column_names=columns,
        requested_by=context.user_id,
        history=[item.model_dump() for item in request.history[-12:]],
        workspace_id=context.workspace_id,
        agent_run_id=agent_run_id,
    )


def _guard_qa_answer(
    answer: str, *, profile_run_id: str | None, context: RequestContext
) -> str:
    """Áp output policy lần cuối ngay tại trust boundary của API."""
    settings = get_settings()
    guarded = enforce_output_guardrails(answer, settings.guardrails_max_output_chars)
    if guarded.redactions or guarded.truncated:
        _audit(
            context,
            "guardrail_output",
            profile_run_id=profile_run_id,
            resource_type="profile_run" if profile_run_id else None,
            resource_id=profile_run_id,
            stage="api_response",
            redactions=list(guarded.redactions),
            truncated=guarded.truncated,
        )
    return guarded.text


@router.post("/qa", response_model=QAResponse)
async def ask_question(
    request: QARequest,
    context: RequestContext = Depends(require_permission(QA_PROFILE_ASK)),
) -> QAResponse:
    """Q&A không streaming — tiện cho script và test."""
    get_rate_limiter().check(context.user_id)
    state = _qa_state(request, context)
    agent_run_id = start_agent_run(
        workspace_id=context.workspace_id,
        actor_user_id=context.user_id,
        run_type="qa",
        resource_bindings={
            key: value
            for key, value in {"profile_run_id": request.profile_run_id}.items()
            if value
        },
        request_for_hash=request.model_dump(),
    )
    state["agent_run_id"] = agent_run_id

    try:
        result = await asyncio.to_thread(get_qa_graph().invoke, state)
    except Exception as exc:
        logger.exception("Q&A thất bại")
        fail_agent_run(agent_run_id, workspace_id=context.workspace_id, error=exc)
        raise HTTPException(
            status_code=500,
            detail="Q&A thất bại. Vui lòng thử lại và kiểm tra server log nếu lỗi lặp lại.",
        ) from exc

    is_approximate = False
    if request.profile_run_id:
        run = get_repository().get_profile_run(
            request.profile_run_id, workspace_id=context.workspace_id
        )
        is_approximate = bool((run or {}).get("is_approximate"))

    complete_agent_run(agent_run_id, workspace_id=context.workspace_id)
    trace_summary = (
        get_repository().agent_trace_summary(
            agent_run_id, workspace_id=context.workspace_id
        )
        if agent_run_id
        else None
    )

    return QAResponse(
        question=_guard_qa_answer(
            request.question,
            profile_run_id=request.profile_run_id,
            context=context,
        ),
        question_type=result.get("question_type"),
        answer=_guard_qa_answer(
            result.get("answer") or "",
            profile_run_id=request.profile_run_id,
            context=context,
        ),
        sources=result.get("answer_sources") or [],
        is_approximate=is_approximate,
        agent_run_id=agent_run_id,
        verification={"status": "not_run", "mode": get_settings().agent_verifier_mode},
        trace_summary=trace_summary,
    )


def _sse(event: str, data: Any) -> str:
    """Đóng gói một SSE frame (ADR-010)."""
    return (
        f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"
    )


@router.post("/qa/stream")
async def ask_question_stream(
    request: QARequest,
    context: RequestContext = Depends(require_permission(QA_PROFILE_ASK)),
) -> StreamingResponse:
    """Q&A streaming qua SSE.

    Event: `token` (từng đoạn văn bản) → `source` (danh sách nguồn) →
    `done` (kết thúc) | `error`.

    Nhánh định lượng cần gọi tool nhiều vòng nên không stream token được — nó
    chạy xong rồi phát một lần, còn nhánh định tính stream token thật.
    """
    get_rate_limiter().check(context.user_id)
    state = _qa_state(request, context)
    agent_run_id = start_agent_run(
        workspace_id=context.workspace_id,
        actor_user_id=context.user_id,
        run_type="qa",
        resource_bindings={
            key: value
            for key, value in {"profile_run_id": request.profile_run_id}.items()
            if value
        },
        request_for_hash=request.model_dump(),
    )
    state["agent_run_id"] = agent_run_id

    async def generator() -> Any:
        try:
            routed = await asyncio.to_thread(get_qa_graph().invoke, state)
            answer = _guard_qa_answer(
                routed.get("answer") or "",
                profile_run_id=request.profile_run_id,
                context=context,
            )
            sources = routed.get("answer_sources") or []
            qtype = routed.get("question_type")

            yield _sse("meta", {"question_type": qtype})

            if qtype == "qualitative" and llm_available() and answer:
                # Phát lại câu trả lời theo từng câu để client thấy tiến trình
                # mà không phải gọi LLM lần hai.
                buffer = ""
                for char in answer:
                    buffer += char
                    if char in ".!?\n" and len(buffer) > 40:
                        yield _sse("token", {"text": buffer})
                        buffer = ""
                        await asyncio.sleep(0)
                if buffer:
                    yield _sse("token", {"text": buffer})
            else:
                yield _sse("token", {"text": answer})

            if sources:
                yield _sse("source", {"sources": sources})
            complete_agent_run(agent_run_id, workspace_id=context.workspace_id)
            trace_summary = (
                get_repository().agent_trace_summary(
                    agent_run_id, workspace_id=context.workspace_id
                )
                if agent_run_id
                else None
            )
            yield _sse(
                "done",
                {
                    "question_type": qtype,
                    "length": len(answer),
                    "agent_run_id": agent_run_id,
                    "trace_summary": trace_summary,
                },
            )

            _audit(
                context,
                "qa_stream",
                profile_run_id=request.profile_run_id,
                resource_type="profile_run" if request.profile_run_id else None,
                resource_id=request.profile_run_id,
                question_type=qtype,
                **audit_question_fields(
                    request.question,
                    include_content=get_settings().guardrails_audit_question_content,
                ),
            )
        except LLMNotConfiguredError as exc:
            fail_agent_run(
                agent_run_id,
                workspace_id=context.workspace_id,
                error=exc,
                error_code="llm_not_configured",
            )
            yield _sse("error", {"detail": str(exc)})
        except Exception as exc:
            logger.exception("SSE Q&A thất bại")
            fail_agent_run(agent_run_id, workspace_id=context.workspace_id, error=exc)
            yield _sse(
                "error",
                {"detail": "Agent không thể hoàn tất câu trả lời. Vui lòng thử lại."},
            )

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # tắt buffer của nginx
        },
    )


# --------------------------------------------------------------------------- #
# Dataset / hệ thống
# --------------------------------------------------------------------------- #
@router.post("/datasets/upload", response_model=UploadResponse, status_code=201)
async def upload_dataset(
    file: UploadFile = File(..., description="CSV / TSV / Parquet / JSON"),  # noqa: B008
    context: RequestContext = Depends(require_permission(DATASET_UPLOAD)),
) -> UploadResponse:
    """Nhận file dữ liệu từ Analyst và trả `dataset_ref` để gọi `POST /profile`.

    Ba lớp chặn: đuôi file phải nằm trong whitelist, tên file được làm sạch
    (chống path traversal), và dung lượng bị cắt theo `security.max_upload_mb`.
    File được đọc theo từng chunk nên request quá lớn bị chặn trước khi kịp
    chiếm hết RAM.
    """
    get_rate_limiter().check(context.user_id)
    settings = get_settings()

    try:
        name = safe_filename(file.filename or "")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    is_guest = context.actor.is_guest
    limit_mb = (
        settings.guest_max_upload_mb if is_guest else settings.security_max_upload_mb
    )
    limit_bytes = limit_mb * 1024 * 1024
    dataset_id = uuid4().hex
    temporary_path: Path | None = None
    target: Path | None = None
    size = 0
    content_digest = hashlib.sha256()
    provider = (
        settings.guest_storage_provider if is_guest else settings.storage_provider
    )
    use_remote_storage = provider in {"supabase", "google_drive"}
    if settings.app_env == "production" and provider == "local" and not is_guest:
        raise HTTPException(
            status_code=503,
            detail="Production không được dùng local storage.",
        )
    if (
        provider == "supabase"
        and settings.app_env == "production"
        and not settings.supabase_configured
    ):
        raise HTTPException(
            status_code=503, detail="Production chưa cấu hình Supabase Storage."
        )
    if provider == "google_drive" and not settings.google_drive_configured:
        raise HTTPException(
            status_code=503, detail="Production chưa cấu hình Google Drive đầy đủ."
        )

    # Remote storage là source of truth. Local file chỉ là file tạm cho upload
    # hoặc compatibility path ở development/test.
    try:
        if use_remote_storage:
            fd, temp_name = tempfile.mkstemp(
                prefix="p170-upload-", suffix=PurePath(name).suffix
            )
            os.close(fd)
            temporary_path = Path(temp_name)
            target = temporary_path
        else:
            local_dir = (
                settings.upload_path
                / "workspaces"
                / context.workspace_id
                / "datasets"
                / dataset_id
            )
            local_dir.mkdir(parents=True, exist_ok=True)
            target = local_dir / f"{uuid4().hex}-{name}"

        assert target is not None
        with target.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > limit_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=f"File vượt giới hạn {limit_mb} MB.",
                    )
                out.write(chunk)
                content_digest.update(chunk)
    except HTTPException:
        if target is not None:
            target.unlink(missing_ok=True)
        raise
    except OSError as exc:
        if target is not None:
            target.unlink(missing_ok=True)
        raise HTTPException(
            status_code=500, detail=f"Không ghi được file: {exc}"
        ) from exc
    finally:
        await file.close()

    if size == 0:
        if target is not None:
            target.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail="File rỗng.")

    try:
        if provider == "supabase":
            prefix = "guest-workspaces" if is_guest else "workspaces"
            object_name = f"{prefix}/{context.workspace_id}/datasets/{dataset_id}/{uuid4().hex}-{name}"
            try:
                await asyncio.to_thread(
                    get_storage(settings).upload,
                    target,
                    object_name,
                    file.content_type,
                )
            except StorageNotConfiguredError as exc:
                raise HTTPException(status_code=503, detail=str(exc)) from exc
            except StorageUploadError as exc:
                logger.exception(
                    "Supabase Storage upload failed",
                    extra={"bucket": settings.supabase_storage_bucket},
                )
                raise HTTPException(status_code=502, detail=str(exc)) from exc
            dataset_ref = f"supabase://{settings.supabase_storage_bucket}/{object_name}"
            stored_name = dataset_ref
            filename = name
        elif provider == "google_drive":
            try:
                file_id = await asyncio.to_thread(
                    GoogleDriveStorage(settings).upload,
                    context.workspace_id,
                    target,
                    name,
                    file.content_type,
                )
            except GoogleDriveConnectionRequiredError as exc:
                raise HTTPException(status_code=409, detail=str(exc)) from exc
            except GoogleDriveError as exc:
                logger.exception("Google Drive upload failed")
                raise HTTPException(status_code=502, detail=str(exc)) from exc
            dataset_ref = f"gdrive://{context.workspace_id}/{file_id}/{name}"
            stored_name = dataset_ref
            filename = name
        else:
            assert target is not None
            dataset_ref = str(target)
            stored_name = target.name
            filename = target.name
    except HTTPException:
        raise
    except Exception as exc:
        destination = (
            "Google Drive" if provider == "google_drive" else "Supabase Storage"
        )
        raise HTTPException(
            status_code=502, detail=f"Không thể lưu file vào {destination}."
        ) from exc
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)

    source_type = (
        "parquet"
        if name.endswith(".parquet")
        else "json"
        if name.endswith(".json")
        else "csv"
    )
    try:
        get_repository().create_dataset(
            dataset_id,
            PurePath(name).stem,
            source_type,
            dataset_ref,
            workspace_id=context.workspace_id,
            content_sha256=content_digest.hexdigest(),
            source_version=None,
        )
    except Exception as exc:
        logger.exception("Không lưu được metadata upload")
        try:
            if is_supabase_ref(dataset_ref):
                bucket, object_path = parse_supabase_ref(dataset_ref)
                get_storage(settings).remove(bucket, object_path)
            elif is_google_drive_ref(dataset_ref):
                source_workspace, file_id, _ = parse_google_drive_ref(dataset_ref)
                if source_workspace != context.workspace_id:
                    raise ValueError("Object Google Drive không thuộc workspace.")
                GoogleDriveStorage(settings).remove(context.workspace_id, file_id)
            else:
                Path(dataset_ref).unlink(missing_ok=True)
        except Exception:
            logger.warning(
                "Không rollback được source upload sau lỗi metadata", exc_info=True
            )
        raise HTTPException(
            status_code=500, detail="Không thể lưu metadata dataset."
        ) from exc
    _audit(
        context,
        "api_upload",
        resource_type="dataset",
        resource_id=dataset_id,
        filename=name,
        stored=stored_name,
        bytes=size,
    )
    logger.info("Đã lưu file upload %s (%d bytes)", stored_name, size)

    return UploadResponse(
        dataset_ref=dataset_ref,
        dataset_id=dataset_id,
        filename=filename,
        size_bytes=size,
        suggested_name=PurePath(name).stem,
    )


@router.get("/datasets", response_model=list[DatasetOut])
async def list_datasets(
    context: RequestContext = Depends(require_permission(DATASET_READ)),
) -> list[DatasetOut]:
    get_rate_limiter().check(context.user_id)
    return [
        DatasetOut(**d)
        for d in get_repository().list_datasets(workspace_id=context.workspace_id)
    ]


@router.delete("/datasets/{dataset_id}")
async def delete_dataset(
    dataset_id: str,
    context: RequestContext = Depends(require_permission(DATASET_DELETE)),
) -> dict[str, Any]:
    """Xóa dataset, lịch sử profiling và metadata liên quan.

    Chỉ xóa file nếu file nằm trong thư mục upload do ứng dụng quản lý. Với
    dataset_ref trỏ tới đường dẫn ngoài server, metadata bị xóa nhưng file gốc
    được giữ nguyên.
    """
    get_rate_limiter().check(context.user_id)
    repo = get_repository()
    deleted = repo.delete_dataset(dataset_id, workspace_id=context.workspace_id)
    if not deleted:
        raise HTTPException(
            status_code=404, detail=f"Không tìm thấy dataset '{dataset_id}'."
        )

    run_ids = deleted["run_ids"]
    for run_id in run_ids:
        clear_dataframe_cache()
        get_index().delete(f"run:{run_id}", workspace_id=context.workspace_id)

    deleted_file = False
    source_ref = str(deleted["source_ref"])
    if is_supabase_ref(source_ref):
        try:
            bucket, object_path = parse_supabase_ref(source_ref)
            expected_prefix = (
                f"workspaces/{context.workspace_id}/datasets/{dataset_id}/"
            )
            if not object_path.startswith(expected_prefix):
                raise ValueError("Object path không thuộc dataset workspace.")
            get_storage().remove(bucket, object_path)
            deleted_file = True
        except Exception:
            logger.warning(
                "Không xóa được object Supabase %s", source_ref, exc_info=True
            )
    elif is_google_drive_ref(source_ref):
        try:
            source_workspace, file_id, _ = parse_google_drive_ref(source_ref)
            if source_workspace != context.workspace_id:
                raise ValueError("Object Google Drive không thuộc workspace.")
            GoogleDriveStorage().remove(context.workspace_id, file_id)
            deleted_file = True
        except Exception:
            logger.warning(
                "Không xóa được object Google Drive %s", source_ref, exc_info=True
            )
    else:
        source_path = Path(source_ref)
        upload_root = get_settings().upload_path.resolve()
        try:
            source_path.resolve().relative_to(upload_root)
            if source_path.is_file():
                source_path.unlink()
                deleted_file = True
        except (OSError, ValueError):
            # File ngoài upload root hoặc đã bị di chuyển: không xóa file gốc.
            pass

    _audit(
        context,
        "api_delete_dataset",
        dataset_id=dataset_id,
        resource_type="dataset",
        resource_id=dataset_id,
        deleted_runs=len(run_ids),
        deleted_file=deleted_file,
    )
    return {
        "dataset_id": dataset_id,
        "deleted_runs": len(run_ids),
        "deleted_file": deleted_file,
    }


@router.get("/datasets/{dataset_id}/runs", response_model=list[ProfileRunSummary])
async def list_runs(
    dataset_id: str,
    limit: int = Query(default=50, ge=1, le=500),
    context: RequestContext = Depends(require_permission(DATASET_READ)),
) -> list[ProfileRunSummary]:
    get_rate_limiter().check(context.user_id)
    repo = get_repository()
    if not repo.get_dataset(dataset_id, workspace_id=context.workspace_id):
        raise HTTPException(
            status_code=404, detail=f"Không tìm thấy dataset '{dataset_id}'."
        )
    return [
        ProfileRunSummary(**r)
        for r in repo.list_profile_runs(
            dataset_id, limit=limit, workspace_id=context.workspace_id
        )
    ]


@router.get("/status", response_model=StatusResponse)
async def status(
    context: RequestContext = Depends(require_permission(WORKSPACE_ACTIVITY_READ)),
) -> StatusResponse:
    """Cấu hình hiện tại + danh sách biến môi trường còn thiếu."""
    settings = get_settings()
    try:
        documents = get_index().documents
    except Exception:  # noqa: BLE001
        documents = []
    profile_documents = [
        d
        for d in documents
        if (d.metadata or {}).get("knowledge_type") == "profile_report"
    ]
    external_documents = [
        d
        for d in documents
        if (d.metadata or {}).get("knowledge_type") == "external_knowledge"
    ]
    revisions = {
        str(d.metadata.get("corpus_revision"))
        for d in external_documents
        if d.metadata.get("corpus_revision")
    }

    return StatusResponse(
        app=settings.app_name,
        env=settings.app_env,
        llm_provider=settings.llm_provider,
        llm_model=settings.llm_model,
        llm_configured=settings.llm_configured,
        embedding_provider=settings.retrieval_embedding_provider,
        database=settings.database_url.split("://")[0],
        checkpointer=settings.checkpointer_url.split("://")[0],
        auto_confirm=settings.hitl_auto_confirm,
        confidence_threshold=settings.hitl_confidence_threshold,
        mask_pii_in_answers=settings.security_mask_pii_in_answers,
        allow_raw_export=settings.security_allow_raw_export,
        require_api_token=settings.security_require_api_token,
        indexed_documents=len(documents),
        external_knowledge_enabled=settings.retrieval_external_knowledge_enabled,
        profile_report_documents=len(profile_documents),
        external_knowledge_documents=len(external_documents),
        corpus_revision=next(iter(revisions)) if len(revisions) == 1 else None,
        missing_config=settings.missing_required(),
    )


@router.get("/audit")
async def audit_tail(
    limit: int = Query(default=100, ge=1, le=1000),
    context: RequestContext = Depends(require_permission(WORKSPACE_AUDIT_READ)),
) -> dict[str, Any]:
    """Xem audit log gần nhất — dùng để review các quyết định auto-confirm."""
    get_rate_limiter().check(context.user_id)
    return {
        "entries": get_repository().tail_audit_events(
            limit, workspace_id=context.workspace_id
        )
    }


__all__ = ["router"]
