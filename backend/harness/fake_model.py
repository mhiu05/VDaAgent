"""FakeModel (doc 17): an `httpx.MockTransport` answering chat completions and Decisions API
calls from a scenario.

```yaml
agents:
  <slug>:
    - match: {input_contains: "<begin_task"}   # optional
      reply: {tool: "<python code>"}            # or {text: "..."}
jev:
  - match: {message_contains: "Vì sao"}         # optional; matched against Decisions API `state`
    label: task
    confidence: 0.9                             # optional, default 1.0
usage: {prompt_tokens: 1000, completion_tokens: 50, cached_tokens: 900, cost: 0.0001}
```

- Each agent's replies are consumed in order. A reply with a `match` waits until the last user
  or tool message contains the text; until then the agent gets an empty turn with no tool call,
  which ends its activation. An exhausted script answers the same way.
- jev calls hit a separate Decisions-API-shaped route (`/api/alpha/decisions`); replies are
  picked by `match`, the first that fits, and synthesized as `{answers: {route: {...}}}`.
- Every request is recorded (agent, purpose, body) so tests can check rendered messages.
"""

from __future__ import annotations

import itertools
import json
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
import yaml

FAKE_WINDOW = 200_000


@dataclass
class Scenario:
    agents: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    jev: list[dict[str, Any]] = field(default_factory=list)
    usage: dict[str, Any] = field(default_factory=dict)


def load_scenario(path: str | Path) -> Scenario:
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    return Scenario(
        agents={str(k): list(v or []) for k, v in (data.get("agents") or {}).items()},
        jev=list(data.get("jev") or []),
        usage=dict(data.get("usage") or {}),
    )


def _content_text(content: Any) -> str:
    if isinstance(content, list):
        return "".join(p.get("text", "") for p in content if isinstance(p, dict))
    return content or ""


def last_input(messages: list[dict[str, Any]]) -> str:
    for m in reversed(messages):
        if m.get("role") in ("user", "tool"):
            return _content_text(m.get("content"))
    return ""


class FakeModelTransport(httpx.MockTransport):
    def __init__(self, scenario: Scenario) -> None:
        self.scenario = scenario
        self.positions: dict[str, int] = {}
        self.requests: list[dict[str, Any]] = []
        self._ids = itertools.count(1)
        self._lock = threading.Lock()
        super().__init__(self._handle)

    def _usage(self) -> dict[str, Any]:
        u = self.scenario.usage
        return {
            "prompt_tokens": u.get("prompt_tokens", 0),
            "completion_tokens": u.get("completion_tokens", 0),
            "prompt_tokens_details": {"cached_tokens": u.get("cached_tokens", 0)},
            "cost": u.get("cost", 0),
        }

    def _decisions_usage(self) -> dict[str, Any]:
        u = self.scenario.usage
        return {
            "input_tokens": u.get("prompt_tokens", 0),
            "output_tokens": u.get("completion_tokens", 0),
            "cost": u.get("cost", 0),
        }

    def _handle(self, request: httpx.Request) -> httpx.Response:
        if request.method == "GET" and request.url.path.endswith("/models"):
            return httpx.Response(
                200,
                json={
                    "data": [
                        {"id": m, "context_length": FAKE_WINDOW}
                        for m in ("anthropic/claude-haiku-4.5", "openai/gpt-4o-mini")
                    ]
                },
            )
        body = json.loads(request.content)
        agent = request.headers.get("X-Contoso-Agent", "")
        purpose = request.headers.get("X-Contoso-Purpose", "agent")
        with self._lock:
            self.requests.append({"agent": agent, "purpose": purpose, "body": body})
            if request.url.path.endswith("/decisions"):
                return httpx.Response(
                    200,
                    json={
                        "model": body.get("model", "fake"),
                        "answers": {"route": self._decide(body.get("state", ""))},
                        "usage": self._decisions_usage(),
                    },
                )
            message = self._agent_reply(agent, body["messages"])
        return httpx.Response(
            200,
            json={
                "id": f"gen-fake-{next(self._ids)}",
                "model": body.get("model", "fake"),
                "choices": [{"message": message, "finish_reason": "stop"}],
                "usage": self._usage(),
            },
        )

    def _agent_reply(self, agent: str, messages: list[dict[str, Any]]) -> dict[str, Any]:
        script = self.scenario.agents.get(agent, [])
        pos = self.positions.get(agent, 0)
        if pos >= len(script):
            return {"role": "assistant", "content": ""}
        step = script[pos]
        needle = (step.get("match") or {}).get("input_contains")
        if needle is not None and needle not in last_input(messages):
            return {"role": "assistant", "content": ""}
        self.positions[agent] = pos + 1
        reply = step.get("reply") or {}
        if "tool" in reply:
            return {
                "role": "assistant",
                "content": reply.get("text"),
                "tool_calls": [
                    {
                        "id": f"call_{next(self._ids)}",
                        "type": "function",
                        "function": {
                            "name": "python",
                            "arguments": json.dumps({"code": reply["tool"]}),
                        },
                    }
                ],
            }
        return {"role": "assistant", "content": reply.get("text", "")}

    def _decide(self, state: str) -> dict[str, Any]:
        text = state
        if "<message " in text:  # match the new message only, not the context before it
            text = text[text.rindex("<message ") :]
        for entry in self.scenario.jev:
            needle = (entry.get("match") or {}).get("message_contains")
            if needle is None or needle in text:
                return {
                    "type": "choice",
                    "choice": entry.get("label", "side_question"),
                    "confidence": entry.get("confidence", 1.0),
                }
        return {"type": "choice", "choice": "side_question", "confidence": 1.0}
