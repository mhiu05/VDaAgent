"""`backend/execd_client.py`: api's client for `POST execd:7000/exec` (doc 11, doc 02)."""

from __future__ import annotations

import json

import httpx
import pytest

from backend.execd_client import ExecdClient, ExecdError, ExecResult

OK = {
    "exit_code": 0,
    "stdout": "1\n",
    "stderr": "",
    "duration_ms": 12,
    "timed_out": False,
    "truncated": False,
    "head": "abc",
    "changed": [{"path": "a.md", "status": "A"}],
    "snapshot_error": None,
}


def client_with(handler) -> ExecdClient:
    return ExecdClient("http://workspace:7000/", "tok", transport=httpx.MockTransport(handler))


async def test_exec_sends_the_documented_request():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["Authorization"]
        seen["body"] = json.loads(request.content)
        seen["timeout"] = request.extensions["timeout"]
        return httpx.Response(200, json=OK)

    c = client_with(handler)
    res = await c.exec(
        folder="/data/folders/u/data",
        exec_id="x_1",
        code="print(1)",
        timeout_s=120,
        author="agent:data",
        env_extra={"CONTOSO_API_URL": "http://api:8001"},
    )
    await c.aclose()
    assert seen["url"] == "http://workspace:7000/exec"
    assert seen["auth"] == "Bearer tok"
    assert seen["body"] == {
        "folder": "/data/folders/u/data",
        "exec_id": "x_1",
        "code": "print(1)",
        "timeout_s": 120,
        "author": "agent:data",
        "env_extra": {"CONTOSO_API_URL": "http://api:8001"},
    }
    # the HTTP timeout leaves room for the exec's own wall clock plus the snapshot
    assert seen["timeout"]["read"] > 120
    assert res == ExecResult(**OK)
    assert res.changed[0]["path"] == "a.md"


async def test_system_exec_sends_argv():
    seen = {}

    def handler(request):
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json=OK)

    c = client_with(handler)
    await c.exec(
        folder="/f", exec_id="x_2", argv=["uv", "add", "pandas"], timeout_s=600, author="user:alice"
    )
    assert "code" not in seen["body"]
    assert seen["body"]["argv"] == ["uv", "add", "pandas"]
    assert seen["body"]["env_extra"] == {}


async def test_exactly_one_of_code_and_argv():
    c = client_with(lambda r: httpx.Response(200, json=OK))
    with pytest.raises(ValueError):
        await c.exec(folder="/f", exec_id="x", timeout_s=1, author="a")
    with pytest.raises(ValueError):
        await c.exec(folder="/f", exec_id="x", code="1", argv=["true"], timeout_s=1, author="a")


async def test_error_responses_raise_execd_error():
    c = client_with(
        lambda r: httpx.Response(400, json={"error": "invalid_folder", "message": "nope"})
    )
    with pytest.raises(ExecdError) as e:
        await c.exec(folder="/f", exec_id="x", code="1", timeout_s=1, author="a")
    assert (e.value.status, e.value.code) == (400, "invalid_folder")


async def test_transport_errors_raise_execd_error():
    def handler(request):
        raise httpx.ConnectError("refused")

    c = client_with(handler)
    with pytest.raises(ExecdError) as e:
        await c.exec(folder="/f", exec_id="x", code="1", timeout_s=1, author="a")
    assert e.value.code == "unreachable"


async def test_health():
    assert await client_with(lambda r: httpx.Response(200, json={"ok": True})).health() is True
    assert await client_with(lambda r: httpx.Response(503)).health() is False
