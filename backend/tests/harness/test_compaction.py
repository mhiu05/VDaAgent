"""Compaction (doc 06 "Compaction"; decisions 0004, 0005)."""

from __future__ import annotations

import time

import httpx
from sqlalchemy import func, select, update

from backend.api.internal import create_internal_app
from backend.db import tables as t
from backend.harness import compaction
from backend.harness import events as ev
from backend.harness.runner import AgentRunner
from backend.harness.tokens import ExecContext, sign
from backend.tests.harness.conftest import events_of

WRITES_SUMMARY = """
agents:
  data:
    - match: {input_contains: "<compaction>"}
      reply: {tool: "from contoso import write_summary\\nwrite_summary('Tóm tắt mới')"}
    - reply: {text: "done"}
"""


async def pending(conn, agent_id, value=True):
    await conn.execute(
        update(t.agents).where(t.agents.c.id == agent_id).values(compaction_pending=value)
    )


async def agent_row(h, agent_id):
    async with h.db() as c:
        return (await c.execute(select(t.agents).where(t.agents.c.id == agent_id))).one()


# --- safe point -----------------------------------------------------------------------------


async def test_refused_while_involved_in_a_running_task(conn, rows, make_harness, team):
    h = make_harness()
    await pending(conn, team.data.id)
    task = await rows.insert(
        t.global_tasks, user_id=team.user, description="x", status="running", started_at=func.now()
    )
    await rows.insert(t.task_involvement, task_id=task, agent_id=team.data.id)
    agent = await agent_row(h, team.data.id)
    async with h.db() as c:
        assert await compaction.compaction_source(h, c, agent) is None
    await conn.execute(
        update(t.global_tasks).values(
            status="done", ended_at=func.now(), ended_by="lead", outcome="x"
        )
    )
    agent = await agent_row(h, team.data.id)
    async with h.db() as c:
        work = await compaction.compaction_source(h, c, agent)
    assert work is not None and work.kind == "compaction"


async def test_not_pending_means_nothing(make_harness, team):
    h = make_harness()
    agent = await agent_row(h, team.data.id)
    async with h.db() as c:
        assert await compaction.compaction_source(h, c, agent) is None


# --- the procedure --------------------------------------------------------------------------


async def run_with_exec_calling_internal(h, team, settings):
    """Execs call the real internal app in-process (as contoso would), with the exec's token."""
    app = create_internal_app(h)

    async def handler(call, harness):
        from backend.tests.harness.conftest import exec_result

        if "write_summary" in call["code"]:
            text = call["code"].split("write_summary(")[1].rstrip(")").strip("'\"")
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://i"
            ) as c:
                r = await c.post(
                    "/internal/v1/write_summary",
                    json={"text": text},
                    headers={"Authorization": f"Bearer {call['env_extra']['CONTOSO_EXEC_TOKEN']}"},
                )
            return exec_result(
                "",
                "" if r.status_code == 204 else r.text,
                exit_code=0 if r.status_code == 204 else 1,
            )
        return exec_result("ok")

    h.execd.handler = handler
    await AgentRunner(h, team.data.id).run_until_idle()


async def test_success_opens_a_new_epoch_from_the_folder(conn, make_harness, team, settings):
    h = make_harness(WRITES_SUMMARY, COMPACTION_MODEL="anthropic/claude-haiku-4.5")
    folder = h.folder(team.data)
    (folder / "memory").mkdir()
    (folder / "memory" / "index.md").write_text("# Memory\n- preferences.md: thích biểu đồ cột\n")
    for seq_text in ("trước", "nữa"):
        await ev.append(
            conn,
            team.data.id,
            kind="error",
            payload={"code": "restart", "text": seq_text},
            trace_id="0" * 32,
            activation_kind="message",
        )
    await pending(conn, team.data.id)
    await run_with_exec_calling_internal(h, team, settings)

    evs = await events_of(conn, team.data.id)
    compaction_input = next(e for e in evs if e.kind == "input")
    assert compaction_input.activation_kind == "compaction"
    assert "<compaction>" in compaction_input.payload["text"]
    assert "write_summary" in compaction_input.payload["text"]  # platform/compaction.md
    assert h.fake.requests[0]["body"]["model"] == "anthropic/claude-haiku-4.5"
    assert h.fake.requests[0]["purpose"] == "compaction"
    epochs = (
        await conn.execute(
            select(t.agent_epochs)
            .where(t.agent_epochs.c.agent_id == team.data.id)
            .order_by(t.agent_epochs.c.epoch)
        )
    ).all()
    assert [(e.epoch, e.reason) for e in epochs] == [(0, "initial"), (1, "compaction")]
    new = epochs[1]
    assert new.summary == "Tóm tắt mới"
    assert new.start_seq == evs[-1].seq  # the compaction's own events are left out
    assert "thích biểu đồ cột" in new.system_prompt  # re-read memory/index.md
    agent = await agent_row(h, team.data.id)
    assert (agent.compaction_pending, agent.compaction_failures, agent.status) == (False, 0, "idle")


