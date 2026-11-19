"""Input items (doc 06 "Input items"), readable thread ids, and the delivery work source.

```text
<notification id="d_981" from="user:alice" thread="direct:data" message="m_5521" at="10:02:05">
Lấy giúp bảng giá dự án 100.
attachments: files/inbox/m_5521/bang-gia.xlsx
</notification>
<notice id="d_990" kind="builder" at="10:05:00">Kỹ năng mới: xlsx</notice>
<routine name="bao-cao-sang" fired_at="08:00:00">…prompt…</routine>
<begin_task id="T42" source_message="m_5520" thread="direct:lead">…</begin_task>
```

Readable thread ids: `direct:<slug>`, `group:<thread_id>` (with `name="…"`), `agent:<slug>+<slug>`.
"""

from __future__ import annotations

import html
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import and_, case, select
from sqlalchemy.ext.asyncio import AsyncConnection

from backend.db import tables as t

TZ = ZoneInfo("Asia/Ho_Chi_Minh")


@dataclass
class Work:
    """One activation's worth of input (doc 03 "Activation")."""

    kind: str  # message | routine | compaction | task
    blocks: list[str]
    items: list[dict[str, Any]]
    delivery_ids: list[int] = field(default_factory=list)
    default_thread: str | None = None
    task_id: int | None = None
    model: str | None = None
    status_detail: str | None = None
    # A user-originated turn must end with a persisted response or a visible terminal failure.
    user_visible: bool = False
    # Direct chats require a terminal response; broadcast group members may intentionally stay
    # silent when another member handles the request.
    response_required: bool = False
    # Known protocol work (currently queued tasks) cannot be declared successful by plain text.
    requires_tools: bool = False
    # trace ids of the messages that triggered this activation (doc 13 `trigger_trace_ids`)
    trigger_trace_ids: list[str] = field(default_factory=list)
    # Called inside the transaction that appends the input event.
    on_start: Callable[[AsyncConnection, int], Awaitable[None]] | None = None
    # Called after the activation, with how it ended (done | final | step_limit | error).
    on_end: Callable[[str], Awaitable[None]] | None = None


def _attr(value: str) -> str:
    return html.escape(value, quote=True)


def _time(at: datetime) -> str:
    return at.astimezone(TZ).strftime("%H:%M:%S")


def notification(
    *,
    delivery_id: int,
    sender: str,
    thread: str,
    message_id: int,
    at: datetime,
    text: str,
    attachments: list[str] = (),
    thread_name: str | None = None,
    choice_id: str | None = None,
    reply_to: int | None = None,
    requested_agent: str | None = None,
) -> str:
    name = f' name="{_attr(thread_name)}"' if thread_name else ""
    head = (
        f'<notification id="d_{delivery_id}" from="{_attr(sender)}" thread="{_attr(thread)}"{name} '
        f'message="m_{message_id}" at="{_time(at)}">'
    )
    lines = [head, text or ""]
    if choice_id:
        lines.append(f"choice: {choice_id}")
    if reply_to:
        lines.append(f"reply_to: m_{reply_to}")
    if requested_agent:
        lines.append(requested_line(requested_agent))
    if attachments:
        lines.append("attachments: " + ", ".join(attachments))
    lines.append("</notification>")
    return "\n".join(lines)


def notice(*, delivery_id: int, kind: str, at: datetime, text: str) -> str:
    return f'<notice id="d_{delivery_id}" kind="{_attr(kind)}" at="{_time(at)}">{text}</notice>'


def routine(*, name: str, fired_at: datetime, prompt: str) -> str:
    return f'<routine name="{_attr(name)}" fired_at="{_time(fired_at)}">\n{prompt}\n</routine>'


def begin_task(
    *,
    task_id: int,
    source_message: int | None,
    thread: str | None,
    description: str,
    original: str | None,
    requested_agent: str | None = None,
) -> str:
    attrs = f'id="T{task_id}"'
    if source_message:
        attrs += f' source_message="m_{source_message}"'
    if thread:
        attrs += f' thread="{_attr(thread)}"'
    body = description
    if original:
        body += f"\n--- original message ---\n{original}"
    if requested_agent:
        body += "\n" + requested_line(requested_agent)
    return f"<begin_task {attrs}>\n{body}\n</begin_task>"


# --- readable thread ids --------------------------------------------------------------------


async def readable_thread(conn: AsyncConnection, thread_id: uuid.UUID) -> tuple[str, str | None]:
    row = (await conn.execute(select(t.threads).where(t.threads.c.id == thread_id))).one()
    return readable_from_row(row)


def readable_from_row(row: Any) -> tuple[str, str | None]:
    if row.kind == "group":
        return f"group:{row.id}", row.name
    return f"{row.kind}:{row.member_key}", None


async def resolve_thread(
    conn: AsyncConnection, user_id: uuid.UUID, ref: str | None
) -> uuid.UUID | None:
    """A readable id (or a raw thread uuid) → the user's thread id, or None."""
    if not ref:
        return None
    th = t.threads
    kind, _, rest = ref.partition(":")
    query = None
    if kind in ("direct", "agent") and rest:
        query = select(th.c.id).where(
            th.c.user_id == user_id, th.c.kind == kind, th.c.member_key == rest
        )
    else:
        raw = rest if kind == "group" else ref
        try:
            thread_uuid = uuid.UUID(raw)
        except ValueError:
            return None
        query = select(th.c.id).where(th.c.user_id == user_id, th.c.id == thread_uuid)
    return await conn.scalar(query)


