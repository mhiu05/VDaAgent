"""LangGraph state machine của agent profiling (ADR-001).

Sơ đồ theo `docs/architecture/agent_architecture.md`:

    ingest → compute_stats → propose_metadata → hitl_review
                                    ↑               │
                                    │      ┌────────┼────────┐
                                    │   reject   request_test  confirm
                                    └───────┘        │         │
                                              deep_analysis    │
                                                    └──────────┤
                                                          summarize
                                                               │
                                                    ┌──────────┴──────────┐
                                                (có câu hỏi)          (không)
                                                    qa_router          END
                                         ┌────────┬────────┬────────┐
                                  quantitative qualitative clarify guardrail
                                  qa_structured  qa_vector clarify qa_guardrail → END

Graph dùng dynamic `interrupt()` bên trong `hitl_review`: node tự auto-confirm
proposal rủi ro thấp, chỉ checkpoint khi còn proposal pending hoặc đang nhận
resume. API tiếp tục đúng thread riêng của run bằng `Command(resume=...)`.

Hai điểm lệch có ý thức so với sơ đồ trong tài liệu:

1. `summarize` không đi thẳng vào `qa_router`. Nếu request không mang câu hỏi
   thì kết ở `summarize`, vì bắt QA chạy sau mỗi lần profiling sẽ sinh câu trả
   lời rỗng và tốn thêm một lượt LLM.
2. Thêm nhánh `clarify` cho câu hỏi mơ hồ và `qa_guardrail` cho yêu cầu bị
   policy chặn. Nhánh guardrail là deterministic, không gọi LLM/tool/retrieval.
"""

from __future__ import annotations

import logging
from typing import Any

from langgraph.graph import END, StateGraph
from src.agents.nodes.profiling_nodes import (
    compute_stats_node,
    deep_analysis_node,
    finalize_profile_node,
    hitl_review_node,
    ingest_node,
    propose_metadata_node,
    route_hitl_decision,
    summarize_node,
)
from src.agents.nodes.qa_nodes import (
    clarify_node,
    classify_question_type,
    qa_guardrail_node,
    qa_router_node,
    qa_structured_node,
    qa_vector_node,
)
from src.agents.state import ProfilingState
from src.config import get_settings

logger = logging.getLogger(__name__)

# Trần cứng chống loop vô hạn (L3). Node nào cũng tăng tool_calls.
MAX_TOOL_CALLS = 10
MAX_DEEP_ANALYSIS = 5


# --------------------------------------------------------------------------- #
# Checkpointer
# --------------------------------------------------------------------------- #
def build_checkpointer() -> Any:
    """Tạo PostgreSQL checkpointer theo `settings.checkpointer_url` (ADR-009)."""
    settings = get_settings()
    url = settings.checkpointer_url
    if not url.startswith(("postgresql://", "postgres://")):
        raise RuntimeError("DATABASE_CHECKPOINTER_URL phải là PostgreSQL cho LangGraph.")

    try:
        if url.startswith(("postgresql://", "postgres://")):
            from langgraph.checkpoint.postgres import PostgresSaver
            from psycopg import Connection
            from psycopg.rows import dict_row

            # `from_conn_string` is a context manager.  Calling `__enter__`
            # manually and then returning the saver lets the context close the
            # connection before `setup()`/the first graph request.  Keep the
            # connection owned by the long-lived checkpointer instead.
            conn = Connection.connect(
                url,
                autocommit=True,
                prepare_threshold=0,
                row_factory=dict_row,
            )
            try:
                saver = PostgresSaver(conn)
                saver.setup()
            except Exception:
                conn.close()
                raise
            return saver

    except ImportError as exc:
        raise RuntimeError(
            "Cần langgraph-checkpoint-postgres và psycopg để lưu state trên PostgreSQL."
        ) from exc
    except Exception as exc:
        raise RuntimeError("Không khởi tạo được PostgreSQL checkpointer.") from exc


# --------------------------------------------------------------------------- #
# Routers
# --------------------------------------------------------------------------- #
def route_after_summarize(state: ProfilingState) -> str:
    """Chỉ vào nhánh QA khi request thực sự mang câu hỏi."""
    return "qa_router" if (state.get("question") or "").strip() else END


def _guard(state: ProfilingState) -> str | None:
    """Trần tool_calls dùng chung cho các conditional edge."""
    if state.get("tool_calls", 0) >= MAX_TOOL_CALLS:
        return END
    return None


