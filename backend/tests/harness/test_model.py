"""`harness/model.py`: OpenRouter chat completions with retries (doc 03 "Model calls")."""

from __future__ import annotations

import json

import httpx
import pytest

from backend.harness.model import (
    PYTHON_TOOL,
    ModelCapabilities,
    ModelClient,
    ModelError,
    ModelUnavailable,
    backoff_delays,
)

OK_BODY = {
    "id": "gen-1",
    "model": "anthropic/claude-haiku-4.5",
    "choices": [
        {
            "message": {
                "role": "assistant",
                "content": "Xin chào",
                "tool_calls": [
                    {
                        "id": "call_1",
                        "type": "function",
                        "function": {
                            "name": "python",
                            "arguments": json.dumps({"code": "print(1)"}),
                        },
                    }
                ],
            },
            "finish_reason": "tool_calls",
        }
    ],
    "usage": {
        "prompt_tokens": 1000,
        "completion_tokens": 50,
        "cost": 0.0001,
        "prompt_tokens_details": {"cached_tokens": 900},
    },
}


class Recorder:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        r = self.responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


def client(handler, sleeps=None, **kw) -> ModelClient:
    async def sleep(s):
        if sleeps is not None:
            sleeps.append(s)

    return ModelClient(
        base_url="https://openrouter.ai/api/v1",
        api_key="sk-or-x",
        app_url="http://localhost:8010",
        timeout_s=120,
        transport=httpx.MockTransport(handler),
        sleep=sleep,
        **kw,
    )


async def test_request_shape_and_parsed_response():
    rec = Recorder([httpx.Response(200, json=OK_BODY)])
    c = client(rec)
    res = await c.complete(
        "anthropic/claude-haiku-4.5",
        [{"role": "user", "content": "hi"}],
        tools=[PYTHON_TOOL],
        agent="data",
        purpose="agent",
    )
    req = rec.requests[0]
    assert str(req.url) == "https://openrouter.ai/api/v1/chat/completions"
    assert req.headers["Authorization"] == "Bearer sk-or-x"
    assert req.headers["HTTP-Referer"] == "http://localhost:8010"
    assert req.headers["X-Title"] == "VDaAgent"
    assert req.headers["X-Contoso-Agent"] == "data" and req.headers["X-Contoso-Purpose"] == "agent"
    body = json.loads(req.content)
    assert body["model"] == "anthropic/claude-haiku-4.5"
    assert body["tools"] == [PYTHON_TOOL]
    assert "parallel_tool_calls" not in body  # unknown capability: omit optional protocol fields
    assert body["usage"] == {"include": True}
    assert res.text == "Xin chào"
    assert res.tool_calls == [
        {
            "id": "call_1",
            "name": "python",
            "arguments": json.dumps({"code": "print(1)"}),
            "code": "print(1)",
        }
    ]
    assert res.finish_reason == "tool_calls" and res.error is None
    assert res.usage == {
        "prompt_tokens": 1000,
        "completion_tokens": 50,
        "cached_tokens": 900,
        "cost": 0.0001,
    }
    assert res.model == "anthropic/claude-haiku-4.5"
    assert isinstance(res.latency_ms, int)


def test_the_python_tool_is_the_documented_one():
    fn = PYTHON_TOOL["function"]
    assert PYTHON_TOOL["type"] == "function" and fn["name"] == "python"
    assert fn["parameters"]["required"] == ["code"]
    assert "from contoso import send_to_user, send_to_agent, end_task" in fn["description"]


async def test_bad_tool_arguments_are_normalized_as_an_error_not_executable_code():
    body = json.loads(json.dumps(OK_BODY))
    body["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"] = "print(2)"
    c = client(Recorder([httpx.Response(200, json=body)]))
    res = await c.complete("m", [])
    assert res.tool_calls[0]["error"] == "invalid_tool_arguments"
    assert "code" not in res.tool_calls[0]


