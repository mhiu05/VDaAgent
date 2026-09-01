"""State schema cho Data Profiling Agent.

`ProfilingState` là túi dữ liệu chạy xuyên suốt mọi node trong LangGraph. Thiết
kế theo `docs/architecture/agent_architecture.md` mục 3:

    - `messages` dùng `operator.add` để auto-append, không ghi đè.
    - `tool_calls` / `deep_analysis_count` chặn vòng lặp vô hạn (L3).
    - `hitl_decision`, `question_type`, `scan_mode` là cờ điều hướng cho
      conditional edges.
    - `is_approximate` truyền uncertainty từ `compute_stats` tới `summarize`
      (ADR-006).
    - `sampling_config` giữ `random_seed` + `executed_query` cho reproducibility (L5).
"""

from __future__ import annotations

import operator
from typing import Annotated, Any, Literal, TypedDict

ScanMode = Literal["full", "sample"]
HITLDecision = Literal["confirm", "edit", "reject", "request_test"]
QuestionType = Literal["quantitative", "qualitative", "clarify", "guardrail"]


class ProfilingState(TypedDict, total=False):
    """State của pipeline profiling. `total=False` — node chỉ trả field nó đổi."""

    # --- Session & config ---------------------------------------------- #
    messages: Annotated[list[dict[str, Any]], operator.add]
    dataset_id: str
    dataset_ref: str
    dataset_name: str
    profile_run_id: str
    workspace_id: str
    agent_run_id: str
    graph_thread_id: str
    requested_by: str
    scan_mode: ScanMode
    sampling_config: dict[str, Any] | None

    # --- Ingest --------------------------------------------------------- #
    row_count: int
    column_names: list[str]
    executed_query: str
    truncated_columns: list[str]

    # --- Compute stats -------------------------------------------------- #
    stats_json: dict[str, dict[str, Any]]
    correlation_matrix: dict[str, dict[str, float]]
    pii_flags: list[dict[str, Any]]
    quasi_identifiers: list[str]
    is_approximate: bool
    candidate_keys_raw: list[dict[str, Any]]
    duplicate_row_count: int
    duplicate_row_rate: float

    # --- Proposals ------------------------------------------------------ #
    candidate_key_proposals: list[dict[str, Any]]
    semantic_type_proposals: list[dict[str, Any]]
    pii_proposals: list[dict[str, Any]]
    auto_confirmed: list[dict[str, Any]]

    # --- HITL ----------------------------------------------------------- #
    hitl_decision: HITLDecision | None
    hitl_pending: int
    resume_requested: bool
    review_payload: dict[str, Any]
    confirmed_proposals: list[dict[str, Any]]
    rejected_proposals: list[dict[str, Any]]

    # --- Deep analysis -------------------------------------------------- #
    test_requests: list[dict[str, Any]]
    test_results: list[dict[str, Any]]
    deep_analysis_count: int

    # --- Summarize ------------------------------------------------------ #
    narrative_report: str
    risk_warnings: list[str]

    # --- QA ------------------------------------------------------------- #
    question: str
    question_type: QuestionType | None
    # Ngữ cảnh router thu được: cột được nhắc tên, danh sách cột khả dụng.
    qa_context: dict[str, Any]
    selected_skill: str | None
    answer: str
    answer_sources: list[dict[str, Any]]
    # Request-local controls used only by the non-checkpointed QA graph.
    # They must never be persisted as conversation content.
    progress_callback: Any
    cancel_event: Any
    qa_path: str
    fast_path_intent: str | None
    deterministic_claims: list[dict[str, Any]]
    # P1 request controls.  They are request-local and deliberately excluded
    # from the persisted profiling/checkpoint conversation state.
    answer_detail: Literal["quick", "standard", "deep"]
    answerability: Literal["answerable", "needs_clarification", "insufficient_evidence"]
    clarification: dict[str, Any] | None
    qa_started_monotonic: float
    qa_deadline_monotonic: float
    qa_budget_category: str

    # --- Control -------------------------------------------------------- #
    tool_calls: int
    error: str | None
    error_code: str | None


def initial_profiling_state(
    dataset_ref: str,
    dataset_name: str = "",
    scan_mode: ScanMode = "sample",
    sampling_config: dict[str, Any] | None = None,
    requested_by: str = "anonymous",
    question: str | None = None,
    dataset_id: str | None = None,
    profile_run_id: str | None = None,
    workspace_id: str | None = None,
    agent_run_id: str | None = None,
) -> ProfilingState:
    """State khởi tạo cho một lần chạy pipeline profiling.

    `question` có giá trị thì sau `summarize` graph đi tiếp vào nhánh Q&A.
    """
    return ProfilingState(
        messages=[],
        dataset_ref=dataset_ref,
        dataset_name=dataset_name or dataset_ref,
        scan_mode=scan_mode,
        sampling_config=sampling_config,
        requested_by=requested_by,
        dataset_id=dataset_id,
        profile_run_id=profile_run_id,
        workspace_id=workspace_id,
        agent_run_id=agent_run_id,
        stats_json={},
        correlation_matrix={},
        pii_flags=[],
        quasi_identifiers=[],
        is_approximate=scan_mode == "sample",
        candidate_keys_raw=[],
        duplicate_row_count=0,
        duplicate_row_rate=0.0,
        candidate_key_proposals=[],
        semantic_type_proposals=[],
        pii_proposals=[],
        auto_confirmed=[],
        hitl_decision=None,
        confirmed_proposals=[],
        rejected_proposals=[],
        test_requests=[],
        test_results=[],
        deep_analysis_count=0,
        risk_warnings=[],
        question=question,
        qa_context={},
        answer_sources=[],
        tool_calls=0,
        error=None,
        error_code=None,
    )


def initial_qa_state(
    question: str,
    profile_run_id: str | None = None,
    column_names: list[str] | None = None,
    requested_by: str = "anonymous",
    history: list[dict[str, Any]] | None = None,
    workspace_id: str | None = None,
    agent_run_id: str | None = None,
    answer_detail: Literal["quick", "standard", "deep"] = "standard",
    qa_started_monotonic: float | None = None,
    qa_deadline_monotonic: float | None = None,
) -> ProfilingState:
    """State khởi tạo cho một lượt hỏi-đáp (chỉ chạy nhánh QA).

    `profile_run_id` bỏ trống thì QA tìm trên toàn bộ vector index thay vì giới
    hạn trong một lần profiling.
    """
    return ProfilingState(
        messages=history or [],
        question=question,
        profile_run_id=profile_run_id,
        workspace_id=workspace_id,
        agent_run_id=agent_run_id,
        column_names=column_names or [],
        requested_by=requested_by,
        question_type=None,
        qa_context={},
        answer="",
        answer_sources=[],
        tool_calls=0,
        error=None,
        error_code=None,
        answer_detail=answer_detail,
        answerability="answerable",
        clarification=None,
        qa_started_monotonic=qa_started_monotonic or 0.0,
        qa_deadline_monotonic=qa_deadline_monotonic or 0.0,
        qa_budget_category="full_agent",
    )


__all__ = [
    "HITLDecision",
    "ProfilingState",
    "QuestionType",
    "ScanMode",
    "initial_profiling_state",
    "initial_qa_state",
]
