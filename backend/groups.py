"""Group lifecycle and membership for human users.

The group room, technical owner, and provisioning job are created together. Room messaging is
handled separately.
"""

from __future__ import annotations

import secrets
import uuid
from typing import Any

from sqlalchemy import delete, exists, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection

from backend.agents import builder, folders, jobs, provisioning
from backend.api.errors import ApiError
from backend.auth.principal import CurrentUser
from backend.db import tables as t
from backend.db.session import on_commit


def _changed(h: Any, conn: AsyncConnection, group_id: uuid.UUID, user_ids: set[uuid.UUID]) -> None:
    if h is None:
        return
    for user_id in user_ids:
        on_commit(
            conn,
            lambda user_id=user_id: h.bus.publish(
                user_id, "groups.changed", {"group_id": str(group_id)}
            ),
        )


async def room_of(conn: AsyncConnection, group: Any) -> Any:
    return (
        await conn.execute(
            select(t.threads).where(
                t.threads.c.user_id == group.technical_owner_id,
                t.threads.c.kind == "group",
            )
        )
    ).one()


async def _view(conn: AsyncConnection, group: Any) -> dict:
    u, gm = t.users, t.group_members
    owner = (
        await conn.execute(
            select(u.c.status, u.c.status_detail).where(u.c.id == group.technical_owner_id)
        )
    ).one()
    members = (
        await conn.execute(
            select(u.c.id, u.c.username, u.c.display_name)
            .select_from(gm.join(u, gm.c.user_id == u.c.id))
            .where(gm.c.group_id == group.id)
            .order_by(u.c.username)
        )
    ).all()
    room = await room_of(conn, group)
    lead_attached = await conn.scalar(
        select(
            exists().where(
                t.agents.c.user_id == group.technical_owner_id,
                t.agents.c.is_lead.is_(True),
                t.agents.c.state == "active",
                t.thread_members.c.thread_id == room.id,
                t.thread_members.c.member_type == "agent",
                t.thread_members.c.member_id == t.agents.c.id,
            )
        )
    )
    return {
        "id": str(group.id),
        "name": group.name,
        "status": owner.status,
        "status_detail": "Tạo nhóm agent thất bại. Hãy thử lại."
        if owner.status == "failed"
        else None,
        "ai_available": owner.status == "active" and bool(lead_attached),
        "room_thread_id": str(room.id),
        "created_by": str(group.created_by_user_id),
        "created_at": group.created_at.isoformat(),
        "members": [
            {"id": str(m.id), "username": m.username, "display_name": m.display_name}
            for m in members
        ],
    }


async def require_member(
    conn: AsyncConnection, group_id: uuid.UUID, human_user_id: uuid.UUID, *, lock: bool = False
) -> Any:
    """Return a group only for a current member; hide existence from everyone else."""
    g, gm = t.groups, t.group_members
    query = (
        select(g)
        .join(gm, gm.c.group_id == g.c.id)
        .where(g.c.id == group_id, gm.c.user_id == human_user_id)
    )
    if lock:
        query = query.with_for_update(of=g)
    group = (await conn.execute(query)).one_or_none()
    if group is None:
        raise ApiError(404, "not_found")
    return group


def member_group_owners(human_user_id: uuid.UUID):
    """Service owners of groups in which this human is currently a member."""
    return (
        select(t.groups.c.technical_owner_id)
        .join(t.group_members, t.group_members.c.group_id == t.groups.c.id)
        .where(t.group_members.c.user_id == human_user_id)
    )


async def is_current_member(
    conn: AsyncConnection, technical_owner_id: uuid.UUID, human_user_id: uuid.UUID
) -> bool:
    return bool(
        await conn.scalar(
            select(
                exists().where(
                    t.groups.c.technical_owner_id == technical_owner_id,
                    t.group_members.c.group_id == t.groups.c.id,
                    t.group_members.c.user_id == human_user_id,
                )
            )
        )
    )


