"""Các node của pipeline profiling: ingest → compute_stats → propose_metadata
→ HITL → deep_analysis → summarize.

Mỗi node là hàm thuần nhận `ProfilingState` và trả về **phần state đã đổi**.
LangGraph tự merge. Node nào lỗi thì ghi vào `state["error"]` để router dừng
pipeline thay vì để exception phá vỡ graph.

Dataframe không nằm trong state (không serialize được vào checkpointer) — nó
được cache theo `profile_run_id` trong `dataframe_cache`, và load lại từ
`executed_query` nếu cache trống sau restart.
"""

from __future__ import annotations

import json
import re
from typing import Any

import pandas as pd
from langgraph.types import interrupt
from src.agents.prompts import BASE_RULES, SEMANTIC_TYPE_REFINE_PROMPT, SUMMARIZE_PROMPT
from src.agents.state import ProfilingState
from src.config import get_settings
from src.services import compute
from src.services.guardrails import enforce_output_guardrails
from src.services.llm import LLMNotConfiguredError, get_llm
from src.services.repository import get_repository
from src.services.retrieval import get_index
from src.services.security import get_audit
from src.services.stats_tests import run_tests

# --------------------------------------------------------------------------- #
# Cache dataframe theo profile_run_id
# --------------------------------------------------------------------------- #
# Dataframe quá lớn để đưa vào LangGraph state (phải JSON-serialize vào
# checkpointer). Giữ ngoài state, mất cache thì load lại từ executed_query.
_dataframes: dict[str, pd.DataFrame] = {}
_MAX_CACHED = 8


def cache_dataframe(run_id: str, df: pd.DataFrame) -> None:
    if len(_dataframes) >= _MAX_CACHED:
        _dataframes.pop(next(iter(_dataframes)))
    _dataframes[run_id] = df


def get_dataframe(run_id: str) -> pd.DataFrame | None:
    """Lấy dataframe từ cache; cache trống thì load lại đúng query đã chạy (L5)."""
    df = _dataframes.get(run_id)
    if df is not None:
        return df

    run = get_repository().get_profile_run(run_id)
    if not run:
        return None

    dataset = get_repository().get_dataset(run["dataset_id"])
    if not dataset:
        return None

    try:
        df, _query, _truncated = compute.load_dataset(
            dataset["source_ref"],
            scan_mode=run["scan_mode"],
            sample_size=run.get("sample_size") or 10_000,
            sample_strategy=run.get("sampling_strategy") or "reservoir",
            random_seed=run.get("random_seed"),
        )
    except (FileNotFoundError, ValueError):
        return None

    cache_dataframe(run_id, df)
    return df


def clear_dataframe_cache() -> None:
    _dataframes.clear()


