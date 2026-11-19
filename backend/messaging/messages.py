"""Posting messages (doc 07 "Deliveries", doc 08 "Threads").

One rule for every thread kind: a message reaches every member except the sender. Each
receiving agent gets one `deliveries` row in the message's transaction: the lead's copy has
`route='jev'` and `status='classifying'`, everyone else's is a pending notification. While the
user has a running task, the agent sender and every agent receiver are recorded in
`task_involvement`. After commit: `message.created` for the user, wakes for notification
receivers, and jev for the lead's copy.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import and_, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection

from backend.db import tables as t
from backend.db.session import on_commit

SYSTEM_SENDER = {"type": "system", "id": None, "display_name": "Hệ thống", "avatar": None}

# `content.audience` of a `send_to_agent` message: addressed to agents, even when it is posted
# into a group the user can read, so it never answers the user's turn.
AGENT_AUDIENCE = "agents"


def user_reply_clause(*, thread_id: uuid.UUID, agent_id: uuid.UUID, trace_id: str) -> Any:
    """Messages that answer a user turn: this agent's, in that user-facing thread, this trace,
    and not addressed to agents."""
    m = t.messages.c
    return and_(
        m.thread_id == thread_id,
        m.sender_type == "agent",
        m.sender_id == agent_id,
        m.trace_id == trace_id,
        m.content["audience"].astext.is_distinct_from(AGENT_AUDIENCE),
    )


async def thread_agents(conn: AsyncConnection, thread_id: uuid.UUID) -> list[Any]:
    tm, a = t.thread_members, t.agents
    return (
        await conn.execute(
            select(a)
            .select_from(tm.join(a, tm.c.member_id == a.c.id))
            .where(tm.c.thread_id == thread_id, tm.c.member_type == "agent", a.c.state == "active")
            .order_by(a.c.slug)
        )
    ).all()


async def running_task(conn: AsyncConnection, user_id: uuid.UUID) -> int | None:
    g = t.global_tasks
    return await conn.scalar(select(g.c.id).where(g.c.user_id == user_id, g.c.status == "running"))


async def involve(conn: AsyncConnection, task_id: int, agent_ids: list[uuid.UUID]) -> None:
    if agent_ids:
        await conn.execute(
            pg_insert(t.task_involvement)
            .values([{"task_id": task_id, "agent_id": a} for a in agent_ids])
            .on_conflict_do_nothing()
        )


async def post_message(
    harness: Any,
    conn: AsyncConnection,
    *,
    thread_id: uuid.UUID,
    sender_type: str,
    sender_id: uuid.UUID | None,
    content: dict[str, Any],
    trace_id: str | None = None,
    exec_id: str | None = None,
    before_deliveries: Any = None,
    deliver_to: set[uuid.UUID] | None = None,
) -> int:
    """Insert the message and its deliveries; returns the message id.

    `before_deliveries(message_id, receivers)` runs after the message row exists and before any
    delivery is inserted (attachments are stored and copied there, doc 08).
    """
    message_id = await conn.scalar(
        t.messages.insert()
        .values(
            thread_id=thread_id,
            sender_type=sender_type,
            sender_id=sender_id,
            content=content,
            trace_id=trace_id,
            exec_id=exec_id,
        )
        .returning(t.messages.c.id)
    )
    thread = (await conn.execute(select(t.threads).where(t.threads.c.id == thread_id))).one()
    await conn.execute(
        update(t.threads).where(t.threads.c.id == thread_id).values(last_message_at=func.now())
    )
    receivers = [
        a
        for a in await thread_agents(conn, thread_id)
        if not (sender_type == "agent" and a.id == sender_id)
        and (deliver_to is None or a.id in deliver_to)
    ]
    if before_deliveries is not None:
        await before_deliveries(message_id, receivers)

    jev_ids, woken = [], []
    for agent in receivers:
        route, status = ("jev", "classifying") if agent.is_lead else ("notification", "pending")
        delivery_id = await conn.scalar(
            t.deliveries.insert()
            .values(agent_id=agent.id, message_id=message_id, route=route, status=status)
            .returning(t.deliveries.c.id)
        )
        (jev_ids if route == "jev" else woken).append(delivery_id if route == "jev" else agent.id)

    task_id = await running_task(conn, thread.user_id)
    if task_id is not None:
        involved = [a.id for a in receivers]
        if sender_type == "agent":
            involved.append(sender_id)
        await involve(conn, task_id, involved)

    view = await message_view(conn, message_id)
    on_commit(conn, lambda: harness.bus.publish(thread.user_id, "message.created", view))
    if thread.kind == "group":
        on_commit(conn, lambda: harness.bus.publish_group(thread.user_id, "message.created", view))
    for agent_id in woken:
        on_commit(conn, lambda a=agent_id: harness.wake(a))
    for delivery_id in jev_ids:
        on_commit(conn, lambda d=delivery_id: harness.jev.schedule(d))
    return message_id


async def post_agent_text(
    harness: Any,
    conn: AsyncConnection,
    *,
    agent: Any,
    thread_ref: str,
    text: str,
    trace_id: str,
) -> int:
    """Runtime finalization for a semantic text answer.

    This intentionally converges on ``post_message``, the same persistence, delivery and SSE
    path used by ``/internal/v1/send_to_user``.  It is limited to user-visible threads and
    verifies membership so a model response cannot choose its own transport destination.
    """
    from backend.harness.items import resolve_thread
    from backend.messaging.threads import agent_ids_of

    thread_id = await resolve_thread(conn, agent.user_id, thread_ref)
    if thread_id is None:
        raise ValueError("invalid_thread")
    thread = (await conn.execute(select(t.threads).where(t.threads.c.id == thread_id))).one()
    if thread.kind == "agent" or thread.read_only:
        raise ValueError("thread_not_writable")
    if agent.id not in await agent_ids_of(conn, thread_id):
        raise ValueError("agent_not_in_thread")
    return await post_message(
        harness,
        conn,
        thread_id=thread_id,
        sender_type="agent",
        sender_id=agent.id,
        content={"text": text},
        trace_id=trace_id,
    )


async def sender_view(conn: AsyncConnection, sender_type: str, sender_id: Any) -> dict:
    if sender_type == "user":
        u = (
            await conn.execute(
                select(t.users.c.username, t.users.c.display_name).where(t.users.c.id == sender_id)
            )
        ).one()
        return {
            "type": "user",
            "id": str(sender_id),
            "display_name": u.display_name or u.username,
            "avatar": None,
        }
    if sender_type == "agent":
        a = (
            await conn.execute(
                select(t.agents.c.slug, t.agents.c.display_name, t.agents.c.avatar).where(
                    t.agents.c.id == sender_id
                )
            )
        ).one()
        return {
            "type": "agent",
            "id": str(sender_id),
            "slug": a.slug,
            "display_name": a.display_name,
            "avatar": a.avatar,
        }
    return dict(SYSTEM_SENDER)


async def message_view(conn: AsyncConnection, message_id: int) -> dict:
    """`Message` of doc 15."""
    m = (await conn.execute(select(t.messages).where(t.messages.c.id == message_id))).one()
    files = (
        await conn.execute(
            select(
                t.attachments.c.id,
                t.attachments.c.filename,
                t.attachments.c.mime,
                t.attachments.c.size,
            )
            .where(t.attachments.c.message_id == message_id)
            .order_by(t.attachments.c.filename)
        )
    ).all()
    content = m.content or {}
    return {
        "id": m.id,
        "thread_id": str(m.thread_id),
        "sender": await sender_view(conn, m.sender_type, m.sender_id),
        "text": content.get("text"),
        "choices": content.get("choices"),
        "target": content.get("target"),
        "mention": content.get("mention"),
        "reply_to": content.get("reply_to"),
        "choice_id": content.get("choice_id"),
        "attachments": [
            {"id": str(f.id), "filename": f.filename, "mime": f.mime, "size": f.size} for f in files
        ],
        "report_refs": content.get("report_refs") or [],
        "created_at": m.created_at.isoformat(),
    }
