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
import json
import logging
from pathlib import PurePath
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse

from src.agents.graph import get_profiling_graph, get_qa_graph
from src.agents.nodes.profiling_nodes import summarize_node
from src.agents.state import initial_profiling_state, initial_qa_state
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
from src.services.llm import LLMNotConfiguredError, llm_available
from src.services.repository import get_repository
from src.services.retrieval import get_index
from src.services.security import get_audit, get_rate_limiter, require_token, safe_filename
from src.services.stats_tests import TESTS, run_tests

logger = logging.getLogger(__name__)
router = APIRouter()


# --------------------------------------------------------------------------- #
# Helper
# --------------------------------------------------------------------------- #
def _thread_config(run_id: str) -> dict[str, Any]:
    """Mỗi profile run là một thread trong checkpointer."""
    return {"configurable": {"thread_id": f"profile:{run_id}"}}


def _build_profile_response(run_id: str, extra: dict[str, Any] | None = None) -> ProfileResponse:
    """Dựng response từ DB (không từ state) — DB là nguồn sự thật duy nhất."""
    repo = get_repository()
    settings = get_settings()
    profile = repo.full_profile(run_id, mask_pii=settings.security_mask_pii_in_answers)
    if not profile:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy profile run '{run_id}'.")

    run = profile["run"]
    dataset = profile["dataset"] or {}
    stats = {row["column_name"]: row for row in profile["column_stats"]}

    payload: dict[str, Any] = {
        "profile_run_id": run["id"],
        "dataset_id": run["dataset_id"],
        "dataset_name": dataset.get("name"),
        "status": run["status"],
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
    user: str = Depends(require_token),
) -> ProfileResponse:
    """Chạy pipeline profiling.

    Graph dừng trước `hitl_review`, nên response trả về là **bản nháp**: các đề
    xuất đã có confidence + evidence nhưng chưa ai xác nhận. Analyst gọi
    `PATCH /profile/{id}/confirm` để duyệt và chạy tiếp.
    """
    settings = get_settings()
    get_rate_limiter().check(user)

    state = initial_profiling_state(
        dataset_ref=request.dataset_ref,
        dataset_name=request.dataset_name or request.dataset_ref,
        scan_mode=request.scan_mode or settings.profiling_default_scan_mode,
        sampling_config=request.sampling.model_dump() if request.sampling else None,
        requested_by=user,
        question=request.question,
    )

    graph = get_profiling_graph()
    try:
        # Graph chạy sync (DuckDB/pandas là blocking) — đẩy sang thread pool để
        # không chặn event loop của FastAPI.
        result = await asyncio.to_thread(graph.invoke, state, _thread_config("bootstrap"))
    except Exception as exc:  # noqa: BLE001
        logger.exception("Profiling thất bại")
        raise HTTPException(status_code=500, detail=f"Profiling thất bại: {exc}") from exc

    run_id = result.get("profile_run_id")
    if not run_id:
        raise HTTPException(
            status_code=400,
            detail=result.get("error") or "Không tạo được profile run.",
        )
    if result.get("error"):
        # Ingest lỗi (file không tồn tại...) — trả 400 kèm run id để tra audit.
        raise HTTPException(status_code=400, detail=result["error"])

    get_audit().log("api_profile", profile_run_id=run_id, user=user, dataset=request.dataset_ref)
    return _build_profile_response(run_id)


@router.get("/profile/{run_id}", response_model=ProfileResponse)
async def get_profile(run_id: str, user: str = Depends(require_token)) -> ProfileResponse:
    """Đọc hồ sơ đã profiling. Giá trị mẫu của cột PII bị ẩn (eval C-01)."""
    get_rate_limiter().check(user)
    return _build_profile_response(run_id)


