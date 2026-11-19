"""jev (doc 07 "jev"; decision 0002)."""

from __future__ import annotations

import asyncio
import json

from sqlalchemy import func, select

from backend.db import tables as t
from backend.harness.jev import build_jev_context
from backend.messaging.messages import post_message

JEV = """
jev:
  - match: {message_contains: "Vì sao"}
    label: task
  - label: side_question
"""


async def post_to_lead(h, team, text, attachments=()):
    h.wake = lambda a: None
    h.jev.schedule = lambda d: None
    async with h.db() as c:
        msg = await post_message(
            h,
            c,
            thread_id=team.threads["lead"],
            sender_type="user",
            sender_id=team.user,
            content={"text": text},
        )
        for name in attachments:
            await c.execute(
                t.attachments.insert().values(
                    message_id=msg,
                    filename=name,
                    mime="x",
                    size=1,
                    sha256="a" * 64,
                    path=f"/data/attachments/{msg}/{name}",
                )
            )
    delivery = await c.scalar(select(t.deliveries.c.id).where(t.deliveries.c.message_id == msg))
    return msg, delivery


async def test_task_label_queues_a_global_task(conn, make_harness, team):
    h = make_harness(JEV)
    msg, d = await post_to_lead(h, team, "Vì sao căn MAS-U03832 bán chậm?")
    woken = []
    h.wake = woken.append
    await h.jev.classify(d)
    task = (await conn.execute(select(t.global_tasks))).one()
    assert (task.status, task.description, task.source_message_id) == (
        "queued",
        "Vì sao căn MAS-U03832 bán chậm?",
        msg,
    )
    delivery = (await conn.execute(select(t.deliveries).where(t.deliveries.c.id == d))).one()
    assert (delivery.status, delivery.consumed_seq) == ("consumed", None)
    decision = (await conn.execute(select(t.jev_decisions))).one()
    assert (decision.label, decision.confidence, decision.fallback, decision.message_id) == (
        "task",
        1.0,
        False,
        msg,
    )
    assert decision.lead_id == team.lead.id
    assert decision.model == h.settings.JEV_MODEL and len(decision.trace_id) == 32
    assert "Vì sao căn MAS-U03832" in json.dumps(decision.input, ensure_ascii=False)
    assert woken == [team.lead.id]
    req = h.fake.requests[-1]
    assert req["purpose"] == "jev"
    assert req["body"]["model"] == h.settings.JEV_MODEL
    assert req["body"]["questions"]["route"]["criteria"].keys() == {"task", "side_question"}
    assert "Vì sao căn MAS-U03832" in req["body"]["state"]


async def test_side_question_becomes_a_pending_notification(conn, make_harness, team):
    h = make_harness(JEV)
    _, d = await post_to_lead(h, team, "cảm ơn nhé")
    await h.jev.classify(d)
    assert await conn.scalar(select(func.count()).select_from(t.global_tasks)) == 0
    status = await conn.scalar(select(t.deliveries.c.status).where(t.deliveries.c.id == d))
    assert status == "pending"
    decision = (await conn.execute(select(t.jev_decisions))).one()
    assert (decision.label, decision.confidence, decision.fallback) == ("side_question", 1.0, False)


async def test_low_confidence_choice_falls_back_to_side_question(conn, make_harness, team):
    h = make_harness("jev:\n  - label: task\n    confidence: 0.4\n")
    _, d = await post_to_lead(h, team, "Việc gì đó")
    await h.jev.classify(d)
    assert await conn.scalar(select(func.count()).select_from(t.global_tasks)) == 0
    decision = (await conn.execute(select(t.jev_decisions))).one()
    assert (decision.label, decision.confidence, decision.fallback) == ("side_question", 0.4, False)


