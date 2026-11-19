"""Live OpenRouter contract tests (doc 17 "Live contract tests").

Opt-in and deselected by default: `make test-live` (or `pytest -m live`) with a real
`OPENROUTER_API_KEY`. They pin the message shape our runner produces and the usage fields
our tracing reads, against the real provider.
"""

import contextlib
import json
import os
from pathlib import Path

import pytest
import yaml

from backend.harness.model import ModelClient
from backend.settings import Settings

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(
        not os.environ.get("OPENROUTER_API_KEY"),
        reason="needs a real OPENROUTER_API_KEY",
    ),
]

MODELS = ("openai/gpt-4o-mini", "anthropic/claude-haiku-4.5")


@contextlib.asynccontextmanager
async def client():
    settings = Settings()
    c = ModelClient(
        base_url=settings.OPENROUTER_BASE_URL,
        api_key=settings.OPENROUTER_API_KEY.get_secret_value(),
        app_url=settings.APP_URL,
        timeout_s=120.0,
    )
    try:
        yield c
    finally:
        await c.aclose()


def activation_messages(prefix: str = "") -> list[dict]:
    """The tail of one activation's context (docs 03, 06): the system layer, the input, the
    assistant's `python` call with its `final` tool result, then a new user message."""
    return [
        {
            "role": "system",
            "content": prefix + "You are a test agent. Answer in at most five words.",
        },
        {"role": "user", "content": "Name one city in Vietnam."},
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "x_live_1",
                    "type": "function",
                    "function": {
                        "name": "python",
                        "arguments": json.dumps({"code": "print('Hà Nội')"}),
                    },
                }
            ],
        },
        {"role": "tool", "tool_call_id": "x_live_1", "content": "exit_code: 0 · 12 ms\nHà Nội"},
        {"role": "user", "content": "Now write the word ok."},
    ]


@pytest.mark.parametrize("model", MODELS)
async def test_activation_shape_is_accepted(model):
    async with client() as c:
        resp = await c.complete(model, activation_messages(), agent="live", purpose="agent")
    assert (resp.text or "").strip() or resp.tool_calls


@pytest.mark.parametrize("model", MODELS)
async def test_usage_reports_cost_and_cached_tokens(model):
    # a shared prefix over the provider's caching minimum, asked twice, so the second call
    # is served from the prompt cache and `prompt_tokens_details.cached_tokens` appears
    prefix = "Cache filler. " * 900
    async with client() as c:
        await c.complete(model, activation_messages(prefix), agent="live", purpose="agent")
        resp = await c.complete(model, activation_messages(prefix), agent="live", purpose="agent")
    usage = resp.raw.get("usage") or {}
    assert isinstance(usage.get("cost"), (int, float))
    details = usage.get("prompt_tokens_details") or {}
    assert isinstance(details.get("cached_tokens"), (int, float))
    assert resp.usage["cost"] == usage.get("cost")
    assert resp.usage["cached_tokens"] == details.get("cached_tokens")


async def test_jev_model_returns_schema_valid_json():
    settings = Settings()
    criteria = yaml.safe_load(
        (Path(settings.PLATFORM_DIR) / "jev_criteria.yaml").read_text(encoding="utf-8")
    )
    questions = {
        "route": {
            "type": "choice",
            "instructions": (
                "Is this new, independent work for the lead's queue, or something else?"
            ),
            "criteria": criteria,
        }
    }
    state = (
        "<current_state>No running task. Queue: 0.</current_state>\n\n"
        '<message from="user · Nhóm báo cáo Q3" id="m_1" thread="Nhóm báo cáo Q3" '
        'at="2026-10-18T08:00:00+07:00">\n'
        "Vì sao căn MAS-U03832 bán chậm? So sánh với các căn tương đồng, "
        "vẽ biểu đồ và xuất báo cáo.\n</message>"
    )
    async with client() as c:
        resp = await c.decide(settings.JEV_MODEL, state, questions, agent="lead", purpose="jev")
    route = resp.answers["route"]
    assert route["choice"] in ("task", "side_question")
    assert 0 <= route["confidence"] <= 1
