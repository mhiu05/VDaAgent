"""Events → OpenAI messages (doc 06 "Rendering")."""

from __future__ import annotations

import json

from backend.harness.render import Event, render_messages


def ev(seq, kind, **payload):
    return Event(seq=seq, kind=kind, payload=payload)


EVENTS = [
    ev(
        1,
        "input",
        text='<current_state>…</current_state>\n<begin_task id="T1">x</begin_task>',
        items=[],
    ),
    ev(2, "assistant", text=None, tool_calls=[{"id": "call_1", "code": "print(1)"}]),
    ev(3, "tool_result", tool_call_id="call_1", text="exit_code: 0 · 0.1 s\n--- stdout ---\n1"),
    ev(4, "assistant", text="Xong.", tool_calls=[]),
    ev(5, "error", code="step_limit", text="step limit reached"),
]


def test_each_event_kind_maps_to_its_message():
    msgs = render_messages("SYS", "", EVENTS, model="openai/gpt-4o-mini")
    assert msgs[0] == {"role": "system", "content": "SYS"}
    assert msgs[1] == {"role": "user", "content": EVENTS[0].payload["text"]}
    assert msgs[2] == {
        "role": "assistant",
        "content": None,
        "tool_calls": [
            {
                "id": "call_1",
                "type": "function",
                "function": {"name": "python", "arguments": json.dumps({"code": "print(1)"})},
            }
        ],
    }
    assert msgs[3] == {
        "role": "tool",
        "tool_call_id": "call_1",
        "content": "exit_code: 0 · 0.1 s\n--- stdout ---\n1",
    }
    assert msgs[4] == {"role": "assistant", "content": "Xong."}
    error = '<error code="step_limit">step limit reached</error>'
    assert msgs[5] == {"role": "user", "content": error}


def test_summary_follows_the_system_prompt():
    msgs = render_messages("SYS", "Đã làm A, B.", [], model="openai/gpt-4o-mini")
    assert msgs[1] == {"role": "user", "content": "<summary>\nĐã làm A, B.\n</summary>"}


def test_prefix_is_byte_stable_as_events_append():
    model = "openai/gpt-4o-mini"
    for n in range(1, len(EVENTS)):
        before = json.dumps(render_messages("SYS", "s", EVENTS[:n], model=model))
        after = json.dumps(render_messages("SYS", "s", EVENTS[: n + 1], model=model))
        assert after.startswith(before[:-1])  # same array, more elements


def test_a_tool_message_may_be_followed_by_a_user_message():
    events = [
        EVENTS[0],
        EVENTS[1],
        EVENTS[2],
        ev(4, "input", text="<notification>…</notification>", items=[]),
    ]
    roles = [m["role"] for m in render_messages("S", "", events, model="openai/gpt-4o-mini")]
    assert roles == ["system", "user", "assistant", "tool", "user"]


def test_rendering_is_model_agnostic():
    first = render_messages("SYS", "", EVENTS, model="provider-a/model")
    second = render_messages("SYS", "", EVENTS, model="provider-b/model")
    assert first == second
    assert "cache_control" not in json.dumps(first)