async def test_malformed_response_falls_back_to_side_question(conn, make_harness, team):
    h = make_harness(JEV)
    _, d = await post_to_lead(h, team, "Vì sao?")
    original = h.fake._decide
    h.fake._decide = lambda state: {"type": "choice"}  # missing choice/confidence
    await h.jev.classify(d)
    h.fake._decide = original
    decision = (await conn.execute(select(t.jev_decisions))).one()
    assert (decision.label, decision.fallback) == ("side_question", True)
    status = await conn.scalar(select(t.deliveries.c.status).where(t.deliveries.c.id == d))
    assert status == "pending"


async def test_unknown_label_and_model_errors_fall_back(conn, make_harness, team):
    from backend.harness.model import ModelUnavailable

    h = make_harness(JEV)
    _, d1 = await post_to_lead(h, team, "Vì sao 1")
    h.fake._decide = lambda state: {"type": "choice", "choice": "urgent", "confidence": 1.0}
    await h.jev.classify(d1)

    _, d2 = await post_to_lead(h, team, "Vì sao 2")

    async def down(*a, **kw):
        raise ModelUnavailable("503")

    h.model.decide = down
    await h.jev.classify(d2)
    labels = (
        await conn.execute(
            select(t.jev_decisions.c.label, t.jev_decisions.c.fallback).order_by(
                t.jev_decisions.c.id
            )
        )
    ).all()
    assert labels == [("side_question", True), ("side_question", True)]


async def test_timeout_falls_back(conn, make_harness, team):
    h = make_harness(JEV)
    h.jev.timeout_s = 0.05
    _, d = await post_to_lead(h, team, "Vì sao?")

    async def slow(*a, **kw):
        await asyncio.sleep(1)

    h.model.decide = slow
    await h.jev.classify(d)
    decision = (await conn.execute(select(t.jev_decisions))).one()
    assert (decision.label, decision.fallback) == ("side_question", True)


async def test_background_crash_is_retrieved_and_delivery_becomes_pending(conn, make_harness, team):
    h = make_harness(JEV)
    _, delivery_id = await post_to_lead(h, team, "Vì sao?")
    woken = []
    h.wake = woken.append

    async def crash(_delivery_id):
        raise RuntimeError("unexpected")

    h.jev.classify = crash
    type(h.jev).schedule(h.jev, delivery_id)  # post_to_lead disables automatic scheduling
    await h.jev.drain()
    status = await conn.scalar(
        select(t.deliveries.c.status).where(t.deliveries.c.id == delivery_id)
    )
    assert status == "pending"
    assert woken == [team.lead.id]


async def test_already_classified_deliveries_are_skipped(conn, make_harness, team):
    h = make_harness(JEV)
    _, d = await post_to_lead(h, team, "Vì sao?")
    await h.jev.classify(d)
    await h.jev.classify(d)
    assert await conn.scalar(select(func.count()).select_from(t.jev_decisions)) == 1


async def test_classification_is_serialized_per_lead_in_delivery_order(conn, make_harness, team):
    h = make_harness("""
    jev:
      - label: task
    """)
    ds = []
    for i in range(3):
        _, d = await post_to_lead(h, team, f"Việc {i}")
        ds.append(d)
    original = h.model.decide
    calls = []

    async def slow_first(*a, **kw):
        calls.append(kw.get("agent"))
        if len(calls) == 1:
            await asyncio.sleep(0.05)
        return await original(*a, **kw)

    h.model.decide = slow_first
    await asyncio.gather(*(h.jev.run(d) for d in ds))
    tasks = (
        (
            await conn.execute(
                select(t.global_tasks.c.source_message_id).order_by(t.global_tasks.c.id)
            )
        )
        .scalars()
        .all()
    )
    msgs = (
        (
            await conn.execute(
                select(t.deliveries.c.message_id)
                .where(t.deliveries.c.id.in_(ds))
                .order_by(t.deliveries.c.id)
            )
        )
        .scalars()
        .all()
    )
    assert tasks == msgs