async def test_no_tools_and_json_mode_for_jev():
    rec = Recorder([httpx.Response(200, json={"choices": [{"message": {"content": "{}"}}]})])
    res = await client(rec).complete("m", [], response_format={"type": "json_object"})
    body = json.loads(rec.requests[0].content)
    assert "tools" not in body and body["response_format"] == {"type": "json_object"}
    assert res.text == "{}" and res.tool_calls == []
    assert res.usage == {"prompt_tokens": 0, "completion_tokens": 0, "cached_tokens": 0, "cost": 0}


def test_backoff_is_2_4_8_plus_jitter():
    delays = backoff_delays(rand=lambda: 0.5)
    assert delays == [2.5, 4.5, 8.5]


async def test_retries_429_5xx_and_transport_errors_then_succeeds():
    sleeps = []
    rec = Recorder(
        [
            httpx.Response(429, headers={"Retry-After": "7"}),
            httpx.Response(502),
            httpx.ConnectError("refused"),
            httpx.Response(200, json=OK_BODY),
        ]
    )
    res = await client(rec, sleeps).complete("m", [])
    assert res.text == "Xin chào"
    assert len(rec.requests) == 4
    assert sleeps[0] == 7  # Retry-After wins over the backoff
    assert 4 <= sleeps[1] <= 5 and 8 <= sleeps[2] <= 9


async def test_gives_up_after_three_retries():
    sleeps = []
    rec = Recorder([httpx.ReadTimeout("slow")] * 4)
    with pytest.raises(ModelUnavailable):
        await client(rec, sleeps).complete("m", [])
    assert len(rec.requests) == 4 and len(sleeps) == 3


async def test_other_errors_are_not_retried():
    rec = Recorder([httpx.Response(400, json={"error": {"message": "bad request"}})])
    with pytest.raises(ModelError) as e:
        await client(rec).complete("m", [])
    assert not isinstance(e.value, ModelUnavailable)
    assert e.value.status == 400 and "bad request" in str(e.value)
    assert e.value.code == "model_request_rejected"
    assert len(rec.requests) == 1


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (401, "model_authentication_failed"),
        (403, "model_forbidden"),
    ],
)
async def test_provider_auth_errors_are_typed(status, code):
    rec = Recorder([httpx.Response(status, json={"error": {"message": "denied"}})])
    with pytest.raises(ModelError) as error:
        await client(rec).complete("provider/model", [])
    assert error.value.status == status and error.value.code == code


async def test_timeout_and_rate_limit_exhaustion_are_typed():
    with pytest.raises(ModelUnavailable) as timeout:
        await client(Recorder([httpx.ReadTimeout("slow")] * 4)).complete("m", [])
    assert timeout.value.code == "model_timeout"
    with pytest.raises(ModelUnavailable) as limited:
        await client(Recorder([httpx.Response(429)] * 4)).complete("m", [])
    assert limited.value.code == "model_rate_limited"


async def test_refusal_and_finish_reason_are_normalized():
    body = {
        "model": "provider/model",
        "choices": [
            {
                "message": {"content": None, "refusal": "cannot comply"},
                "finish_reason": "stop",
            }
        ],
    }
    response = await client(Recorder([httpx.Response(200, json=body)])).complete("m", [])
    assert response.refusal == "cannot comply"
    assert response.error == {"code": "model_refusal", "text": "cannot comply"}


async def test_declared_text_only_capability_omits_tools():
    rec = Recorder([httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})])
    c = client(rec)
    c.set_capabilities("text/model", ModelCapabilities(supports_tools=False))
    response = await c.complete("text/model", [], tools=[PYTHON_TOOL])
    assert response.text == "ok"
    assert "tools" not in json.loads(rec.requests[0].content)


