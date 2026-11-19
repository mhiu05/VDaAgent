"""`AgentRunner`: activations and the step loop (doc 03 "Activation", "Step loop")."""

from __future__ import annotations

import json

import pytest
from sqlalchemy import func, select, update

from backend.db import tables as t
from backend.harness.model import ModelCapabilities, ModelError
from backend.harness.runner import AgentRunner
from backend.harness.tokens import verify
from backend.tests.harness.conftest import events_of, exec_result, user_message

TEXT_ONLY = """
agents:
  data:
    - reply: {text: "ghi chú riêng"}
"""

ONE_TOOL = """
agents:
  data:
    - reply: {tool: "print(1)"}
    - reply: {text: "xong"}
"""


async def run(harness, agent) -> AgentRunner:
    runner = AgentRunner(harness, agent.id)
    await runner.run_until_idle()
    return runner


async def test_a_delivery_starts_a_message_activation(conn, rows, make_harness, team):
    h = make_harness(TEXT_ONLY)
    published = h.bus.subscribe(team.user)
    msg, d = await user_message(rows, team, "data", "Xin số liệu")
    await run(h, team.data)
    evs = await events_of(conn, team.data.id)
    assert [e.kind for e in evs] == ["input", "assistant"]
    inp = evs[0]
    assert inp.activation_kind == "message" and inp.seq == 1
    assert inp.payload["text"].startswith("<current_state>\n")
    assert 'you: data ("Data")' in inp.payload["text"]
    assert f'<notification id="d_{d}" from="user:alice"' in inp.payload["text"]
    assert inp.payload["items"] == [{"type": "notification", "delivery_id": d, "message_id": msg}]
    assert len({e.trace_id for e in evs}) == 1 and len(evs[0].trace_id) == 32
    delivery = (await conn.execute(select(t.deliveries).where(t.deliveries.c.id == d))).one()
    assert (delivery.status, delivery.consumed_seq) == ("consumed", 1)
    status = await conn.scalar(select(t.agents.c.status).where(t.agents.c.id == team.data.id))
    assert status == "idle"
    assert evs[1].payload["text"] == "ghi chú riêng"
    assert evs[1].payload["usage"]["prompt_tokens"] == 0
    assert evs[1].payload["model"] == "openai/gpt-4o-mini"
    reply = (
        await conn.execute(
            select(t.messages).where(
                t.messages.c.thread_id == team.threads["data"],
                t.messages.c.sender_type == "agent",
            )
        )
    ).one()
    assert reply.content["text"] == "ghi chú riêng"
    emitted = [published.get_nowait() for _ in range(published.qsize())]
    created = [e for e in emitted if e["type"] == "message.created"]
    assert created and created[-1]["data"]["id"] == reply.id
    # the model saw system prompt + the input
    req = h.fake.requests[-1]
    assert req["agent"] == "data" and req["body"]["messages"][0]["content"] == "SYSTEM data"
    assert req["body"]["tools"][0]["function"]["name"] == "python"


async def test_nothing_pending_means_no_activation(conn, make_harness, team):
    h = make_harness(TEXT_ONLY)
    await run(h, team.data)
    assert await events_of(conn, team.data.id) == []
    assert h.fake.requests == []


async def test_tool_call_runs_an_exec_and_loops(conn, rows, make_harness, team, settings):
    h = make_harness(ONE_TOOL)
    await user_message(rows, team, "data", "x")
    await run(h, team.data)
    evs = await events_of(conn, team.data.id)
    assert [e.kind for e in evs] == ["input", "assistant", "tool_result", "assistant"]
    call = h.execd.calls[0]
    assert call["code"] == "print(1)" and call["author"] == "agent:data"
    assert call["folder"] == f"{settings.FOLDERS_DIR}/{team.user}/data"
    assert call["timeout_s"] == settings.EXEC_TIMEOUT_S
    env = call["env_extra"]
    assert env["CONTOSO_API_URL"] == settings.INTERNAL_URL
    assert env["CONTOSO_DEFAULT_THREAD"] == "direct:data"
    ctx = verify(
        settings.SESSION_SECRET.get_secret_value(),
        env["CONTOSO_EXEC_TOKEN"],
        _always_live(call["exec_id"], team.data.id),
        now=0,
    )
    assert ctx.exec_id == call["exec_id"]
    tool_call_id = evs[1].payload["tool_calls"][0]["id"]
    res = evs[2].payload
    assert res["tool_call_id"] == tool_call_id and res["exec_id"] == call["exec_id"]
    assert res["text"] == "exit_code: 0 · 0.1 s\n--- stdout ---\nok\n"
    # the second model call saw the tool result
    msgs = h.fake.requests[-1]["body"]["messages"]
    assert msgs[-1] == {"role": "tool", "tool_call_id": tool_call_id, "content": res["text"]}


