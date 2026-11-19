"""Exec tokens (doc 11 "Exec token") and the running-exec registry with its 5 s grace."""

from __future__ import annotations

import uuid

import pytest

from backend.harness.tokens import ExecContext, ExecRegistry, TokenError, sign, verify

SECRET = "session-secret"
A = uuid.UUID("00000000-0000-0000-0000-00000000000a")
B = uuid.UUID("00000000-0000-0000-0000-00000000000b")


def ctx(agent=A, exec_id="x_1"):
    return ExecContext(
        agent_id=agent,
        user_id=uuid.uuid4(),
        slug="data",
        is_lead=False,
        exec_id=exec_id,
        trace_id="0" * 32,
        activation_kind="message",
        task_id=None,
        default_thread=None,
        folder="/f",
    )


def test_token_format():
    token = sign(SECRET, A, "x_1", exp=2000)
    version, agent, exec_id, exp, sig = token.split(".")
    assert (version, agent, exec_id, exp) == ("v1", str(A), "x_1", "2000")
    assert len(sig) >= 40 and "=" not in sig


def test_valid_token_while_running():
    reg = ExecRegistry()
    reg.start(ctx(), now=1000)
    token = sign(SECRET, A, "x_1", exp=1130)
    assert verify(SECRET, token, reg, now=1001).exec_id == "x_1"


@pytest.mark.parametrize(
    "mutate",
    [
        lambda tok: tok[:-2] + ("AA" if not tok.endswith("AA") else "BB"),  # bad signature
        lambda tok: tok.replace(str(A), str(B)),  # other agent
        lambda tok: tok.replace("x_1", "x_2"),  # other exec
        lambda tok: "v2" + tok[2:],  # unknown version
        lambda tok: "garbage",
    ],
)
def test_tampered_tokens_are_refused(mutate):
    reg = ExecRegistry()
    reg.start(ctx(), now=1000)
    with pytest.raises(TokenError):
        verify(SECRET, mutate(sign(SECRET, A, "x_1", exp=1130)), reg, now=1001)


def test_expired_token():
    reg = ExecRegistry()
    reg.start(ctx(), now=1000)
    with pytest.raises(TokenError):
        verify(SECRET, sign(SECRET, A, "x_1", exp=1100), reg, now=1101)


def test_wrong_running_exec_for_the_agent():
    reg = ExecRegistry()
    reg.start(ctx(exec_id="x_2"), now=1000)
    with pytest.raises(TokenError):
        verify(SECRET, sign(SECRET, A, "x_1", exp=1130), reg, now=1001)


def test_grace_period_after_the_exec_ends():
    reg = ExecRegistry()
    reg.start(ctx(), now=1000)
    reg.end("x_1", now=1010)
    token = sign(SECRET, A, "x_1", exp=1130)
    assert verify(SECRET, token, reg, now=1014.9).exec_id == "x_1"
    with pytest.raises(TokenError):
        verify(SECRET, token, reg, now=1015.1)


def test_final_is_recorded_against_the_exec():
    reg = ExecRegistry()
    reg.start(ctx(), now=1000)
    assert reg.final_requested("x_1") is False
    reg.request_final("x_1")
    assert reg.final_requested("x_1") is True
    assert reg.running(A) == "x_1"
    reg.end("x_1", now=1001)
    assert reg.running(A) is None
