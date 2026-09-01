import pytest

from src.agents.nodes import qa_nodes
from src.agents.nodes.qa_nodes import (
    _remembered_name,
    _resolve_column_from_history,
    qa_router_node,
)
from src.agents.state import initial_qa_state
from src.agents.tools.common import get_column_suggestions


def test_qa_remembers_name_from_recent_conversation() -> None:
    history = [
        {"role": "user", "text": "tôi tên là Hiếu"},
        {"role": "agent", "text": "Rất vui được làm quen với Hiếu!"},
    ]
    state = initial_qa_state("bạn biết mình tên gì không", history=history)

    assert _remembered_name(state) == "Hiếu"
    routed = qa_router_node(state)
    assert routed["question_type"] == "qualitative"
    assert "Hiếu" in routed["answer"]


def test_qa_remembers_name_from_plain_self_introduction() -> None:
    history = [
        {'role': 'user', 'text': 'tôi là Hiếu'},
        {'role': 'agent', 'text': 'Rất vui được làm quen!'},
    ]
    state = initial_qa_state('bạn biết mình tên gì không', history=history)

    assert _remembered_name(state) == 'Hiếu'
    routed = qa_router_node(state)
    assert 'Hiếu' in routed['answer']


def test_qa_remembers_name_from_unaccented_recall_question() -> None:
    history = [{'role': 'user', 'text': 'tôi là Hiếu'}]
    state = initial_qa_state('ban biet minh ten gi khong', history=history)

    routed = qa_router_node(state)

    assert 'Hiếu' in routed['answer']


def test_qa_resolves_vague_reference_from_history() -> None:
    history = [
        {"role": "user", "text": "cột revenue có bao nhiêu dòng null?"},
        {"role": "agent", "text": "Cột revenue có 0% null."},
    ]
    state = initial_qa_state("cột đó có outlier không?", history=history)
    state["column_names"] = ["customer_id", "revenue", "created_at"]
    state["profile_run_id"] = "run-123"

    resolved = _resolve_column_from_history(state, ["customer_id", "revenue", "created_at"])
    assert resolved == ["revenue"]

    routed = qa_router_node(state)
    assert routed["question_type"] == "quantitative"
    assert routed["qa_context"]["mentioned_columns"] == ["revenue"]


def test_qa_routes_an_english_distribution_suggestion_to_the_bounded_tool_path() -> None:
    state = initial_qa_state("Show the distribution of Quantity.")
    state["profile_run_id"] = "run-123"
    state["column_names"] = ["Quantity"]

    routed = qa_router_node(state)

    assert routed["question_type"] == "quantitative"
    assert routed["qa_context"]["mentioned_columns"] == ["Quantity"]
    assert routed["qa_budget_category"] == "deterministic"


def test_direct_fast_path_budget_starts_after_routing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(qa_nodes.time, "perf_counter", lambda: 100.0)
    state = initial_qa_state("Show the distribution of Quantity.")
    state["profile_run_id"] = "run-123"
    state["column_names"] = ["Quantity"]
    state["qa_started_monotonic"] = 1.0

    routed = qa_router_node(state)

    assert routed["qa_budget_category"] == "deterministic"
    assert routed["qa_deadline_monotonic"] == 105.0


def test_fuzzy_column_suggestions_for_self_correction() -> None:
    stats = {
        "customer_id": {"dtype": "int64"},
        "transaction_amount": {"dtype": "float64"},
        "email_address": {"dtype": "string"},
    }
    suggestions = get_column_suggestions(stats, "trans_amount")
    assert "transaction_amount" in suggestions

    email_sugg = get_column_suggestions(stats, "EMAIL")
    assert "email_address" in email_sugg or "email" in [s.lower() for s in email_sugg]