@router.get("/profile/{run_id}/export")
async def export_profile(run_id: str, user: str = Depends(require_token)) -> dict[str, Any]:
    """Xuất hồ sơ dạng JSON.

    Chỉ xuất **metadata và thống kê**, không bao giờ xuất dữ liệu thô — kể cả
    khi `allow_raw_export` được bật (eval C-02). Cờ đó chỉ mở phần `top_k_values`
    của cột không phải PII.
    """
    settings = get_settings()
    get_rate_limiter().check(user)

    profile = get_repository().full_profile(run_id, mask_pii=True)
    if not profile:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy profile run '{run_id}'.")

    if not settings.security_allow_raw_export:
        for row in profile["column_stats"]:
            row["top_k_values"] = None

    get_audit().log("api_export", profile_run_id=run_id, user=user)
    return {
        "note": (
            "Đây là hồ sơ thống kê, không phải dữ liệu thô. Agent không xuất dữ liệu "
            "gốc của dataset."
        ),
        "profile": profile,
    }


# --------------------------------------------------------------------------- #
# HITL
# --------------------------------------------------------------------------- #
@router.patch("/profile/{run_id}/confirm", response_model=ConfirmResponse)
async def confirm_proposals(
    run_id: str,
    request: ConfirmRequest,
    user: str = Depends(require_token),
) -> ConfirmResponse:
    """Analyst xác nhận/từ chối/sửa đề xuất, rồi pipeline chạy tiếp.

    Đây là cửa duy nhất để một proposal chuyển sang `confirmed`. Agent không có
    đường nào tự làm việc này (eval C-03).
    """
    repo = get_repository()
    get_rate_limiter().check(user)

    if not repo.get_profile_run(run_id):
        raise HTTPException(status_code=404, detail=f"Không tìm thấy profile run '{run_id}'.")

    status_map = {"confirm": "confirmed", "reject": "rejected", "edit": "edited"}
    applied = 0
    for decision in request.decisions:
        if decision.decision == "edit" and not decision.final_type:
            raise HTTPException(
                status_code=422,
                detail=f"Proposal '{decision.proposal_id}': decision='edit' cần final_type.",
            )
        ok = repo.update_proposal(
            decision.kind,
            decision.proposal_id,
            status_map[decision.decision],
            confirmed_by=request.confirmed_by,
            final_type=decision.final_type,
        )
        if not ok:
            raise HTTPException(
                status_code=404,
                detail=f"Không tìm thấy proposal '{decision.proposal_id}' ({decision.kind}).",
            )
        applied += 1
        get_audit().log(
            "hitl_decision",
            profile_run_id=run_id,
            kind=decision.kind,
            proposal_id=decision.proposal_id,
            decision=decision.decision,
            confirmed_by=request.confirmed_by,
            note=decision.note,
            user=user,
        )

    run = repo.get_profile_run(run_id)
    pending = repo.pending_count(run_id)

    if request.resume:
        # Chạy summarize để có báo cáo phản ánh quyết định vừa duyệt.
        stats = repo.get_column_stats(run_id)
        proposals = repo.get_proposals(run_id)
        state = {
            "profile_run_id": run_id,
            "dataset_id": run["dataset_id"],
            "dataset_name": (repo.get_dataset(run["dataset_id"]) or {}).get("name"),
            "row_count": run.get("row_count"),
            "column_names": list(stats.keys()),
            "scan_mode": run.get("scan_mode"),
            "is_approximate": bool(run.get("is_approximate")),
            "stats_json": stats,
            "correlation_matrix": run.get("correlation_matrix") or {},
            "quasi_identifiers": run.get("quasi_identifiers") or [],
            "candidate_key_proposals": proposals["candidate_key"],
            "semantic_type_proposals": proposals["semantic_type"],
            "pii_proposals": proposals["pii"],
            "test_results": repo.get_test_results(run_id),
            "hitl_decision": "confirm",
        }
        try:
            await asyncio.to_thread(summarize_node, state)
        except Exception as exc:  # noqa: BLE001 - đã xác nhận rồi, không rollback vì báo cáo lỗi
            logger.warning("Không sinh được báo cáo sau khi xác nhận: %s", exc)

    run = repo.get_profile_run(run_id) or run
    return ConfirmResponse(
        profile_run_id=run_id,
        applied=applied,
        pending_proposals=pending,
        status=run["status"],
        narrative_report=run.get("narrative_report"),
        risk_warnings=run.get("risk_warnings") or [],
    )


