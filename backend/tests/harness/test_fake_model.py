"""FakeModel (`MODEL_BACKEND=fake`): replies from a scenario file (doc 17 "FakeModel")."""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.harness.fake_model import FakeModelTransport, load_scenario
from backend.harness.model import ModelClient

SCENARIO = """
agents:
  lead:
    - match: {input_contains: "<begin_task"}
      reply: {tool: "from contoso import send_to_agent\\nsend_to_agent(['data'], 'Lấy số liệu')"}
    - reply: {text: "Đã giao việc."}
    - match: {input_contains: 'from="agent:data"'}
      reply: {tool: "print('done')"}
  data:
    - reply: {tool: "print('ok')"}
jev:
  - match: {message_contains: "Vì sao"}
    label: task
  - label: side_question
usage: {prompt_tokens: 1000, completion_tokens: 50, cached_tokens: 900, cost: 0.0001}
"""

GOLDEN = Path(__file__).resolve().parents[1] / "scenarios" / "golden.yaml"


@pytest.fixture
def fake(tmp_path):
    path = tmp_path / "s.yaml"
    path.write_text(SCENARIO)
    transport = FakeModelTransport(load_scenario(path))
    c = ModelClient(
        base_url="http://fake/api/v1",
        api_key="",
        app_url="http://x",
        timeout_s=5,
        transport=transport,
    )
    return transport, c


def user(text):
    return {"role": "user", "content": text}


async def test_replies_are_consumed_in_order_with_matches(fake):
    _transport, c = fake
    r1 = await c.complete(
        "m", [user('<current_state>…</current_state>\n<begin_task id="T1">')], agent="lead"
    )
    assert r1.tool_calls and "send_to_agent" in r1.tool_calls[0]["code"]
    r2 = await c.complete(
        "m", [user("x"), {"role": "tool", "tool_call_id": "c", "content": "ok"}], agent="lead"
    )
    assert r2.text == "Đã giao việc." and r2.tool_calls == []
    # the next reply waits for its match: an unrelated input gets an empty, tool-less turn
    r3 = await c.complete(
        "m", [user('<notification from="user:alice">hi</notification>')], agent="lead"
    )
    assert r3.text == "" and r3.tool_calls == []
    r4 = await c.complete(
        "m", [user('<notification from="agent:data">xong</notification>')], agent="lead"
    )
    assert r4.tool_calls[0]["code"] == "print('done')"
    # exhausted: empty turns from now on
    assert (await c.complete("m", [user("more")], agent="lead")).tool_calls == []


async def test_match_uses_the_last_user_or_tool_message(fake):
    _transport, c = fake
    msgs = [user("<begin_task"), {"role": "assistant", "content": "x"}]
    assert (await c.complete("m", msgs, agent="lead")).tool_calls  # last user msg matches
    msgs = [user("<begin_task"), {"role": "tool", "tool_call_id": "a", "content": "nothing"}]
    # second reply has no match, so it's next either way
    assert (await c.complete("m", msgs, agent="lead")).text == "Đã giao việc."


async def test_agents_have_their_own_queues(fake):
    _transport, c = fake
    assert (await c.complete("m", [user("x")], agent="data")).tool_calls[0]["code"] == "print('ok')"
    assert (await c.complete("m", [user("<begin_task")], agent="lead")).tool_calls


async def test_decide_labels_by_match(fake):
    _transport, c = fake
    state = (
        '<current_state>...</current_state>\n\n<message id="m_1">Vì sao căn này bán chậm?</message>'
    )
    r = await c.decide("m", state, {"route": {}}, purpose="jev")
    assert r.answers["route"] == {"type": "choice", "choice": "task", "confidence": 1.0}
    r2 = await c.decide("m", '<message id="m_2">cảm ơn</message>', {"route": {}}, purpose="jev")
    assert r2.answers["route"]["choice"] == "side_question"


async def test_decide_confidence_defaults_to_one_but_is_overridable(tmp_path):
    path = tmp_path / "s.yaml"
    path.write_text(
        "jev:\n  - match: {message_contains: 'Vì sao'}\n    label: task\n    confidence: 0.3\n"
    )
    transport = FakeModelTransport(load_scenario(path))
    c = ModelClient(
        base_url="http://fake/api/v1",
        api_key="",
        app_url="http://x",
        timeout_s=5,
        transport=transport,
    )
    r = await c.decide("m", '<message id="m_1">Vì sao?</message>', {"route": {}}, purpose="jev")
    assert r.answers["route"] == {"type": "choice", "choice": "task", "confidence": 0.3}


async def test_decide_requests_are_recorded_on_the_decisions_path(fake):
    transport, c = fake
    await c.decide("m", "state text", {"route": {}}, agent="lead", purpose="jev")
    rec = transport.requests[-1]
    assert rec["agent"] == "lead" and rec["purpose"] == "jev"
    assert rec["body"] == {"model": "m", "state": "state text", "questions": {"route": {}}}


async def test_every_response_carries_the_usage(fake):
    _transport, c = fake
    r = await c.complete("m", [user("x")], agent="data")
    assert r.usage == {
        "prompt_tokens": 1000,
        "completion_tokens": 50,
        "cached_tokens": 900,
        "cost": 0.0001,
    }


async def test_requests_are_recorded(fake):
    transport, c = fake
    msgs = [{"role": "system", "content": "S"}, user("<begin_task")]
    await c.complete("anthropic/claude-haiku-4.5", msgs, agent="lead")
    rec = transport.requests[-1]
    assert rec["agent"] == "lead" and rec["purpose"] == "agent"
    assert rec["body"]["messages"] == msgs
    assert rec["body"]["model"] == "anthropic/claude-haiku-4.5"


async def test_models_endpoint(fake):
    _transport, c = fake
    await c.load_windows()
    assert c.window("anthropic/claude-haiku-4.5") == 200000


def test_the_golden_scenario_loads():
    s = load_scenario(GOLDEN)
    assert {"lead", "data"} <= set(s.agents)
    assert s.jev and s.usage["prompt_tokens"] > 0


async def test_fake_backend_setting_builds_a_fake_client(platform_env):
    from backend.harness.model import build_model_client
    from backend.settings import Settings

    c = build_model_client(Settings(MODEL_BACKEND="fake", MODEL_SCENARIO=str(GOLDEN)))
    r = await c.complete("m", [user('<begin_task id="T1">')], agent="lead")
    assert "send_to_agent" in r.tool_calls[0]["code"]
    await c.aclose()