async def test_failure_keeps_it_pending_with_backoff(conn, make_harness, team, settings):
    h = make_harness("""
    agents:
      data:
        - match: {input_contains: "<compaction>"}
          reply: {text: ""}
    """)
    await pending(conn, team.data.id)
    await run_with_exec_calling_internal(h, team, settings)
    agent = await agent_row(h, team.data.id)
    assert (agent.compaction_pending, agent.compaction_failures) == (True, 1)
    epochs = await conn.scalar(
        select(func.count())
        .select_from(t.agent_epochs)
        .where(t.agent_epochs.c.agent_id == team.data.id)
    )
    assert epochs == 1
    # backed off: not retried straight away
    async with h.db() as c:
        assert await compaction.compaction_source(h, c, agent) is None
    assert compaction.backoff_s(1) == 60 and compaction.backoff_s(2) == 300
    assert compaction.backoff_s(3) == 1800 and compaction.backoff_s(9) == 1800


async def test_text_only_compaction_model_stores_summary_without_tools(
    conn, make_harness, team, settings
):
    model = "deepseek/deepseek-v4.1-flash"
    h = make_harness(
        """
        agents:
          data:
            - match: {input_contains: "<compaction>"}
              reply: {text: "Tóm tắt trực tiếp từ mô hình."}
        """,
        COMPACTION_MODEL=model,
    )
    await pending(conn, team.data.id)
    await run_with_exec_calling_internal(h, team, settings)
    epochs = (
        await conn.execute(
            select(t.agent_epochs)
            .where(t.agent_epochs.c.agent_id == team.data.id)
            .order_by(t.agent_epochs.c.epoch)
        )
    ).all()
    assert epochs[-1].summary == "Tóm tắt trực tiếp từ mô hình."
    assert h.fake.requests[0]["body"]["model"] == model
    assert (await agent_row(h, team.data.id)).compaction_pending is False


async def test_write_summary_outside_compaction_is_refused(make_harness, team, settings):
    h = make_harness()
    ctx = ExecContext(
        agent_id=team.data.id,
        user_id=team.user,
        slug="data",
        is_lead=False,
        exec_id="x_1",
        trace_id="0" * 32,
        activation_kind="message",
        task_id=None,
        default_thread=None,
        folder="/f",
        compacting=False,
    )
    h.registry.start(ctx, now=time.time())
    token = sign(
        settings.SESSION_SECRET.get_secret_value(), team.data.id, "x_1", exp=int(time.time()) + 60
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_internal_app(h)), base_url="http://i"
    ) as c:
        r = await c.post(
            "/internal/v1/write_summary",
            json={"text": "x"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert (r.status_code, r.json()["error"]) == (409, "not_compacting")


async def test_a_compaction_too_large_even_after_offload_is_truncated(conn, make_harness, team):
    h = make_harness(WRITES_SUMMARY)
    h.model._override = 50
    await conn.execute(
        update(t.agent_epochs)
        .where(t.agent_epochs.c.agent_id == team.data.id)
        .values(summary="Tóm tắt cũ")
    )
    await ev.append(
        conn,
        team.data.id,
        kind="input",
        payload={"text": "x" * 2000, "items": []},
        trace_id="0" * 32,
        activation_kind="message",
    )
    await pending(conn, team.data.id)
    await AgentRunner(h, team.data.id).run_until_idle()
    epochs = (
        await conn.execute(
            select(t.agent_epochs)
            .where(t.agent_epochs.c.agent_id == team.data.id)
            .order_by(t.agent_epochs.c.epoch)
        )
    ).all()
    assert epochs[-1].reason == "truncated"
    assert epochs[-1].summary == "Tóm tắt cũ\n[Ngữ cảnh trước đó bị lược bỏ do vượt giới hạn]"
    errors = [e.payload["code"] for e in await events_of(conn, team.data.id) if e.kind == "error"]
    assert "compaction_truncated" in errors
    agent = await agent_row(h, team.data.id)
    assert agent.compaction_pending is False


async def test_the_lead_compacts_before_beginning_the_next_task(conn, rows, make_harness, team):
    h = make_harness()
    await rows.insert(t.global_tasks, user_id=team.user, description="Tiếp", status="queued")
    await pending(conn, team.lead.id)
    lead = await agent_row(h, team.lead.id)
    async with h.db() as c:
        work = await h.next_work(c, lead)
    assert work.kind == "compaction"
    assert await conn.scalar(select(t.global_tasks.c.status)) == "queued"