# --------------------------------------------------------------------------- #
# Kiểm định thống kê
# --------------------------------------------------------------------------- #
@router.post("/profile/{run_id}/test", response_model=TestResponse)
async def run_statistical_tests(
    run_id: str,
    request: TestRequest,
    user: str = Depends(require_token),
) -> TestResponse:
    """Chạy kiểm định thống kê theo yêu cầu của Analyst.

    Nhiều kiểm định cùng lúc sẽ được hiệu chỉnh đa kiểm định (L1) — p điều chỉnh
    và kết luận sau hiệu chỉnh đều nằm trong response.
    """
    from src.agents.nodes.profiling_nodes import get_dataframe

    settings = get_settings()
    repo = get_repository()
    get_rate_limiter().check(user)

    if not repo.get_profile_run(run_id):
        raise HTTPException(status_code=404, detail=f"Không tìm thấy profile run '{run_id}'.")

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
    repo.save_test_results(run_id, results, requested_by=request.requested_by)
    get_audit().log(
        "api_test",
        profile_run_id=run_id,
        user=user,
        requested_by=request.requested_by,
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
    user: str = Depends(require_token),
) -> DriftResponse:
    """So sánh hai lần profiling để phát hiện drift (PSI, dịch mean/std, schema)."""
    repo = get_repository()
    get_rate_limiter().check(user)

    current_id = request.current_run_id or run_id
    for rid in (request.baseline_run_id, current_id):
        if not repo.get_profile_run(rid):
            raise HTTPException(status_code=404, detail=f"Không tìm thấy profile run '{rid}'.")
    if request.baseline_run_id == current_id:
        raise HTTPException(status_code=422, detail="Hai run so sánh phải khác nhau.")

    findings, summary = drift_service.compare_runs(
        repo.column_stats_rows(request.baseline_run_id),
        repo.column_stats_rows(current_id),
    )
    repo.save_drift_report(request.baseline_run_id, current_id, findings, summary)
    get_audit().log(
        "api_drift",
        profile_run_id=current_id,
        baseline_run_id=request.baseline_run_id,
        user=user,
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
def _qa_state(request: QARequest, user: str) -> dict[str, Any]:
    columns: list[str] = []
    if request.profile_run_id:
        repo = get_repository()
        if not repo.get_profile_run(request.profile_run_id):
            raise HTTPException(
                status_code=404,
                detail=f"Không tìm thấy profile run '{request.profile_run_id}'.",
            )
        columns = list(repo.get_column_stats(request.profile_run_id).keys())
    return initial_qa_state(
        question=request.question,
        profile_run_id=request.profile_run_id,
        column_names=columns,
        requested_by=user,
    )


@router.post("/qa", response_model=QAResponse)
async def ask_question(
    request: QARequest,
    user: str = Depends(require_token),
) -> QAResponse:
    """Q&A không streaming — tiện cho script và test."""
    get_rate_limiter().check(user)
    state = _qa_state(request, user)

    try:
        result = await asyncio.to_thread(get_qa_graph().invoke, state)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Q&A thất bại")
        raise HTTPException(status_code=500, detail=f"Q&A thất bại: {exc}") from exc

    is_approximate = False
    if request.profile_run_id:
        run = get_repository().get_profile_run(request.profile_run_id)
        is_approximate = bool((run or {}).get("is_approximate"))

    return QAResponse(
        question=request.question,
        question_type=result.get("question_type"),
        answer=result.get("answer") or "",
        sources=result.get("answer_sources") or [],
        is_approximate=is_approximate,
    )


def _sse(event: str, data: Any) -> str:
    """Đóng gói một SSE frame (ADR-010)."""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


@router.post("/qa/stream")
async def ask_question_stream(
    request: QARequest,
    user: str = Depends(require_token),
) -> StreamingResponse:
    """Q&A streaming qua SSE.

    Event: `token` (từng đoạn văn bản) → `source` (danh sách nguồn) →
    `done` (kết thúc) | `error`.

    Nhánh định lượng cần gọi tool nhiều vòng nên không stream token được — nó
    chạy xong rồi phát một lần, còn nhánh định tính stream token thật.
    """
    get_rate_limiter().check(user)
    state = _qa_state(request, user)

    async def generator() -> Any:
        try:
            routed = await asyncio.to_thread(get_qa_graph().invoke, state)
            answer = routed.get("answer") or ""
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
            yield _sse("done", {"question_type": qtype, "length": len(answer)})

            get_audit().log(
                "qa_stream",
                profile_run_id=request.profile_run_id,
                user=user,
                question=request.question[:200],
                question_type=qtype,
            )
        except LLMNotConfiguredError as exc:
            yield _sse("error", {"detail": str(exc)})
        except Exception as exc:  # noqa: BLE001
            logger.exception("SSE Q&A thất bại")
            yield _sse("error", {"detail": f"Lỗi khi trả lời: {exc}"})

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
    file: UploadFile = File(..., description="CSV / TSV / Parquet / JSON"),
    user: str = Depends(require_token),
) -> UploadResponse:
    """Nhận file dữ liệu từ Analyst và trả `dataset_ref` để gọi `POST /profile`.

    Ba lớp chặn: đuôi file phải nằm trong whitelist, tên file được làm sạch
    (chống path traversal), và dung lượng bị cắt theo `security.max_upload_mb`.
    File được đọc theo từng chunk nên request quá lớn bị chặn trước khi kịp
    chiếm hết RAM.
    """
    get_rate_limiter().check(user)
    settings = get_settings()

    try:
        name = safe_filename(file.filename or "")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    limit_bytes = settings.security_max_upload_mb * 1024 * 1024
    settings.upload_path.mkdir(parents=True, exist_ok=True)

    # Thêm hậu tố ngẫu nhiên để hai người upload cùng tên file không ghi đè nhau.
    target = settings.upload_path / f"{PurePath(name).stem}-{uuid4().hex[:8]}{PurePath(name).suffix}"

    size = 0
    try:
        with target.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > limit_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=(
                            f"File vượt giới hạn {settings.security_max_upload_mb} MB. "
                            "Với dữ liệu lớn hơn, đặt file lên server và truyền đường dẫn "
                            "vào dataset_ref, rồi chạy profiling ở chế độ sample."
                        ),
                    )
                out.write(chunk)
    except HTTPException:
        target.unlink(missing_ok=True)  # không giữ lại file dở dang
        raise
    except OSError as exc:
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Không ghi được file: {exc}") from exc
    finally:
        await file.close()

    if size == 0:
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail="File rỗng.")

    get_audit().log("api_upload", user=user, filename=name, stored=target.name, bytes=size)
    logger.info("Đã nhận file upload %s (%d bytes)", target.name, size)

    return UploadResponse(
        dataset_ref=str(target),
        filename=target.name,
        size_bytes=size,
        suggested_name=PurePath(name).stem,
    )