async def test_context_windows_from_models():
    rec = Recorder(
        [
            httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "id": "anthropic/claude-haiku-4.5",
                            "context_length": 200000,
                            "supported_parameters": ["tools", "tool_choice"],
                        },
                        {
                            "id": "openai/gpt-4o-mini",
                            "context_length": 128000,
                            "supported_parameters": ["stream"],
                        },
                    ]
                },
            )
        ]
    )
    c = client(rec)
    await c.load_windows()
    assert c.window("anthropic/claude-haiku-4.5") == 200000
    assert c.window("unknown/model") == 128000
    assert c.capabilities("anthropic/claude-haiku-4.5").supports_tools is True
    assert c.capabilities("openai/gpt-4o-mini").supports_tools is False
    assert c.capabilities("unknown/model").supports_tools is None
    assert c.listed("anthropic/claude-haiku-4.5") is True
    assert c.listed("unknown/model") is False
    assert str(rec.requests[0].url) == "https://openrouter.ai/api/v1/models"


async def test_window_override_and_fallback():
    c = client(Recorder([httpx.ConnectError("down")]), context_tokens=64000)
    await c.load_windows()  # failure is not fatal
    assert c.window("anthropic/claude-haiku-4.5") == 64000
    c2 = client(Recorder([httpx.ConnectError("down")]))
    await c2.load_windows()
    assert c2.listed("anthropic/claude-haiku-4.5") is None  # no catalog, no verdict


async def test_decide_request_shape_and_parsed_response():
    body = {
        "model": "typesafe/jev-1.14",
        "answers": {
            "route": {
                "type": "choice",
                "choice": "task",
                "probabilities": {"task": 0.92, "side_question": 0.08},
                "confidence": 0.92,
            }
        },
        "usage": {"input_tokens": 500, "output_tokens": 10, "cost": 0.0001},
    }
    rec = Recorder([httpx.Response(200, json=body)])
    c = client(rec)
    questions = {
        "route": {
            "type": "choice",
            "instructions": "Is this new, independent work?",
            "criteria": {"task": "t", "side_question": "s"},
        }
    }
    res = await c.decide(
        "typesafe/jev-1.14", "<current_state>...</current_state>", questions, agent="lead"
    )
    req = rec.requests[0]
    assert str(req.url) == "https://openrouter.ai/api/alpha/decisions"
    assert req.headers["Authorization"] == "Bearer sk-or-x"
    assert req.headers["X-Contoso-Agent"] == "lead" and req.headers["X-Contoso-Purpose"] == "jev"
    sent = json.loads(req.content)
    assert sent == {
        "model": "typesafe/jev-1.14",
        "state": "<current_state>...</current_state>",
        "questions": questions,
    }
    assert res.answers == body["answers"]
    assert res.usage == body["usage"]
    assert res.raw == body


async def test_decide_retries_429_5xx_and_transport_errors_then_succeeds():
    sleeps = []
    ok = {"answers": {"route": {"choice": "side_question", "confidence": 0.9}}, "usage": {}}
    rec = Recorder(
        [
            httpx.Response(429, headers={"Retry-After": "3"}),
            httpx.Response(503),
            httpx.ConnectError("refused"),
            httpx.Response(200, json=ok),
        ]
    )
    res = await client(rec, sleeps).decide("m", "state", {})
    assert res.answers["route"]["choice"] == "side_question"
    assert len(rec.requests) == 4
    assert sleeps[0] == 3  # Retry-After wins over the backoff


async def test_decide_gives_up_after_three_retries():
    rec = Recorder([httpx.Response(500)] * 4)
    with pytest.raises(ModelUnavailable):
        await client(rec).decide("m", "state", {})
    assert len(rec.requests) == 4


async def test_decide_other_errors_are_not_retried():
    rec = Recorder([httpx.Response(400, json={"error": {"message": "bad request"}})])
    with pytest.raises(ModelError) as e:
        await client(rec).decide("m", "state", {})
    assert not isinstance(e.value, ModelUnavailable)
    assert e.value.status == 400
    assert len(rec.requests) == 1


async def test_decide_sends_no_sampling_parameters():
    rec = Recorder([httpx.Response(200, json={"answers": {}, "usage": {}})])
    await client(rec).decide("m", "state", {"route": {}})
    sent = json.loads(rec.requests[0].content)
    assert set(sent) == {"model", "state", "questions"}