async def create_group(
    h: Any, conn: AsyncConnection, creator: CurrentUser, name: str
) -> tuple[dict, uuid.UUID]:
    name = name.strip()
    if not 1 <= len(name) <= 100:
        raise ApiError(400, "invalid_request")
    owner_id = await conn.scalar(
        t.users.insert()
        .values(
            username="svc." + secrets.token_hex(8),
            password_hash="!service-account-no-login",
            display_name=name,
            role="user",
            account_type="service",
            domain_id=creator.domain_id,
            status="provisioning",
        )
        .returning(t.users.c.id)
    )
    group_id = await conn.scalar(
        t.groups.insert()
        .values(technical_owner_id=owner_id, name=name, created_by_user_id=creator.id)
        .returning(t.groups.c.id)
    )
    await conn.execute(t.group_members.insert().values(group_id=group_id, user_id=creator.id))
    room_id = await conn.scalar(
        t.threads.insert()
        .values(user_id=owner_id, kind="group", name=name)
        .returning(t.threads.c.id)
    )
    await conn.execute(
        t.thread_members.insert().values(
            thread_id=room_id, member_type="user", member_id=creator.id
        )
    )
    job_id = await jobs.enqueue(
        h,
        conn,
        user_id=owner_id,
        kind="user_provision",
        request={"domain_id": creator.domain_id},
    )
    _changed(h, conn, group_id, {creator.id})
    return await group_detail(conn, group_id, creator.id), job_id


async def attach_lead_to_room(conn: AsyncConnection, technical_owner_id: uuid.UUID) -> None:
    """Final provisioning step; no-op for ordinary human accounts."""
    group = (
        await conn.execute(
            select(t.groups).where(t.groups.c.technical_owner_id == technical_owner_id)
        )
    ).one_or_none()
    if group is None:
        return
    lead_id = await conn.scalar(
        select(t.agents.c.id).where(
            t.agents.c.user_id == technical_owner_id,
            t.agents.c.is_lead.is_(True),
            t.agents.c.state == "active",
        )
    )
    if lead_id is None:
        raise RuntimeError("group Lead is missing after provisioning")
    room = await room_of(conn, group)
    await conn.execute(
        pg_insert(t.thread_members)
        .values(thread_id=room.id, member_type="agent", member_id=lead_id)
        .on_conflict_do_nothing(index_elements=["thread_id", "member_type", "member_id"])
    )


async def provisioning_status(
    conn: AsyncConnection, group_id: uuid.UUID, human_user_id: uuid.UUID
) -> dict:
    group = await require_member(conn, group_id, human_user_id)
    owner = (
        await conn.execute(select(t.users).where(t.users.c.id == group.technical_owner_id))
    ).one()
    detail = (
        await provisioning.progress(conn, [owner], include_finished=True, include_agents=True)
    )[owner.id]
    # status_detail can contain raw exec output. Group members only receive a safe failure hint.
    return {
        "status": owner.status,
        "status_detail": "Tạo nhóm agent thất bại. Hãy thử lại."
        if owner.status == "failed"
        else None,
        "job_status": detail["job_status"],
        "done": detail["done"],
        "total": detail["total"],
        "agents": detail["agents"],
    }


async def list_groups(conn: AsyncConnection, human_user_id: uuid.UUID) -> list[dict]:
    g, gm = t.groups, t.group_members
    rows = (
        await conn.execute(
            select(g)
            .join(gm, gm.c.group_id == g.c.id)
            .where(gm.c.user_id == human_user_id)
            .order_by(g.c.created_at.desc(), g.c.id)
        )
    ).all()
    return [await _view(conn, group) for group in rows]


async def group_detail(
    conn: AsyncConnection, group_id: uuid.UUID, human_user_id: uuid.UUID
) -> dict:
    return await _view(conn, await require_member(conn, group_id, human_user_id))


async def _member_ids(conn: AsyncConnection, group_id: uuid.UUID) -> set[uuid.UUID]:
    return set(
        (
            await conn.execute(
                select(t.group_members.c.user_id).where(t.group_members.c.group_id == group_id)
            )
        ).scalars()
    )


async def add_member(
    h: Any, conn: AsyncConnection, group_id: uuid.UUID, actor_id: uuid.UUID, user_id: uuid.UUID
) -> dict:
    group = await require_member(conn, group_id, actor_id, lock=True)
    u = t.users
    valid = await conn.scalar(
        select(u.c.id).where(
            u.c.id == user_id,
            u.c.account_type == "human",
            u.c.role == "user",
            u.c.status == "active",
        )
    )
    if valid is None:
        raise ApiError(404, "user_not_found")
    members = await _member_ids(conn, group_id)
    if user_id in members:
        raise ApiError(409, "already_member")
    await conn.execute(t.group_members.insert().values(group_id=group_id, user_id=user_id))
    room = await room_of(conn, group)
    await conn.execute(
        t.thread_members.insert().values(thread_id=room.id, member_type="user", member_id=user_id)
    )
    _changed(h, conn, group_id, members | {user_id})
    return await _view(conn, group)


