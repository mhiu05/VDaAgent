"""Langfuse mapping (doc 13 "Mapping our runtime onto Langfuse") and logs (doc 13 "Logs")."""

from __future__ import annotations

import json
import logging
from contextlib import contextmanager

from sqlalchemy import func

from backend.db import tables as t
from backend.harness.runner import AgentRunner
from backend.observability import tracing
from backend.tests.harness.conftest import exec_result, user_message


class FakeActivation:
    def __init__(self, log, kw):
        self.log, self.kw = log, kw

    def generation(self, **kw):
        self.log.append(("generation", kw))

    def tool(self, **kw):
        self.log.append(("tool", kw))


class FakeTracer(tracing.Tracer):
    def __init__(self):
        self.log = []

    @contextmanager
    def activation(self, **kw):
        self.log.append(("activation", kw))
        yield FakeActivation(self.log, kw)

    def event(self, **kw):
        self.log.append(("event", kw))

    def jev(self, **kw):
        self.log.append(("jev", kw))


SCRIPT = """
agents:
  data:
    - reply: {tool: "print(1)"}
    - reply: {text: "xong"}
"""


async def test_an_activation_is_one_trace_with_generations_and_tools(
    conn, rows, make_harness, team
):
    h = make_harness(SCRIPT)
    h.tracer = FakeTracer()
    h.execd.handler = lambda call, harness: exec_result("1\n")
    task = await rows.insert(
        t.global_tasks, user_id=team.user, description="x", status="running", started_at=func.now()
    )
    await rows.insert(t.task_involvement, task_id=task, agent_id=team.data.id)
    msg, _ = await user_message(rows, team, "data", "Xin số liệu")
    await conn.execute(t.messages.update().where(t.messages.c.id == msg).values(trace_id="c" * 32))
    await AgentRunner(h, team.data.id).run_until_idle()
    kinds = [k for k, _ in h.tracer.log]
    assert kinds == ["activation", "generation", "tool", "generation"]
    act = h.tracer.log[0][1]
    assert len(act["trace_id"]) == 32 and act["slug"] == "data" and act["username"] == "alice"
    assert act["session_id"] == f"task:T{task}"
    assert set(act["tags"]) >= {"fabrikam", "data", "message"} and "lead" not in act["tags"]
    assert act["trigger_trace_ids"] == ["c" * 32]
    first, second = h.tracer.log[1][1], h.tracer.log[3][1]
    assert first["model"] == "openai/gpt-4o-mini"
    assert [m["role"] for m in first["input"]] == ["system", "user"]  # first call: everything
    assert [m["role"] for m in second["input"]] == ["assistant", "tool"]  # then deltas only
    assert first["usage"] == {"input": 0, "output": 0, "cache_read": 0}
    assert first["cost"] == 0
    tool = h.tracer.log[2][1]
    assert tool["code"] == "print(1)" and tool["output"].startswith("exit_code: 0")
    assert tool["metadata"]["exit_code"] == 0


async def test_session_outside_a_task_is_the_agent(rows, make_harness, team):
    h = make_harness("agents: {data: [{reply: {text: x}}]}\n")
    h.tracer = FakeTracer()
    await user_message(rows, team, "data", "hi")
    await AgentRunner(h, team.data.id).run_until_idle()
    assert h.tracer.log[0][1]["session_id"] == f"agent:{team.data.id}"


async def test_jev_is_a_generation_in_the_posters_trace(conn, make_harness, team):
    from backend.messaging.messages import post_message

    h = make_harness("jev: [{label: side_question}]\n")
    h.tracer = FakeTracer()
    h.wake = lambda a: None
    h.jev.schedule = lambda d: None
    async with h.db() as c:
        msg = await post_message(
            h,
            c,
            thread_id=team.threads["lead"],
            sender_type="user",
            sender_id=team.user,
            content={"text": "chào"},
            trace_id="d" * 32,
        )
    delivery = await conn.scalar(
        t.deliveries.select()
        .with_only_columns(t.deliveries.c.id)
        .where(t.deliveries.c.message_id == msg)
    )
    await h.jev.classify(delivery)
    jev = [kw for k, kw in h.tracer.log if k == "jev"]
    assert jev and jev[0]["trace_id"] == "d" * 32 and jev[0]["label"] == "side_question"
    assert jev[0]["model"] == h.settings.JEV_MODEL and jev[0]["confidence"] == 1.0


def test_tracing_is_off_without_keys(platform_env):
    from backend.settings import Settings

    assert type(tracing.build_tracer(Settings())) is tracing.Tracer
    s = Settings(
        LANGFUSE_PUBLIC_KEY="pk-lf-1",
        LANGFUSE_SECRET_KEY="sk-lf-1",
        LANGFUSE_BASE_URL="http://127.0.0.1:9",
    )
    assert isinstance(tracing.build_tracer(s), tracing.LangfuseTracer)


def test_the_langfuse_tracer_never_raises_when_langfuse_is_down(platform_env):
    from backend.settings import Settings

    tracer = tracing.build_tracer(
        Settings(
            LANGFUSE_PUBLIC_KEY="pk-lf-1",
            LANGFUSE_SECRET_KEY="sk-lf-1",
            LANGFUSE_BASE_URL="http://127.0.0.1:9",
        )
    )
    with tracer.activation(
        trace_id="e" * 32,
        name="activation:data",
        slug="data",
        username="alice",
        session_id="agent:x",
        tags=["fabrikam"],
        metadata={},
        trigger_trace_ids=[],
    ) as act:
        act.generation(
            model="m",
            input=[{"role": "user", "content": "x"}],
            output={},
            usage={"input": 1, "output": 1, "cache_read": 0},
            cost=0.1,
            latency_ms=5,
        )
        act.tool(code="print(1)", output="exit_code: 0", metadata={"exit_code": 0})
    tracer.event(trace_id="e" * 32, name="send_to_user", metadata={"message_id": 1})
    tracer.jev(
        trace_id="e" * 32,
        model="m",
        input={},
        output={},
        label="task",
        confidence=0.92,
        latency_ms=3,
    )
    tracer.flush()


def test_structured_logs_are_json_with_context(capsys):
    from backend.observability import logging as vlog

    vlog.configure(json_output=True)
    log = vlog.get_logger("test")
    with vlog.bound(trace_id="f" * 32, agent_id="a1", exec_id="x_1"):
        log.info("exec finished", exit_code=0)
    line = capsys.readouterr().out.strip().splitlines()[-1]
    record = json.loads(line)
    assert record["event"] == "exec finished" and record["trace_id"] == "f" * 32
    assert record["agent_id"] == "a1" and record["exec_id"] == "x_1"
    assert record["exit_code"] == 0 and record["level"] == "info"
    logging.getLogger().handlers.clear()