# --------------------------------------------------------------------------- #
# ingest
# --------------------------------------------------------------------------- #
def ingest_node(state: ProfilingState) -> dict[str, Any]:
    """Load the pre-created dataset/run and mark the execution as running."""
    settings = get_settings()
    repo = get_repository()

    dataset_id = state.get("dataset_id")
    run_id = state.get("profile_run_id")
    if not dataset_id or not run_id:
        return {"error": "Profiling state thiếu dataset_id hoặc profile_run_id."}
    run = repo.get_profile_run(run_id)
    dataset = repo.get_dataset(dataset_id)
    if not run or run.get("dataset_id") != dataset_id or not dataset:
        return {"error": "Profile run không còn ánh xạ an toàn tới dataset."}
    repo.transition_profile_run(run_id, {"created", "running"}, "running")
    dataset_ref = dataset["source_ref"]
    scan_mode = state.get("scan_mode", settings.profiling_default_scan_mode)
    config = dict(state.get("sampling_config") or {})

    sample_size = int(config.get("sample_size", settings.profiling_sample_size))
    strategy = str(config.get("strategy", settings.profiling_sample_strategy))
    seed = config.get("random_seed", settings.profiling_random_seed)
    seed = int(seed) if seed is not None else None

    try:
        df, query, truncated = compute.load_dataset(
            dataset_ref,
            scan_mode=scan_mode,
            sample_size=sample_size,
            sample_strategy=strategy,
            random_seed=seed,
            max_columns=settings.profiling_max_columns,
        )
    except (FileNotFoundError, ValueError) as exc:
        repo.update_profile_run(run_id, status="failed", error=str(exc))
        return {
            "dataset_id": dataset_id,
            "profile_run_id": run_id,
            "error": f"Không nạp được dataset: {exc}",
        }

    cache_dataframe(run_id, df)
    repo.update_profile_run(run_id, row_count=len(df), executed_query=query)
    get_audit().log(
        "ingest",
        profile_run_id=run_id,
        dataset_ref=dataset_ref,
        scan_mode=scan_mode,
        row_count=len(df),
        requested_by=state.get("requested_by"),
    )

    update: dict[str, Any] = {
        "dataset_id": dataset_id,
        "profile_run_id": run_id,
        "scan_mode": scan_mode,
        "row_count": len(df),
        "column_names": [str(c) for c in df.columns],
        "executed_query": query,
        "truncated_columns": truncated,
        "is_approximate": scan_mode == "sample",
        "sampling_config": {
            "strategy": strategy,
            "sample_size": sample_size,
            "random_seed": seed,
        }
        if scan_mode == "sample"
        else None,
        "tool_calls": state.get("tool_calls", 0) + 1,
    }
    if truncated:
        update["risk_warnings"] = [
            (
                f"Dataset có nhiều hơn {settings.profiling_max_columns} cột; "
                f"{len(truncated)} cột cuối bị bỏ qua trong lần profiling này."
            )
        ]
    return update


# --------------------------------------------------------------------------- #
# compute_stats
# --------------------------------------------------------------------------- #
def compute_stats_node(state: ProfilingState) -> dict[str, Any]:
    """Tính thống kê mô tả + tương quan + PII bằng compute engine (ADR-005)."""
    settings = get_settings()
    repo = get_repository()
    run_id = state["profile_run_id"]

    df = get_dataframe(run_id)
    if df is None:
        return {"error": "Không tìm thấy dữ liệu đã nạp để tính thống kê."}

    scan_mode = state.get("scan_mode", "sample")
    pii_flags = compute.detect_pii(df)
    pii_columns = {f["column_name"] for f in pii_flags}

    stats = compute.compute_column_stats(
        df,
        scan_mode=scan_mode,
        top_k=settings.profiling_top_k_values,
        outlier_method=settings.profiling_outlier_method,
        pii_columns=pii_columns,
    )
    correlation = compute.compute_correlation_matrix(df)
    quasi = compute.detect_quasi_identifiers(df, pii_columns)
    duplicate_row_count = int(len(df) - len(df.drop_duplicates()))

    repo.save_column_stats(run_id, stats)
    repo.update_profile_run(
        run_id,
        correlation_matrix=correlation,
        quasi_identifiers=quasi,
        duplicate_row_count=duplicate_row_count,
        duplicate_row_rate=(duplicate_row_count / len(df)) if len(df) else 0.0,
        is_approximate=scan_mode == "sample",
    )
    get_audit().log("compute_stats", profile_run_id=run_id, columns=len(stats))

    return {
        "stats_json": stats,
        "correlation_matrix": correlation,
        "pii_flags": pii_flags,
        "quasi_identifiers": quasi,
        "is_approximate": scan_mode == "sample",
        "tool_calls": state.get("tool_calls", 0) + 1,
    }


# --------------------------------------------------------------------------- #
# propose_metadata
# --------------------------------------------------------------------------- #
_VALID_SEMANTIC_TYPES = {"ID", "categorical", "ordinal", "continuous", "datetime", "free-text"}