async def test_agent_to_agent_message_does_not_suppress_final_user_text(
    conn, rows, make_harness, team
):
    h = make_harness(ONE_TOOL)

    async def handler(call, harness):
        from backend.messaging.messages import post_message
        from backend.messaging.threads import agent_thread

        async with harness.db() as c:
            thread_id = await agent_thread(c, team.user, [team.data, team.lead])
            trace_id = (await events_of(c, team.data.id))[0].trace_id
            await post_message(
                harness,
                c,
                thread_id=thread_id,
                sender_type="agent",
                sender_id=team.data.id,
                content={"text": "internal handoff"},
                trace_id=trace_id,
            )
        return exec_result("ok")

    h.execd.handler = handler
    await user_message(rows, team, "data", "x")
    await run(h, team.data)
    user_reply = (
        await conn.execute(
            select(t.messages).where(
                t.messages.c.thread_id == team.threads["data"],
                t.messages.c.sender_type == "agent",
            )
        )
    ).one()
    assert user_reply.content["text"] == "xong"


def _always_live(exec_id, agent_id):
    class Reg:
        def live(self, a, e, now):
            return type("C", (), {"exec_id": e})() if (a, e) == (agent_id, exec_id) else None

    return Reg()


async def test_the_exec_holds_the_job_lock(rows, make_harness, team):
    h = make_harness(ONE_TOOL)
    seen = []

    def handler(call, harness):
        seen.append(harness.job_lock(team.data.id).locked())
        return exec_result("ok")

    h.execd.handler = handler
    await user_message(rows, team, "data", "x")
    await run(h, team.data)
    assert seen == [True]
    assert not h.job_lock(team.data.id).locked()


async def test_final_with_exit_0_ends_without_another_model_call(conn, rows, make_harness, team):
    h = make_harness(ONE_TOOL)

    def handler(call, harness):
        harness.registry.request_final(call["exec_id"])  # what send_to_user(final=True) does
        return exec_result("sent")

    h.execd.handler = handler
    await user_message(rows, team, "data", "x")
    await run(h, team.data)
    evs = await events_of(conn, team.data.id)
    assert [e.kind for e in evs] == ["input", "assistant", "tool_result"]
    assert evs[2].payload["final"] is True
    assert len(h.fake.requests) == 1


async def test_final_with_an_exception_keeps_looping(conn, rows, make_harness, team):
    h = make_harness(ONE_TOOL)

    def handler(call, harness):
        harness.registry.request_final(call["exec_id"])
        return exec_result("", "Traceback: boom", exit_code=1)

    h.execd.handler = handler
    await user_message(rows, team, "data", "x")
    await run(h, team.data)
    evs = await events_of(conn, team.data.id)
    assert [e.kind for e in evs] == ["input", "assistant", "tool_result", "assistant"]
    assert evs[2].payload["final"] is False


async def test_several_tool_calls_run_in_order(conn, rows, make_harness, team):
    h = make_harness(TEXT_ONLY)
    # a model that returns two tool calls in one turn
    h.fake.scenario.agents["data"] = [{"reply": {"tool": "print('a')"}}]
    original = h.fake._agent_reply

    def two_calls(agent, messages):
        msg = original(agent, messages)
        if msg.get("tool_calls"):
            second = json.loads(json.dumps(msg["tool_calls"][0]))
            second["id"] = "call_second"
            second["function"]["arguments"] = json.dumps({"code": "print('b')"})
            msg["tool_calls"].append(second)
        return msg

    h.fake._agent_reply = two_calls
    await user_message(rows, team, "data", "x")
    await run(h, team.data)
    assert [c["code"] for c in h.execd.calls] == ["print('a')", "print('b')"]
    evs = await events_of(conn, team.data.id)
    kinds = [e.kind for e in evs]
    assert kinds == ["input", "assistant", "tool_result", "tool_result", "assistant", "error"]
    assert evs[-1].payload["code"] == "empty_model_response"
    ids = [c["id"] for c in evs[1].payload["tool_calls"]]
    assert [evs[2].payload["tool_call_id"], evs[3].payload["tool_call_id"]] == ids


