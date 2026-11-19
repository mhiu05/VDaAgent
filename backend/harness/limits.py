"""Context limits during a step (doc 03 "Context limits during a step").

The estimate is the last `usage.prompt_tokens` plus the characters appended since that
response (the reply itself included) divided by 3.5. Without any usage yet, every character
of the context counts.
"""

from __future__ import annotations

import enum

from backend.harness.render import Event

CHARS_PER_TOKEN = 3.5


class LimitAction(enum.Enum):
    OK = "ok"
    SOFT = "soft"  # compaction becomes pending
    HARD = "hard"  # batch offload, then overflow if still over


def _chars(event: Event) -> int:
    p = event.payload
    n = len(p.get("text") or "")
    for call in p.get("tool_calls") or []:
        n += len(call.get("code") or "")
    return n


def estimate_tokens(system_prompt: str, summary: str, events: list[Event]) -> int:
    last = None
    for i in range(len(events) - 1, -1, -1):
        e = events[i]
        if e.kind == "assistant" and (e.payload.get("usage") or {}).get("prompt_tokens"):
            last = i
            break
    if last is None:
        chars = len(system_prompt) + len(summary) + sum(_chars(e) for e in events)
        return round(chars / CHARS_PER_TOKEN)
    base = int(events[last].payload["usage"]["prompt_tokens"])
    return base + round(sum(_chars(e) for e in events[last:]) / CHARS_PER_TOKEN)


def check_limits(estimate: int, window: int, *, soft: float, hard: float) -> LimitAction:
    if estimate > hard * window:
        return LimitAction.HARD
    if estimate > soft * window:
        return LimitAction.SOFT
    return LimitAction.OK
