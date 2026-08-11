from src.agents.nodes.qa_nodes import _remembered_name, qa_router_node
from src.agents.state import initial_qa_state


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
