"""Context limits during a step (doc 03 "Context limits during a step", doc 06)."""

from __future__ import annotations

from backend.harness.limits import LimitAction, check_limits, estimate_tokens
from backend.harness.render import Event


def ev(seq, kind, **payload):
    return Event(seq=seq, kind=kind, payload=payload)


def test_estimate_is_last_prompt_tokens_plus_chars_since_over_3_5():
    events = [
        ev(1, "input", text="a" * 100, items=[]),
        ev(2, "assistant", text="x", tool_calls=[], usage={"prompt_tokens": 1000}),
        ev(3, "tool_result", text="b" * 350),
        ev(4, "input", text="c" * 350, items=[]),
    ]
    # 1000 + (350 + 350) / 3.5 (the assistant reply itself counts too: 1 char)
    assert estimate_tokens("SYS", "", events) == 1000 + round((1 + 350 + 350) / 3.5)


def test_estimate_without_usage_counts_everything():
    events = [ev(1, "input", text="a" * 700, items=[])]
    assert estimate_tokens("s" * 350, "u" * 350, events) == round((350 + 350 + 700) / 3.5)


def test_thresholds():
    assert check_limits(5000, 10000, soft=0.6, hard=0.9) is LimitAction.OK
    assert check_limits(6001, 10000, soft=0.6, hard=0.9) is LimitAction.SOFT
    assert check_limits(9001, 10000, soft=0.6, hard=0.9) is LimitAction.HARD
    assert check_limits(6000, 10000, soft=0.6, hard=0.9) is LimitAction.OK