async def test_step_limit(conn, rows, make_harness, team):
    h = make_harness(
        """
    agents:
      data:
        - reply: {tool: "print(1)"}
        - reply: {tool: "print(2)"}
        - reply: {tool: "print(3)"}
    """,
        MAX_STEPS_PER_ACTIVATION=2,
    )
    await user_message(rows, team, "data", "x")
    await run(h, team.data)
    evs = await events_of(conn, team.data.id)
    assert [e.kind for e in evs] == [
        "input",
        "assistant",
        "tool_result",
        "assistant",
        "tool_result",
        "error",
    ]
    assert evs[-1].payload["code"] == "step_limit"
    assert evs[-1].payload["text"] == "step limit reached"
    assert len(h.fake.requests) == 2


async def test_model_unavailable_goes_idle_and_keeps_the_input(conn, rows, make_harness, team):
    h = make_harness(TEXT_ONLY)

    async def down(*a, **kw):
        from backend.harness.model import ModelUnavailable

        raise ModelUnavailable("HTTP 503")

    h.model.complete = down
    _, d = await user_message(rows, team, "data", "x")
    await run(h, team.data)
    evs = await events_of(conn, team.data.id)
    assert [e.kind for e in evs] == ["input", "error"]
    assert evs[1].payload["code"] == "model_unavailable"
    status = await conn.scalar(select(t.deliveries.c.status).where(t.deliveries.c.id == d))
    assert status == "consumed"


async def test_deliveries_arriving_during_an_exec_show_in_the_footer_and_run_next(
    conn, rows, make_harness, team
):
    h = make_harness("""
    agents:
      data:
        - reply: {tool: "print(1)"}
        - reply: {text: "xong"}
        - reply: {text: "lần hai"}
    """)

    async def handler(call, harness):
        if len(h.execd.calls) == 1:
            await user_message(rows, team, "data", "tin mới")
        return exec_result("ok")

    h.execd.handler = handler
    await user_message(rows, team, "data", "x")
    await run(h, team.data)
    evs = await events_of(conn, team.data.id)
    assert evs[2].payload["text"].endswith("[1 notification pending]")
    # after going idle, the pending delivery started the next activation at once
    assert [e.kind for e in evs] == [
        "input",
        "assistant",
        "tool_result",
        "assistant",
        "input",
        "assistant",
    ]
    assert evs[4].trace_id != evs[0].trace_id
    assert "tin mới" in evs[4].payload["text"]


async def test_every_tool_call_gets_exactly_one_result_even_if_execd_fails(
    conn, rows, make_harness, team
):
    from backend.execd_client import ExecdError

    h = make_harness(ONE_TOOL)

    def handler(call, harness):
        raise ExecdError(None, "unreachable", "connection refused")

    h.execd.handler = handler
    await user_message(rows, team, "data", "x")
    await run(h, team.data)
    evs = await events_of(conn, team.data.id)
    assert [e.kind for e in evs] == ["input", "assistant", "tool_result", "assistant"]
    assert evs[2].payload["text"].startswith("exit_code: error (execd unreachable")
    assert evs[2].payload["exit_code"] is None


async def test_status_is_busy_during_the_activation(conn, rows, make_harness, team):
    h = make_harness(ONE_TOOL)
    statuses = []

    async def handler(call, harness):
        statuses.append(
            await conn.scalar(select(t.agents.c.status).where(t.agents.c.id == team.data.id))
        )
        return exec_result("ok")

    h.execd.handler = handler
    queue = h.bus.subscribe(team.user)
    await user_message(rows, team, "data", "x")
    await run(h, team.data)
    assert statuses == ["busy"]
    published = []
    while not queue.empty():
        published.append(queue.get_nowait())
    agent_status = [e["data"]["status"] for e in published if e["type"] == "agent.status"]
    assert agent_status == ["busy", "idle"]


async def test_soft_limit_marks_compaction_pending(conn, rows, make_harness, team):
    h = make_harness(TEXT_ONLY)
    h.sources["compaction"] = None  # only the flag is under test here, not the compaction
    h.model._override = 1300  # ~3,300 chars ≈ 950 tokens: above 60 %, below 90 %
    await user_message(rows, team, "data", "x" * 3000)
    await run(h, team.data)
    pending = await conn.scalar(
        select(t.agents.c.compaction_pending).where(t.agents.c.id == team.data.id)
    )
    assert pending is True