def route_hitl(state: ProfilingState) -> str:
    if _guard(state) == END:
        return "summarize"
    return route_hitl_decision(state)


# --------------------------------------------------------------------------- #
# Graph
# --------------------------------------------------------------------------- #
def _add_qa_nodes(graph: StateGraph, terminal: str = END) -> None:
    graph.add_node("qa_router", qa_router_node)
    graph.add_node("qa_structured", qa_structured_node)
    graph.add_node("qa_vector", qa_vector_node)
    graph.add_node("clarify", clarify_node)
    graph.add_node("qa_guardrail", qa_guardrail_node)

    graph.add_conditional_edges(
        "qa_router",
        classify_question_type,
        {
            "quantitative": "qa_structured",
            "qualitative": "qa_vector",
            "clarify": "clarify",
            "guardrail": "qa_guardrail",
        },
    )
    graph.add_edge("qa_structured", terminal)
    graph.add_edge("qa_vector", terminal)
    graph.add_edge("clarify", terminal)
    graph.add_edge("qa_guardrail", terminal)


def build_profiling_graph(checkpointer: Any = None) -> Any:
    """Graph đầy đủ: ingest → … → summarize → (QA nếu có câu hỏi)."""
    graph = StateGraph(ProfilingState)

    graph.add_node("ingest", ingest_node)
    graph.add_node("compute_stats", compute_stats_node)
    graph.add_node("propose_metadata", propose_metadata_node)
    graph.add_node("hitl_review", hitl_review_node)
    graph.add_node("deep_analysis", deep_analysis_node)
    graph.add_node("summarize", summarize_node)
    graph.add_node("finalize", finalize_profile_node)
    _add_qa_nodes(graph, terminal="finalize")

    graph.set_entry_point("ingest")
    graph.add_edge("ingest", "compute_stats")
    graph.add_edge("compute_stats", "propose_metadata")
    graph.add_edge("propose_metadata", "hitl_review")
    graph.add_conditional_edges(
        "hitl_review",
        route_hitl,
        # Khoá của path_map phải là ĐÚNG giá trị router trả về. `route_hitl` trả
        # tên node đích ("summarize" / "propose_metadata" / "deep_analysis"), nên
        # map ở đây là identity. Trước đây map dùng tên quyết định ("confirm",
        # "reject", "request_test") — không khớp giá trị trả về, và LangGraph
        # raise KeyError khi router trả giá trị ngoài path_map, làm nhánh reject
        # vỡ ngay lúc chạy.
        {
            "summarize": "summarize",
            "propose_metadata": "propose_metadata",
            "deep_analysis": "deep_analysis",
        },
    )
    graph.add_edge("deep_analysis", "hitl_review")
    graph.add_conditional_edges(
        "summarize",
        route_after_summarize,
        {"qa_router": "qa_router", END: "finalize"},
    )

    return graph.compile(
        checkpointer=checkpointer if checkpointer is not None else build_checkpointer(),
    )


def build_qa_graph() -> Any:
    """Graph chỉ có nhánh QA, dùng cho `POST /qa/stream`.

    Không cần checkpointer: mỗi câu hỏi là một lượt độc lập, lịch sử profiling
    đã nằm trong DB và vector index.
    """
    graph = StateGraph(ProfilingState)
    _add_qa_nodes(graph)
    graph.set_entry_point("qa_router")
    return graph.compile()


# --------------------------------------------------------------------------- #
# Singleton (lazy — tránh mở kết nối DB lúc import)
# --------------------------------------------------------------------------- #
_profiling_graph: Any = None
_qa_graph: Any = None


def get_profiling_graph() -> Any:
    global _profiling_graph
    if _profiling_graph is None:
        _profiling_graph = build_profiling_graph()
    return _profiling_graph


def get_qa_graph() -> Any:
    global _qa_graph
    if _qa_graph is None:
        _qa_graph = build_qa_graph()
    return _qa_graph


def reset_graphs() -> None:
    """Xoá cache graph — dùng trong test khi đổi settings."""
    global _profiling_graph, _qa_graph
    _profiling_graph = None
    _qa_graph = None


__all__ = [
    "MAX_DEEP_ANALYSIS",
    "MAX_TOOL_CALLS",
    "build_checkpointer",
    "build_profiling_graph",
    "build_qa_graph",
    "get_profiling_graph",
    "get_qa_graph",
    "reset_graphs",
    "route_after_summarize",
    "route_hitl",
]