@router.get("/datasets", response_model=list[DatasetOut])
async def list_datasets(user: str = Depends(require_token)) -> list[DatasetOut]:
    get_rate_limiter().check(user)
    return [DatasetOut(**d) for d in get_repository().list_datasets()]


@router.get("/datasets/{dataset_id}/runs", response_model=list[ProfileRunSummary])
async def list_runs(
    dataset_id: str,
    limit: int = Query(default=50, ge=1, le=500),
    user: str = Depends(require_token),
) -> list[ProfileRunSummary]:
    get_rate_limiter().check(user)
    repo = get_repository()
    if not repo.get_dataset(dataset_id):
        raise HTTPException(status_code=404, detail=f"Không tìm thấy dataset '{dataset_id}'.")
    return [ProfileRunSummary(**r) for r in repo.list_profile_runs(dataset_id, limit=limit)]


@router.get("/status", response_model=StatusResponse)
async def status() -> StatusResponse:
    """Cấu hình hiện tại + danh sách biến môi trường còn thiếu."""
    settings = get_settings()
    try:
        indexed = len(get_index().documents)
    except Exception:  # noqa: BLE001
        indexed = 0

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
        indexed_documents=indexed,
        missing_config=settings.missing_required(),
    )


@router.get("/audit")
async def audit_tail(
    limit: int = Query(default=100, ge=1, le=1000),
    user: str = Depends(require_token),
) -> dict[str, Any]:
    """Xem audit log gần nhất — dùng để review các quyết định auto-confirm."""
    get_rate_limiter().check(user)
    return {"entries": get_audit().tail(limit)}


__all__ = ["router"]