def _refine_semantic_types(
    uncertain: list[dict[str, Any]],
    stats: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Nhờ LLM tinh chỉnh các cột luật suy ra với confidence thấp.

    Gộp TẤT CẢ cột vào một lần gọi để giữ cost ở mức 1 call/bảng (L4).
    Lỗi hoặc thiếu key thì bỏ qua — giữ nguyên kết quả rule-based.
    """
    if not uncertain:
        return {}

    lines = []
    for item in uncertain:
        col = item["column_name"]
        st = stats.get(col, {})
        samples = [
            str(v.get("value")) for v in (st.get("top_k_values") or [])[:5] if isinstance(v, dict)
        ]
        lines.append(
            f"- {col}: dtype={st.get('dtype')}, cardinality={st.get('cardinality')}, "
            f"uniqueness={st.get('uniqueness_ratio')}, null%={st.get('null_pct')}, "
            f"độ dài tối đa={st.get('max_length')}, giá trị mẫu={samples or 'không có (cột PII)'}"
        )

    try:
        llm = get_llm()
        response = llm.invoke(
            [
                {"role": "system", "content": BASE_RULES},
                {
                    "role": "user",
                    "content": SEMANTIC_TYPE_REFINE_PROMPT.format(columns_block="\n".join(lines)),
                },
            ]
        )
        text = enforce_output_guardrails(
            str(response.content), get_settings().guardrails_max_output_chars
        ).text
    except (LLMNotConfiguredError, Exception):  # noqa: BLE001 - LLM là tuỳ chọn ở bước này
        return {}

    match = re.search(r"\[.*\]", text, re.DOTALL)
    if not match:
        return {}
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError:
        return {}

    out: dict[str, dict[str, Any]] = {}
    for item in parsed if isinstance(parsed, list) else []:
        if not isinstance(item, dict):
            continue
        col = str(item.get("column_name", ""))
        proposed = str(item.get("proposed_type", ""))
        if col not in stats or proposed not in _VALID_SEMANTIC_TYPES:
            continue
        try:
            confidence = float(item.get("confidence", 0.6))
        except (TypeError, ValueError):
            confidence = 0.6
        out[col] = {
            "proposed_type": proposed,
            # LLM đề xuất luôn bị chặn dưới 0.95 để không tự vào diện auto-confirm.
            "confidence": min(max(confidence, 0.0), 0.94),
            "description": str(item.get("description", "")).strip(),
            "evidence": f"LLM phân loại dựa trên số liệu: {item.get('evidence', 'không nêu')}",
        }
    return out


def propose_metadata_node(state: ProfilingState) -> dict[str, Any]:
    """Đề xuất candidate key, semantic type, PII — kèm confidence + evidence."""
    repo = get_repository()
    run_id = state["profile_run_id"]
    stats = state.get("stats_json") or {}
    if not stats:
        return {"error": "Chưa có thống kê để đề xuất metadata."}

    df = get_dataframe(run_id)

    # 1. Candidate key — tính từ uniqueness/null thật, không qua LLM.
    ck_raw = (
        compute.find_candidate_keys(df, stats)
        if df is not None
        else [
            {
                "columns": [col],
                "confidence": 0.99,
                "evidence": "uniqueness = 100%, null% = 0% (từ column_stats).",
            }
            for col, st in stats.items()
            if st.get("uniqueness_ratio", 0) >= 1.0 and st.get("null_pct", 100) == 0.0
        ]
    )
    candidate_keys = [
        {
            "columns": item["columns"],
            "confidence_score": item["confidence"],
            "evidence": item["evidence"],
            "status": "pending",
        }
        for item in ck_raw
    ]

    # 2. Semantic type — luật trước, LLM chỉ tinh chỉnh phần chưa rõ.
    semantic: list[dict[str, Any]] = []
    for col, st in stats.items():
        inferred = compute.infer_semantic_type(col, st)
        semantic.append(
            {
                "column_name": col,
                "proposed_type": inferred["type"],
                "semantic_description": inferred.get("description"),
                "confidence_score": inferred["confidence"],
                "evidence": f"{inferred['evidence']} Mô tả: {inferred.get('description', 'chưa có')}.",
                "status": "pending",
            }
        )

    uncertain = [s for s in semantic if s["confidence_score"] < 0.8]
    refined = _refine_semantic_types(uncertain, stats)
    for item in semantic:
        better = refined.get(item["column_name"])
        if better and better["confidence"] > item["confidence_score"]:
            item["proposed_type"] = better["proposed_type"]
            item["confidence_score"] = better["confidence"]
            item["evidence"] = better["evidence"]
            item["semantic_description"] = better.get("description") or item.get("semantic_description")

    # 3. PII — nâng flag thành proposal entity (ADR-003).
    pii = [
        {
            "column_name": flag["column_name"],
            "pii_type": flag.get("pii_type"),
            "detection_method": flag["detection_method"],
            "confidence_score": flag["confidence"],
            "evidence": flag["evidence"],
            "status": "pending",
        }
        for flag in state.get("pii_flags") or []
    ]

    repo.save_proposals(run_id, "candidate_key", candidate_keys)
    repo.save_proposals(run_id, "semantic_type", semantic)
    repo.save_proposals(run_id, "pii", pii)

    # Cảnh báo rủi ro tính ngay ở đây, TRƯỚC điểm chờ HITL: Analyst cần thấy
    # rủi ro để quyết định duyệt hay không. `summarize` sẽ tính lại sau khi có
    # thêm kết quả kiểm định.
    warnings = _risk_warnings({**state, "pii_proposals": pii})
    repo.update_profile_run(run_id, risk_warnings=warnings)

    get_audit().log(
        "propose_metadata",
        profile_run_id=run_id,
        candidate_keys=len(candidate_keys),
        semantic_types=len(semantic),
        pii=len(pii),
    )

    return {
        "candidate_key_proposals": candidate_keys,
        "semantic_type_proposals": semantic,
        "pii_proposals": pii,
        "risk_warnings": warnings,
        "tool_calls": state.get("tool_calls", 0) + 1,
    }


# --------------------------------------------------------------------------- #
# hitl_review
# --------------------------------------------------------------------------- #
def hitl_review_node(state: ProfilingState) -> dict[str, Any]:
    """HITL phân tầng (ADR-004).

    Auto-confirm chỉ áp dụng cho loại rủi ro thấp (mặc định: semantic_type) và
    confidence ≥ ngưỡng. Candidate key và PII **luôn** cần Analyst xác nhận —
    hai loại này ảnh hưởng schema production và compliance.

    Graph được compile với `interrupt_after=["hitl_review"]` nên sau node này
    pipeline dừng lại, chờ `PATCH /profile/{id}/confirm`.
    """
    settings = get_settings()
    repo = get_repository()
    audit = get_audit()
    run_id = state["profile_run_id"]

    auto_confirmed: list[dict[str, Any]] = []

    if settings.hitl_auto_confirm:
        threshold = settings.hitl_confidence_threshold
        low_risk = set(settings.hitl_low_risk_types)
        stored = repo.get_proposals(run_id)

        for kind in ("candidate_key", "semantic_type", "pii"):
            if kind not in low_risk:
                continue
            for proposal in stored.get(kind, []):
                if proposal["status"] != "pending":
                    continue
                if (proposal.get("confidence_score") or 0.0) < threshold:
                    continue
                repo.update_proposal(
                    kind, proposal["id"], "auto_confirmed", confirmed_by="system:auto", run_id=run_id
                )
                record = {
                    "kind": kind,
                    "proposal_id": proposal["id"],
                    "confidence": proposal["confidence_score"],
                    "reason": f"confidence ≥ {threshold} và '{kind}' thuộc nhóm rủi ro thấp",
                }
                auto_confirmed.append(record)
                # ADR-004 bắt buộc trace mọi auto-confirm để Analyst review async.
                audit.log("auto_confirm", profile_run_id=run_id, **record)

    pending = repo.pending_count(run_id)
    resume_requested = bool(state.get("resume_requested"))
    payload: dict[str, Any] | None = None
    if pending or resume_requested:
        repo.update_profile_run(run_id, status="pending_review" if pending else "resuming")
        payload = interrupt({
            "type": "profile_review",
            "profile_run_id": run_id,
            "pending_proposals": pending,
            "proposals": repo.get_proposals(run_id),
            "actions": ["confirm", "edit", "reject", "request_test"],
        })

    update: dict[str, Any] = {
        "auto_confirmed": auto_confirmed,
        "hitl_pending": pending,
        "tool_calls": state.get("tool_calls", 0) + 1,
        "messages": [
            {
                "role": "system",
                "content": (
                    f"HITL: {pending} proposal chờ Analyst xác nhận, "
                    f"{len(auto_confirmed)} proposal auto-confirm."
                ),
            }
        ],
    }
    if payload is not None:
        if not isinstance(payload, dict):
            return {**update, "error": "Payload HITL không hợp lệ."}
        update["hitl_decision"] = payload.get("action") or payload.get("decision")
        update["test_requests"] = payload.get("test_requests") or []
        update["review_payload"] = payload
        update["resume_requested"] = False
    return update


def route_hitl_decision(state: ProfilingState) -> str:
    """Conditional edge sau HITL. Chặn loop deep_analysis vượt ngưỡng (L3)."""
    if state.get("error"):
        return "summarize"

    decision = state.get("hitl_decision")
    settings = get_settings()

    if decision == "request_test":
        if state.get("deep_analysis_count", 0) >= settings.hitl_max_deep_analysis:
            return "summarize"
        return "deep_analysis"
    if decision == "reject":
        return "propose_metadata"
    # confirm / edit / chưa quyết định -> đi tiếp để có báo cáo.
    return "summarize"


# --------------------------------------------------------------------------- #
# deep_analysis
# --------------------------------------------------------------------------- #
def deep_analysis_node(state: ProfilingState) -> dict[str, Any]:
    """Chạy kiểm định thống kê Analyst yêu cầu, có hiệu chỉnh FDR (L1)."""
    settings = get_settings()
    repo = get_repository()
    run_id = state["profile_run_id"]
    requests = state.get("test_requests") or []

    if not requests:
        return {"tool_calls": state.get("tool_calls", 0) + 1}

    df = get_dataframe(run_id)
    if df is None:
        return {"error": "Không tìm thấy dữ liệu để chạy kiểm định."}

    results = run_tests(
        df,
        requests,
        alpha=settings.stats_alpha,
        fdr_method=settings.stats_fdr_method,
        max_tests=settings.stats_max_tests_per_request,
    )
    repo.save_test_results(run_id, results, requested_by=state.get("requested_by"))
    get_audit().log(
        "deep_analysis",
        profile_run_id=run_id,
        tests=[r["test_type"] for r in results],
        requested_by=state.get("requested_by"),
    )

    return {
        "test_results": (state.get("test_results") or []) + results,
        "test_requests": [],  # đã chạy xong, xoá để lần sau không chạy lại
        "deep_analysis_count": state.get("deep_analysis_count", 0) + 1,
        "tool_calls": state.get("tool_calls", 0) + 1,
    }


# --------------------------------------------------------------------------- #
# summarize
# --------------------------------------------------------------------------- #
def _risk_warnings(state: ProfilingState) -> list[str]:
    """Cảnh báo suy ra từ số liệu — deterministic, không nhờ LLM."""
    warnings: list[str] = list(state.get("risk_warnings") or [])
    stats = state.get("stats_json") or {}
    approx = "≈ " if state.get("is_approximate") else ""

    for col, st in stats.items():
        null_pct = st.get("null_pct") or 0.0
        if null_pct >= 50:
            warnings.append(f"Cột '{col}' thiếu {approx}{null_pct:.2f}% giá trị — gần như không dùng được.")
        elif null_pct >= 20:
            warnings.append(f"Cột '{col}' thiếu {approx}{null_pct:.2f}% giá trị — cần xử lý null.")

        if st.get("cardinality") == 1:
            warnings.append(f"Cột '{col}' chỉ có 1 giá trị duy nhất — không mang thông tin phân biệt.")

        outliers = st.get("outlier_count") or 0
        row_count = st.get("row_count") or 0
        if outliers and row_count and outliers / row_count >= 0.05:
            warnings.append(
                f"Cột '{col}' có {outliers} outlier ({outliers / row_count:.1%} số dòng, "
                f"phương pháp {st.get('outlier_method')})."
            )

    for proposal in state.get("pii_proposals") or []:
        warnings.append(
            f"Cột '{proposal['column_name']}' nghi là PII ({proposal.get('pii_type')}, "
            f"confidence {proposal['confidence_score']:.0%}) — giá trị đã được ẩn khỏi báo cáo."
        )

    quasi = state.get("quasi_identifiers") or []
    if len(quasi) >= 2:
        warnings.append(
            f"Có {len(quasi)} cột quasi-identifier ({', '.join(quasi[:5])}) — ghép lại có rủi ro "
            f"tái định danh cá nhân dù từng cột không phải PII."
        )

    # Tương quan rất cao giữa hai cột khác nhau -> khả năng trùng lặp thông tin.
    for a, row in (state.get("correlation_matrix") or {}).items():
        for b, value in row.items():
            if a < b and abs(value) >= 0.95:
                warnings.append(
                    f"Cột '{a}' và '{b}' tương quan {value:.3f} — có thể trùng lặp thông tin."
                )

    if state.get("is_approximate"):
        warnings.append(
            f"Toàn bộ số liệu là ước lượng từ mẫu {state.get('row_count')} dòng — "
            f"không phải giá trị chính xác của toàn bảng."
        )

    # Giữ thứ tự xuất hiện nhưng bỏ trùng.
    return list(dict.fromkeys(warnings))


def _profile_digest(state: ProfilingState, warnings: list[str]) -> str:
    """Gói số liệu thành JSON gọn để đưa vào prompt — cột PII đã bị mask."""
    pii_columns = {p["column_name"] for p in state.get("pii_proposals") or []}
    stats_digest = {}
    for col, st in (state.get("stats_json") or {}).items():
        entry = {
            k: st.get(k)
            for k in (
                "dtype",
                "null_pct",
                "cardinality",
                "uniqueness_ratio",
                "min_value",
                "max_value",
                "mean",
                "median",
                "std",
                "outlier_count",
                "is_approximate",
                "margin_of_error",
            )
        }
        if col in pii_columns:
            entry["pii"] = True
            entry["top_k_values"] = "ĐÃ ẨN (cột PII)"
        else:
            entry["top_k_values"] = st.get("top_k_values")
        stats_digest[col] = entry

    return json.dumps(
        {
            "dataset": state.get("dataset_name"),
            "row_count": state.get("row_count"),
            "column_count": len(state.get("column_names") or []),
            "scan_mode": state.get("scan_mode"),
            "is_approximate": state.get("is_approximate"),
            "column_stats": stats_digest,
            "correlation_matrix": state.get("correlation_matrix"),
            "candidate_key_proposals": state.get("candidate_key_proposals"),
            "semantic_type_proposals": state.get("semantic_type_proposals"),
            "pii_proposals": state.get("pii_proposals"),
            "quasi_identifiers": state.get("quasi_identifiers"),
            "test_results": state.get("test_results"),
            "risk_warnings": warnings,
        },
        ensure_ascii=False,
        default=str,
    )


def _fallback_report(state: ProfilingState, warnings: list[str]) -> str:
    """Báo cáo dạng bảng khi chưa cấu hình LLM — vẫn dùng được, chỉ không có văn."""
    approx = "≈" if state.get("is_approximate") else ""
    lines = [
        f"# Hồ sơ dữ liệu — {state.get('dataset_name')}",
        "",
        f"- Số dòng: {approx}{state.get('row_count')}",
        f"- Số cột: {len(state.get('column_names') or [])}",
        f"- Chế độ quét: {state.get('scan_mode')}",
        "",
        "## Thống kê từng cột",
        "",
        "| Cột | dtype | null% | cardinality | uniqueness |",
        "|---|---|---|---|---|",
    ]
    for col, st in (state.get("stats_json") or {}).items():
        lines.append(
            f"| {col} | {st.get('dtype')} | {approx}{st.get('null_pct')} | "
            f"{approx}{st.get('cardinality')} | {st.get('uniqueness_ratio')} |"
        )
    if warnings:
        lines += ["", "## Cảnh báo", ""] + [f"- {w}" for w in warnings]
    lines += [
        "",
        (
            "> Báo cáo dạng bảng vì chưa cấu hình LLM. Điền API key trong `.env` để có "
            "phần diễn giải bằng ngôn ngữ tự nhiên."
        ),
    ]
    return "\n".join(lines)


def summarize_node(state: ProfilingState) -> dict[str, Any]:
    """Sinh báo cáo NL + cảnh báo rủi ro, rồi index cho QA vector search."""
    repo = get_repository()
    run_id = state.get("profile_run_id")
    warnings = _risk_warnings(state)

    try:
        llm = get_llm()
        response = llm.invoke(
            [
                {"role": "system", "content": BASE_RULES},
                {
                    "role": "user",
                    "content": SUMMARIZE_PROMPT.format(
                        row_count=state.get("row_count"),
                        profile_data=_profile_digest(state, warnings),
                    ),
                },
            ]
        )
        guarded = enforce_output_guardrails(
            str(response.content), get_settings().guardrails_max_output_chars
        )
        report = guarded.text
        if guarded.redactions or guarded.truncated:
            get_audit().log(
                "guardrail_output",
                profile_run_id=run_id,
                stage="summarize",
                redactions=list(guarded.redactions),
                truncated=guarded.truncated,
            )
    except LLMNotConfiguredError:
        report = _fallback_report(state, warnings)
    except Exception as exc:  # noqa: BLE001 - lỗi mạng/quota không được làm mất profiling
        report = _fallback_report(state, warnings)
        warnings.append(f"Không sinh được báo cáo bằng LLM: {exc}")

    if run_id:
        repo.update_profile_run(
            run_id,
            narrative_report=report,
            risk_warnings=warnings,
            status="resuming" if not repo.pending_count(run_id) else "pending_review",
        )
        if state.get("dataset_id"):
            repo.mark_profiled(state["dataset_id"])
        # Index cho QA định tính — mỗi run một document, upsert nên idempotent.
        try:
            get_index().upsert(
                doc_id=f"run:{run_id}",
                text=repo.profile_summary_text(run_id),
                metadata={
                    "profile_run_id": run_id,
                    "dataset_id": state.get("dataset_id"),
                    "dataset_name": state.get("dataset_name"),
                },
            )
        except Exception:  # noqa: BLE001 - index lỗi không được chặn báo cáo
            warnings.append("Không index được kết quả cho QA vector search.")

        get_audit().log("summarize", profile_run_id=run_id, warnings=len(warnings))

    return {
        "narrative_report": report,
        "risk_warnings": warnings,
        "tool_calls": state.get("tool_calls", 0) + 1,
    }


def finalize_profile_node(state: ProfilingState) -> dict[str, Any]:
    """Persist the terminal profiling/QA result as the single finalization step."""
    run_id = state.get("profile_run_id")
    if not run_id:
        return {"error": "Không thể finalize profile không có profile_run_id."}
    repo = get_repository()
    if state.get("question"):
        repo.save_terminal_result(
            run_id,
            question_type=state.get("question_type"),
            answer=state.get("answer") or "",
            answer_sources=state.get("answer_sources") or [],
            terminal_result={
                "question": state.get("question"),
                "question_type": state.get("question_type"),
            },
        )
    else:
        repo.update_profile_run(
            run_id,
            status="completed",
            terminal_result={"profile_run_id": run_id},
        )
    if state.get("dataset_id"):
        repo.mark_profiled(state["dataset_id"])
    get_audit().log(
        "finalize",
        profile_run_id=run_id,
        question_type=state.get("question_type"),
        has_answer=bool(state.get("answer")),
    )
    return {"tool_calls": state.get("tool_calls", 0) + 1}


__all__ = [
    "cache_dataframe",
    "clear_dataframe_cache",
    "compute_stats_node",
    "deep_analysis_node",
    "finalize_profile_node",
    "get_dataframe",
    "hitl_review_node",
    "ingest_node",
    "propose_metadata_node",
    "route_hitl_decision",
    "summarize_node",
]
