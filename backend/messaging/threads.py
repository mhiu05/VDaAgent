"""Threads (doc 08 "Threads"): views, groups, and `agent` threads found by `member_key`."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncConnection

from backend.api.errors import ApiError
from backend.db import tables as t
from backend.messaging.messages import message_view


async def members_view(conn: AsyncConnection, thread_id: uuid.UUID) -> list[dict]:
    tm, a, u = t.thread_members, t.agents, t.users
    rows = (await conn.execute(select(tm).where(tm.c.thread_id == thread_id))).all()
    out = []
    for r in rows:
        if r.member_type == "user":
            user = (
                await conn.execute(
                    select(u.c.username, u.c.display_name).where(u.c.id == r.member_id)
                )
            ).one()
            out.append(
                {
                    "type": "user",
                    "id": str(r.member_id),
                    "display_name": user.display_name or user.username,
                    "avatar": None,
                }
            )
        else:
            agent = (
                await conn.execute(
                    select(a.c.slug, a.c.display_name, a.c.avatar, a.c.is_lead).where(
                        a.c.id == r.member_id
                    )
                )
            ).one()
            out.append(
                {
                    "type": "agent",
                    "id": str(r.member_id),
                    "slug": agent.slug,
                    "display_name": agent.display_name,
                    "avatar": agent.avatar,
                    "is_lead": agent.is_lead,
                }
            )
    out.sort(key=lambda m: (m["type"] != "user", not m.get("is_lead", False), m.get("slug", "")))
    return out


async def thread_view(conn: AsyncConnection, thread: Any, user_id: uuid.UUID) -> dict:
    m, tm = t.messages, t.thread_members
    last_id = await conn.scalar(select(func.max(m.c.id)).where(m.c.thread_id == thread.id))
    read_mark = await conn.scalar(
        select(tm.c.last_read_message_id).where(
            tm.c.thread_id == thread.id, tm.c.member_type == "user", tm.c.member_id == user_id
        )
    )
    unread = await conn.scalar(
        select(func.count())
        .select_from(m)
        .where(
            m.c.thread_id == thread.id,
            m.c.id > (read_mark or 0),
            ~and_(m.c.sender_type == "user", m.c.sender_id == user_id),
        )
    )
    group = (
        (
            await conn.execute(
                select(t.groups.c.id, t.groups.c.name, t.users.c.status)
                .select_from(t.groups.join(t.users, t.groups.c.technical_owner_id == t.users.c.id))
                .where(t.groups.c.technical_owner_id == thread.user_id)
            )
        ).one_or_none()
        if thread.kind == "group"
        else None
    )
    return {
        "id": str(thread.id),
        "kind": thread.kind,
        "name": thread.name,
        "members": await members_view(conn, thread.id),
        "last_message": await message_view(conn, last_id) if last_id else None,
        "unread": unread,
        "read_only": thread.read_only,
        "last_message_at": thread.last_message_at.isoformat(),
        "group": {"id": str(group.id), "name": group.name, "status": group.status}
        if group
        else None,
    }


async def user_thread(conn: AsyncConnection, thread_id: Any, user_id: uuid.UUID) -> Any:
    """A direct or group thread the user is a member of, else 404."""
    try:
        tid = thread_id if isinstance(thread_id, uuid.UUID) else uuid.UUID(str(thread_id))
    except ValueError:
        raise ApiError(404, "not_found") from None
    th, tm = t.threads, t.thread_members
    row = (
        await conn.execute(
            select(th).where(
                th.c.id == tid,
                th.c.user_id == user_id,
                th.c.kind.in_(("direct", "group")),
                select(tm.c.thread_id)
                .where(
                    tm.c.thread_id == th.c.id, tm.c.member_type == "user", tm.c.member_id == user_id
                )
                .exists(),
            )
        )
    ).one_or_none()
    if row is None:
        raise ApiError(404, "not_found")
    return row


def current_group_room_clause(thread: Any, user_id: uuid.UUID) -> Any:
    """A room of a group where the human is currently a member."""
    g, gm = t.groups, t.group_members
    return and_(
        thread.c.kind == "group",
        select(g.c.id)
        .join(gm, gm.c.group_id == g.c.id)
        .where(g.c.technical_owner_id == thread.c.user_id, gm.c.user_id == user_id)
        .exists(),
    )


async def member_thread(conn: AsyncConnection, thread_id: Any, user_id: uuid.UUID) -> Any:
    """A personal thread or current group room, always with the human in thread_members."""
    try:
        tid = thread_id if isinstance(thread_id, uuid.UUID) else uuid.UUID(str(thread_id))
    except ValueError:
        raise ApiError(404, "not_found") from None
    th, tm = t.threads, t.thread_members
    row = (
        await conn.execute(
            select(th).where(
                th.c.id == tid,
                th.c.kind.in_(("direct", "group")),
                select(tm.c.thread_id)
                .where(
                    tm.c.thread_id == th.c.id, tm.c.member_type == "user", tm.c.member_id == user_id
                )
                .exists(),
                or_(th.c.user_id == user_id, current_group_room_clause(th, user_id)),
            )
        )
    ).one_or_none()
    if row is None:
        raise ApiError(404, "not_found")
    return row


async def users_agents(conn: AsyncConnection, user_id: uuid.UUID, ids: list[str]) -> list[Any]:
    try:
        wanted = [uuid.UUID(str(i)) for i in ids]
    except ValueError:
        raise ApiError(400, "invalid_request") from None
    rows = (
        await conn.execute(
            select(t.agents).where(
                t.agents.c.id.in_(wanted),
                t.agents.c.user_id == user_id,
                t.agents.c.state == "active",
            )
        )
    ).all()
    if len(rows) != len(set(wanted)):
        raise ApiError(400, "invalid_request", "Agent không thuộc nhóm của bạn.")
    return rows


async def agent_ids_of(conn: AsyncConnection, thread_id: uuid.UUID) -> set[uuid.UUID]:
    tm = t.thread_members
    return set(
        (
            await conn.execute(
                select(tm.c.member_id).where(
                    tm.c.thread_id == thread_id, tm.c.member_type == "agent"
                )
            )
        )
        .scalars()
        .all()
    )


async def agent_thread(conn: AsyncConnection, user_id: uuid.UUID, agents: list[Any]) -> uuid.UUID:
    """The `agent` thread for exactly these agents, created on first use."""
    key = "+".join(sorted(a.slug for a in agents))
    th = t.threads
    existing = await conn.scalar(
        select(th.c.id).where(th.c.user_id == user_id, th.c.kind == "agent", th.c.member_key == key)
    )
    if existing is not None:
        return existing
    thread_id = await conn.scalar(
        th.insert().values(user_id=user_id, kind="agent", member_key=key).returning(th.c.id)
    )
    await conn.execute(
        t.thread_members.insert(),
        [{"thread_id": thread_id, "member_type": "agent", "member_id": a.id} for a in agents],
    )
    return thread_id