async def test_context_has_state_summary_recent_messages_and_the_message(
    conn, rows, make_harness, team
):
    h = make_harness(JEV, JEV_K=2)
    await conn.execute(
        t.agent_epochs.update()
        .where(t.agent_epochs.c.agent_id == team.lead.id)
        .values(summary="Đã phân tích Q2.")
    )
    for text in ("cũ nhất", "giữa", "gần đây"):
        await post_to_lead(h, team, text)
    msg, _d = await post_to_lead(h, team, "Vì sao căn này?", attachments=["bang-gia.xlsx"])
    async with h.db() as c:
        lead = (await c.execute(select(t.agents).where(t.agents.c.id == team.lead.id))).one()
        message = (await c.execute(select(t.messages).where(t.messages.c.id == msg))).one()
        ctx = await build_jev_context(h, c, lead, message)
    assert ctx.startswith("<current_state>")
    assert "Đã phân tích Q2." in ctx
    assert "gần đây" in ctx and "giữa" in ctx and "cũ nhất" not in ctx  # K = 2
    assert ctx.rstrip().endswith("</message>")
    assert 'from="user:alice"' in ctx.split("<message")[-1]
    assert "bang-gia.xlsx" in ctx.split("<message")[-1]


# --- urgency (merged from Agent-A-ThanhTung): independent of the route ----------------------


def _router(**answers):
    from backend.harness.model import DecisionResponse

    async def decide(*args, **kwargs):
        return DecisionResponse(answers=answers, usage={})

    return decide


async def _decision(conn):
    return (await conn.execute(select(t.jev_decisions).order_by(t.jev_decisions.c.id))).all()


async def test_a_route_without_an_urgency_answer_keeps_the_route(conn, make_harness, team):
    """Regression: a router reply without `urgency` must not turn `task` into a fallback."""
    h = make_harness(JEV)
    _, d = await post_to_lead(h, team, "Vì sao căn MAS-U03832 bán chậm?")
    h.model.decide = _router(route={"choice": "task", "confidence": 1.0})
    await h.jev.classify(d)
    [decision] = await _decision(conn)
    assert (decision.label, decision.fallback, decision.urgency) == ("task", False, "normal")
    assert await conn.scalar(select(func.count()).select_from(t.global_tasks)) == 1


async def test_urgency_is_stored_and_an_unknown_level_counts_as_normal(conn, make_harness, team):
    h = make_harness(JEV)
    _, d1 = await post_to_lead(h, team, "cần gấp")
    h.model.decide = _router(
        route={"choice": "side_question", "confidence": 1.0}, urgency={"choice": "high"}
    )
    await h.jev.classify(d1)
    _, d2 = await post_to_lead(h, team, "không gấp")
    h.model.decide = _router(
        route={"choice": "side_question", "confidence": 1.0}, urgency={"choice": "urgent!"}
    )
    await h.jev.classify(d2)
    first, second = await _decision(conn)
    assert (first.label, first.fallback, first.urgency) == ("side_question", False, "high")
    assert (second.label, second.fallback, second.urgency) == ("side_question", False, "normal")
    urgency = dict((await conn.execute(select(t.deliveries.c.id, t.deliveries.c.urgency))).all())
    assert (urgency[d1], urgency[d2]) == ("high", "normal")


async def test_a_failed_route_still_falls_back_with_normal_urgency(conn, make_harness, team):
    h = make_harness(JEV)
    _, d = await post_to_lead(h, team, "Vì sao?")
    h.model.decide = _router(urgency={"choice": "high"})  # no `route`: routing fails
    await h.jev.classify(d)
    [decision] = await _decision(conn)
    assert (decision.label, decision.fallback, decision.urgency) == (
        "side_question",
        True,
        "normal",
    )


async def test_pending_deliveries_run_most_urgent_first(conn, make_harness, team):
    from backend.harness.items import pending_deliveries_work

    h = make_harness(JEV)
    ids = {}
    for level in ("low", "normal", "high"):
        _, ids[level] = await post_to_lead(h, team, f"tin {level}")
        await conn.execute(
            t.deliveries.update()
            .where(t.deliveries.c.id == ids[level])
            .values(status="pending", urgency=level)
        )
    work = await pending_deliveries_work(conn, team.lead)
    assert work.delivery_ids == [ids["high"], ids["normal"], ids["low"]]