async def test_overflow_after_batch_offload_is_an_error(conn, rows, make_harness, team):
    h = make_harness(TEXT_ONLY)
    h.sources["compaction"] = None  # the follow-up compaction is tested in test_compaction
    h.model._override = 100
    lead = team.lead
    task = await rows.insert(
        t.global_tasks,
        user_id=team.user,
        description="Phân tích",
        status="running",
        started_at=func.now(),
    )
    await rows.insert(t.task_involvement, task_id=task, agent_id=lead.id)
    await user_message(rows, team, "lead", "x" * 2000)
    await run(h, lead)
    evs = await events_of(conn, lead.id)
    assert [e.kind for e in evs] == ["input", "error"]
    assert evs[1].payload["code"] == "context_overflow"
    assert h.fake.requests == []  # never sent to the model
    row = (await conn.execute(select(t.global_tasks).where(t.global_tasks.c.id == task))).one()
    assert (row.status, row.outcome, row.ended_by) == ("failed", "context overflow", "harness")
    assert row.ended_at is not None
    pending = await conn.scalar(
        select(t.agents.c.compaction_pending).where(t.agents.c.id == lead.id)
    )
    assert pending is True
    system = (
        await conn.execute(
            select(t.messages).where(
                t.messages.c.thread_id == team.threads["lead"], t.messages.c.sender_type == "system"
            )
        )
    ).one()
    assert system.content["text"]


async def test_hard_limit_batch_offloads_first(conn, rows, make_harness, team):
    h = make_harness("""
    agents:
      data:
        - reply: {tool: "print(1)"}
        - reply: {tool: "print(2)"}
        - reply: {tool: "print(3)"}
        - reply: {text: "xong"}
    """)
    big = "z" * 7000
    h.execd.handler = lambda call, harness: exec_result(big)
    h.model._override = 6000  # 7000 chars ≈ 2000 tokens per result; hard limit at 5400
    await conn.execute(update(t.agents).values(compaction_pending=False))
    await user_message(rows, team, "data", "x")
    await run(h, team.data)
    evs = await events_of(conn, team.data.id)
    errors = [e.payload["code"] for e in evs if e.kind == "error"]
    assert "batch_offload" in errors
    assert any(e.payload.get("batch_offloaded_at") for e in evs if e.kind == "tool_result")


async def test_task_plain_text_gets_one_correction_then_visible_terminal_failure(
    conn, rows, make_harness, team
):
    h = make_harness("""
    agents:
      lead:
        - reply: {text: "Tôi sẽ làm việc đó."}
        - reply: {text: "Đã xong."}
    """)
    source = await rows.insert(
        t.messages,
        thread_id=team.threads["lead"],
        sender_type="user",
        sender_id=team.user,
        content={"text": "Hãy truy vấn kho dữ liệu"},
    )
    task_id = await rows.insert(
        t.global_tasks,
        user_id=team.user,
        source_message_id=source,
        description="Truy vấn kho dữ liệu",
        status="queued",
    )
    await run(h, team.lead)
    evs = await events_of(conn, team.lead.id)
    assert [e.kind for e in evs] == ["input", "assistant", "error", "assistant", "error"]
    assert evs[2].payload["code"] == "tool_required"
    assert evs[-1].payload["code"] == "MODEL_PROTOCOL_ERROR"
    assert len(h.fake.requests) == 2
    task = (await conn.execute(select(t.global_tasks).where(t.global_tasks.c.id == task_id))).one()
    assert (task.status, task.ended_by) == ("failed", "harness")
    failure = (
        await conn.execute(
            select(t.messages).where(
                t.messages.c.thread_id == team.threads["lead"],
                t.messages.c.sender_type == "system",
            )
        )
    ).one()
    assert "mô hình" in failure.content["text"]


async def test_task_corrective_turn_can_succeed(conn, rows, make_harness, team):
    h = make_harness("""
    agents:
      lead:
        - reply: {text: "Tôi sẽ làm."}
        - reply: {tool: "print('deliver and end')"}
    """)
    source = await rows.insert(
        t.messages,
        thread_id=team.threads["lead"],
        sender_type="user",
        sender_id=team.user,
        content={"text": "Làm tác vụ"},
    )
    task_id = await rows.insert(
        t.global_tasks,
        user_id=team.user,
        source_message_id=source,
        description="Làm tác vụ",
        status="queued",
    )

    async def handler(call, harness):
        from backend.harness.queue import end_by
        from backend.messaging.messages import post_agent_text

        async with harness.db() as c:
            task = (
                await c.execute(select(t.global_tasks).where(t.global_tasks.c.id == task_id))
            ).one()
            await post_agent_text(
                harness,
                c,
                agent=team.lead,
                thread_ref="direct:lead",
                text="Hoàn tất.",
                trace_id=(await events_of(c, team.lead.id))[0].trace_id,
            )
            await end_by(
                harness,
                c,
                task,
                status="done",
                ended_by="lead",
                outcome="done",
                notice_kind=None,
                notice_text=None,
            )
        harness.registry.request_final(call["exec_id"])
        return exec_result("ok")

    h.execd.handler = handler
    await run(h, team.lead)
    assert len(h.fake.requests) == 2 and len(h.execd.calls) == 1
    status = await conn.scalar(
        select(t.global_tasks.c.status).where(t.global_tasks.c.id == task_id)
    )
    assert status == "done"


