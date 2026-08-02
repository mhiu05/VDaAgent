"""Test cấu trúc graph và các hàm routing.

Không invoke cả graph ở đây (phần đó đã được test qua API) — chỉ kiểm tra
topology compile được và mỗi router trả đúng nhánh, vì đó là nơi lỗi im lặng
dễ lọt nhất.
"""

from __future__ import annotations

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END

from src.agents.graph import (
    MAX_TOOL_CALLS,
    build_profiling_graph,
    build_qa_graph,
    route_after_summarize,
    route_hitl,
)
from src.agents.nodes.qa_nodes import classify_question_type
from src.agents.state import initial_profiling_state, initial_qa_state


def test_profiling_graph_compiles_with_hitl_interrupt() -> None:
    """Graph phải compile được và có đủ node theo sơ đồ kiến trúc."""
    graph = build_profiling_graph(checkpointer=MemorySaver())
    nodes = set(graph.get_graph().nodes)

    assert {
        "ingest",
        "compute_stats",
        "propose_metadata",
        "hitl_review",
        "deep_analysis",
        "summarize",
        "qa_router",
        "qa_structured",
        "qa_vector",
        "clarify",
    } <= nodes


def test_qa_graph_compiles() -> None:
    nodes = set(build_qa_graph().get_graph().nodes)
    assert {"qa_router", "qa_structured", "qa_vector", "clarify"} <= nodes


# --------------------------------------------------------------------------- #
# route_after_summarize
# --------------------------------------------------------------------------- #
def test_summarize_ends_when_no_question() -> None:
    """Không có câu hỏi thì kết ở summarize, không chạy QA cho có."""
    assert route_after_summarize({"question": None}) == END
    assert route_after_summarize({"question": "   "}) == END


def test_summarize_routes_to_qa_when_question_present() -> None:
    assert route_after_summarize({"question": "Có bao nhiêu dòng?"}) == "qa_router"


# --------------------------------------------------------------------------- #
# route_hitl
# --------------------------------------------------------------------------- #
def test_route_hitl_follows_analyst_decision() -> None:
    """Router trả về tên NHÁNH trong conditional edge, không phải tên decision.

    `confirm`/`edit`/chưa quyết định đều đi tiếp tới summarize; chỉ `reject` quay
    lại đề xuất và `request_test` mới rẽ sang deep_analysis.
    """
    assert route_hitl({"hitl_decision": "confirm", "tool_calls": 0}) == "summarize"
    assert route_hitl({"hitl_decision": "reject", "tool_calls": 0}) == "propose_metadata"
    assert route_hitl({"hitl_decision": "request_test", "tool_calls": 0}) == "deep_analysis"


def test_route_hitl_sends_errors_straight_to_summarize() -> None:
    """Có lỗi thì không loop lại đề xuất, đi thẳng tới báo cáo."""
    assert route_hitl({"error": "ingest failed", "hitl_decision": "reject"}) == "summarize"


def test_route_hitl_caps_deep_analysis_loop() -> None:
    """`request_test` lặp quá `hitl_max_deep_analysis` thì phải dừng (L3)."""
    from src.config import get_settings

    state = {
        "hitl_decision": "request_test",
        "tool_calls": 0,
        "deep_analysis_count": get_settings().hitl_max_deep_analysis,
    }
    assert route_hitl(state) == "summarize"


def test_route_hitl_stops_at_tool_call_ceiling() -> None:
    """Chạm trần `MAX_TOOL_CALLS` thì đi thẳng summarize, không loop tiếp (L3)."""
    state = {"hitl_decision": "request_test", "tool_calls": MAX_TOOL_CALLS}
    assert route_hitl(state) == "summarize"


# --------------------------------------------------------------------------- #
# classify_question_type
# --------------------------------------------------------------------------- #
def test_classify_question_type_maps_state_to_branch() -> None:
    assert classify_question_type({"question_type": "quantitative"}) == "quantitative"
    assert classify_question_type({"question_type": "clarify"}) == "clarify"
    assert classify_question_type({"question_type": "qualitative"}) == "qualitative"
    # Không rõ loại thì rơi về nhánh định tính (có trích nguồn) chứ không đoán số.
    assert classify_question_type({}) == "qualitative"


# --------------------------------------------------------------------------- #
# State khởi tạo
# --------------------------------------------------------------------------- #
def test_initial_profiling_state_has_zero_tool_calls() -> None:
    state = initial_profiling_state(
        dataset_ref="a.csv",
        dataset_name="a",
        scan_mode="full",
        sampling_config=None,
        requested_by="tester",
        question=None,
    )
    assert state["dataset_ref"] == "a.csv"
    assert state["scan_mode"] == "full"
    assert state.get("tool_calls", 0) == 0


def test_initial_qa_state_carries_columns() -> None:
    state = initial_qa_state(
        question="Cột nào nhiều null nhất?",
        profile_run_id="run-1",
        column_names=["a", "b"],
        requested_by="tester",
    )
    assert state["question"] == "Cột nào nhiều null nhất?"
    assert state["profile_run_id"] == "run-1"