async def sender_label(conn: AsyncConnection, sender_type: str, sender_id: Any) -> str:
    if sender_type == "user":
        name = await conn.scalar(select(t.users.c.username).where(t.users.c.id == sender_id))
        return f"user:{name}"
    if sender_type == "agent":
        slug = await conn.scalar(select(t.agents.c.slug).where(t.agents.c.id == sender_id))
        return f"agent:{slug}"
    return "system"


def inbox_path(message_id: int, filename: str) -> str:
    """Where a receiving agent finds a message's attachment (doc 04 `files/inbox/`)."""
    return f"files/inbox/m_{message_id}/{filename}"


# --- the delivery work source (doc 03 rule 1) -------------------------------------------------


def requested_line(slug: str) -> str:
    """The person @mentioned a teammate: the lead must hand the work to it, even a small ask."""
    return (
        f"requested_agent: {slug} (the person asked this teammate by name: first call "
        f"send_to_agent(['{slug}'], ...) with the request — this exact slug, no thread= — "
        "and end your turn; answer here once, after its reply arrives)"
    )


def requested_agent(content: dict, agent: Any) -> str | None:
    """The teammate a person @mentioned in a group request, for the lead to delegate to (the
    message API resolved it in the lead's own team); None when the mention is the lead itself."""
    slug = ((content or {}).get("mention") or {}).get("slug")
    return slug if slug and slug != agent.slug else None


async def running_task_thread(conn: AsyncConnection, user_id: Any) -> str | None:
    """The readable id of the thread the owner's running task was asked in, if any."""
    g, m = t.global_tasks, t.messages
    thread_id = await conn.scalar(
        select(m.c.thread_id)
        .select_from(g.join(m, m.c.id == g.c.source_message_id))
        .where(g.c.user_id == user_id, g.c.status == "running")
    )
    return None if thread_id is None else (await readable_thread(conn, thread_id))[0]


async def pending_deliveries_work(conn: AsyncConnection, agent: Any) -> Work | None:
    d, m = t.deliveries, t.messages
    rows = (
        await conn.execute(
            select(
                d,
                m.c.thread_id,
                m.c.sender_type,
                m.c.sender_id,
                m.c.content,
                m.c.created_at.label("message_at"),
                m.c.trace_id.label("message_trace"),
            )
            .select_from(d.outerjoin(m, d.c.message_id == m.c.id))
            .where(d.c.agent_id == agent.id, d.c.status == "pending")
            .order_by(case({"high": 0, "normal": 1, "low": 2}, value=d.c.urgency, else_=1), d.c.id)
        )
    ).all()
    if not rows:
        return None
    blocks, items, ids, triggers = [], [], [], []
    default_thread = None
    user_visible = False
    response_required = False
    for r in rows:
        ids.append(r.id)
        if r.message_id is None:
            kind = (r.notice or {}).get("kind", "notice")
            blocks.append(
                notice(
                    delivery_id=r.id,
                    kind=kind,
                    at=r.created_at,
                    text=(r.notice or {}).get("text", ""),
                )
            )
            items.append({"type": "notice", "delivery_id": r.id, "kind": kind})
            continue
        thread_row = (
            await conn.execute(select(t.threads).where(t.threads.c.id == r.thread_id))
        ).one()
        thread_ref, thread_name = readable_from_row(thread_row)
        files = (
            (
                await conn.execute(
                    select(t.attachments.c.filename)
                    .where(t.attachments.c.message_id == r.message_id)
                    .order_by(t.attachments.c.filename)
                )
            )
            .scalars()
            .all()
        )
        content = r.content or {}
        blocks.append(
            notification(
                delivery_id=r.id,
                sender=await sender_label(conn, r.sender_type, r.sender_id),
                thread=thread_ref,
                thread_name=thread_name,
                message_id=r.message_id,
                at=r.message_at,
                text=content.get("text") or "",
                attachments=[inbox_path(r.message_id, f) for f in files],
                choice_id=content.get("choice_id"),
                reply_to=content.get("reply_to"),
                requested_agent=requested_agent(content, agent),
            )
        )
        items.append({"type": "notification", "delivery_id": r.id, "message_id": r.message_id})
        if r.message_trace and r.message_trace not in triggers:
            triggers.append(r.message_trace)
        if r.sender_type == "user":
            default_thread = thread_ref
            user_visible = True
            response_required = (
                response_required or thread_row.kind == "direct" or content.get("target") == "lead"
            )
    if default_thread is None and agent.is_lead:
        # Teammates' replies during a task: the lead answers where the task was asked (a group
        # room, say), not in its own direct thread, which a group's people never see.
        default_thread = await running_task_thread(conn, agent.user_id)
    if default_thread is None:
        default_thread = f"direct:{agent.slug}"
    return Work(
        kind="message",
        blocks=blocks,
        items=items,
        delivery_ids=ids,
        default_thread=default_thread,
        user_visible=user_visible,
        response_required=response_required,
        trigger_trace_ids=triggers,
    )


async def consume(conn: AsyncConnection, delivery_ids: list[int], seq: int) -> None:
    if delivery_ids:
        await conn.execute(
            t.deliveries.update()
            .where(and_(t.deliveries.c.id.in_(delivery_ids), t.deliveries.c.status == "pending"))
            .values(status="consumed", consumed_seq=seq)
        )