async def test_known_model_without_tools_fails_required_task_gracefully(
    conn, rows, make_harness, team
):
    h = make_harness("agents: {}\n")
    h.model.set_capabilities(h.settings.AGENT_MODEL, ModelCapabilities(supports_tools=False))
    source = await rows.insert(
        t.messages,
        thread_id=team.threads["lead"],
        sender_type="user",
        sender_id=team.user,
        content={"text": "Tạo báo cáo"},
    )
    await rows.insert(
        t.global_tasks,
        user_id=team.user,
        source_message_id=source,
        description="Tạo báo cáo",
        status="queued",
    )
    await run(h, team.lead)
    evs = await events_of(conn, team.lead.id)
    assert evs[-1].payload["code"] == "MODEL_CAPABILITY_UNSUPPORTED"
    assert evs[-1].payload["required_capability"] == "native_tool_calling"
    assert h.fake.requests == []


async def test_malformed_tool_arguments_fail_visibly_without_execution(
    conn, rows, make_harness, team
):
    h = make_harness("agents: {}\n")

    def malformed(agent, messages):
        return {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "bad",
                    "type": "function",
                    "function": {"name": "python", "arguments": "not-json"},
                }
            ],
        }

    h.fake._agent_reply = malformed
    await user_message(rows, team, "data", "x")
    await run(h, team.data)
    evs = await events_of(conn, team.data.id)
    assert evs[-1].payload["code"] == "invalid_tool_arguments"
    assert h.execd.calls == []
    assert (
        await conn.scalar(
            select(func.count()).select_from(t.messages).where(t.messages.c.sender_type == "system")
        )
        == 1
    )


async def test_deepseek_model_id_uses_the_same_text_finalization_contract(
    conn, rows, make_harness, team
):
    model = "deepseek/deepseek-v4.1-flash"
    h = make_harness(TEXT_ONLY, AGENT_MODEL=model, COMPACTION_MODEL=model)
    await user_message(rows, team, "data", "xin chào")
    await run(h, team.data)
    assert h.fake.requests[0]["body"]["model"] == model
    reply = (
        await conn.execute(select(t.messages).where(t.messages.c.sender_type == "agent"))
    ).one()
    assert reply.content["text"] == "ghi chú riêng"


@pytest.mark.parametrize(
    "code",
    [
        "model_timeout",
        "model_authentication_failed",
        "model_forbidden",
        "model_rate_limited",
        "model_provider_error",
    ],
)
async def test_provider_failures_are_typed_visible_and_terminal(
    code, conn, rows, make_harness, team
):
    h = make_harness(TEXT_ONLY)

    async def fail(*args, **kwargs):
        raise ModelError("provider failed", code=code)

    h.model.complete = fail
    await user_message(rows, team, "data", "x")
    await run(h, team.data)
    evs = await events_of(conn, team.data.id)
    assert evs[-1].payload["code"] == code
    assert (
        await conn.scalar(select(t.agents.c.status).where(t.agents.c.id == team.data.id)) == "idle"
    )
    assert (
        await conn.scalar(
            select(func.count()).select_from(t.messages).where(t.messages.c.sender_type == "system")
        )
        == 1
    )


# --- debounce (merged from Agent-A-ThanhTung) ------------------------------------------------


async def test_debounce_never_refetches_claimed_work():
    """A task is `running` once fetched: debouncing must not fetch again and drop it."""
    import asyncio
    from types import SimpleNamespace

    from backend.harness.items import Work
    from backend.harness.runner import AgentRunner

    fetches = []

    async def next_work(conn, agent):
        fetches.append(1)
        return None

    h = SimpleNamespace(settings=SimpleNamespace(RUNNER_DEBOUNCE_S=0.05), next_work=next_work)
    runner = AgentRunner(h, agent_id=None, wake_event=asyncio.Event())
    for kind in ("task", "routine", "compaction"):
        work = Work(kind=kind, blocks=[], items=[])
        assert await runner._debounced_work(h, work) is work
    assert fetches == []