async def remove_member(
    h: Any, conn: AsyncConnection, group_id: uuid.UUID, actor_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    group = await require_member(conn, group_id, actor_id, lock=True)
    members = await _member_ids(conn, group_id)
    if user_id not in members:
        raise ApiError(404, "not_found")
    if len(members) == 1:
        raise ApiError(409, "last_member")
    room = await room_of(conn, group)
    await conn.execute(
        delete(t.group_members).where(
            t.group_members.c.group_id == group_id, t.group_members.c.user_id == user_id
        )
    )
    await conn.execute(
        delete(t.thread_members).where(
            t.thread_members.c.thread_id == room.id,
            t.thread_members.c.member_type == "user",
            t.thread_members.c.member_id == user_id,
        )
    )
    _changed(h, conn, group_id, members)


async def member_candidates(conn: AsyncConnection, query: str) -> list[dict]:
    u = t.users
    query = query.strip()
    # Escape LIKE metacharacters so a search term cannot widen the candidate list.
    term = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    rows = (
        await conn.execute(
            select(u.c.id, u.c.username, u.c.display_name)
            .where(
                u.c.account_type == "human",
                u.c.role == "user",
                u.c.status == "active",
                or_(
                    u.c.username.ilike(f"{term}%", escape="\\"),
                    u.c.display_name.ilike(f"%{term}%", escape="\\"),
                ),
            )
            .order_by(u.c.username)
            .limit(20)
        )
    ).all()
    return [
        {"id": str(row.id), "username": row.username, "display_name": row.display_name}
        for row in rows
    ]


async def add_agent(
    h: Any,
    conn: AsyncConnection,
    settings: Any,
    group_id: uuid.UUID,
    actor: CurrentUser,
    agent_id: uuid.UUID,
) -> uuid.UUID:
    """Give the group its own copy of one of the actor's personal agents; returns the job id.

    Only the definition is copied (name, avatar, description, current prompt, attached credential
    set names): the copy is a new agent of the group's technical owner, with its own folder and
    no chat history, provisioned by the usual `agent_create` job. The personal agent is never
    shared. Like every group worker it stays out of the room; people reach it through the lead
    (`@mention`)."""
    from backend.api.catalog import domain_credential_sets

    group = await require_member(conn, group_id, actor.id, lock=True)
    a, u = t.agents, t.users
    source = (
        await conn.execute(
            select(a).where(
                a.c.id == agent_id,
                a.c.user_id == actor.id,
                a.c.state == "active",
                a.c.is_lead.is_(False),
            )
        )
    ).one_or_none()
    if source is None:
        raise ApiError(404, "not_found")
    owner = (await conn.execute(select(u).where(u.c.id == group.technical_owner_id))).one()
    if owner.status != "active":
        raise ApiError(409, "group_ai_unavailable")
    if await conn.scalar(
        select(exists().where(a.c.user_id == owner.id, a.c.slug == source.slug))
    ) or await jobs.active_job(conn, owner.id, "agent_create", "slug", source.slug):
        raise ApiError(409, "slug_taken")
    count = await conn.scalar(
        select(func.count()).select_from(a).where(a.c.user_id == owner.id, a.c.state == "active")
    )
    if count >= settings.MAX_AGENTS_PER_USER:
        raise ApiError(409, "agent_limit")
    folder = folders.folder_of(settings, source)
    sets = [x["set"] for x in builder.attached_sets(folder)]
    available = {x["set"] for x in await domain_credential_sets(conn, owner.domain_id)}
    if not set(sets) <= available:
        # the group's domain has no such credential set: the copy could not reach its data
        raise ApiError(409, "agent_incompatible")
    return await jobs.enqueue(
        h,
        conn,
        user_id=owner.id,
        kind="agent_create",
        request={
            "slug": source.slug,
            "display_name": source.display_name,
            "avatar": source.avatar,
            "description": source.description,
            "prompt": builder.read_prompt(folder),
            "presets": [],
            "credentials": sets,
            "origin": "custom",
            "author": builder.author_of(actor.username),
        },
    )


async def team_changed(h: Any, conn: AsyncConnection, technical_owner_id: uuid.UUID) -> None:
    """After a group's team changed (an agent was added): tell its members. No-op for people."""
    group_id = await conn.scalar(
        select(t.groups.c.id).where(t.groups.c.technical_owner_id == technical_owner_id)
    )
    if group_id is not None:
        _changed(h, conn, group_id, await _member_ids(conn, group_id))
