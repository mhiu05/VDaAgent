"""`/api/threads*` and `/api/attachments/{id}` (doc 15 "Threads and messages", doc 08).

`Thread = {id, kind, name, members: [{type, id, slug?, display_name, avatar}], last_message,
unread, read_only, last_message_at}`. Users see their `direct` and `group` threads; `agent`
threads are admin-only (doc 08 "Visibility").
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, Form, Request, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import delete, func, or_, select, update

from backend.api.deps import AnyUser, Conn, UserRole, check_domain_available
from backend.api.errors import ApiError
from backend.db import tables as t
from backend.db.session import on_commit
from backend.messaging import attachments
from backend.messaging.messages import message_view, post_message
from backend.messaging.threads import (
    agent_ids_of,
    current_group_room_clause,
    member_thread,
    thread_view,
    user_thread,
    users_agents,
)

router = APIRouter(tags=["threads"])
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class CreateGroup(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Name
    agent_ids: list[str] = Field(min_length=2, max_length=20)


class PatchGroup(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Name | None = None
    add_agent_ids: list[str] = Field(default_factory=list)
    remove_agent_ids: list[str] = Field(default_factory=list)


class ReadMark(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message_id: int


def _publish_thread(request: Request, conn, user_id, view: dict) -> None:
    harness = request.app.state.harness
    if harness is not None:
        on_commit(conn, lambda: harness.bus.publish(user_id, "thread.updated", view))


@router.get("/threads")
async def list_threads(conn: Conn, user: UserRole) -> list[dict]:
    th, tm = t.threads, t.thread_members
    rows = (
        await conn.execute(
            select(th)
            .where(
                th.c.kind.in_(("direct", "group")),
                or_(th.c.user_id == user.id, current_group_room_clause(th, user.id)),
                select(tm.c.thread_id)
                .where(
                    tm.c.thread_id == th.c.id, tm.c.member_type == "user", tm.c.member_id == user.id
                )
                .exists(),
            )
            .order_by(th.c.last_message_at.desc(), th.c.id)
        )
    ).all()
    return [await thread_view(conn, r, user.id) for r in rows]


@router.post("/threads", status_code=201)
async def create_group(body: CreateGroup, request: Request, conn: Conn, user: UserRole) -> dict:
    agents = await users_agents(conn, user.id, body.agent_ids)
    if len(agents) < 2:
        raise ApiError(400, "invalid_request", "Nhóm cần ít nhất hai agent.")
    thread_id = await conn.scalar(
        t.threads.insert()
        .values(user_id=user.id, kind="group", name=body.name)
        .returning(t.threads.c.id)
    )
    await conn.execute(
        t.thread_members.insert(),
        [
            {"thread_id": thread_id, "member_type": "user", "member_id": user.id},
            *({"thread_id": thread_id, "member_type": "agent", "member_id": a.id} for a in agents),
        ],
    )
    row = (await conn.execute(select(t.threads).where(t.threads.c.id == thread_id))).one()
    view = await thread_view(conn, row, user.id)
    _publish_thread(request, conn, user.id, view)
    return view


@router.patch("/threads/{thread_id}")
async def patch_group(
    thread_id: str, body: PatchGroup, request: Request, conn: Conn, user: UserRole
) -> dict:
    accessible = await member_thread(conn, thread_id, user.id)
    if accessible.user_id != user.id:
        raise ApiError(409, "group_room_managed")
    thread = await user_thread(conn, thread_id, user.id)
    if thread.kind != "group":
        raise ApiError(400, "invalid_request", "Chỉ sửa được nhóm.")
    tm = t.thread_members
    if body.name is not None:
        await conn.execute(
            update(t.threads).where(t.threads.c.id == thread.id).values(name=body.name)
        )
    current = await agent_ids_of(conn, thread.id)
    add = {a.id for a in await users_agents(conn, user.id, body.add_agent_ids)} - current
    remove = {a.id for a in await users_agents(conn, user.id, body.remove_agent_ids)} & current
    if len((current | add) - remove) < 2:
        raise ApiError(400, "invalid_request", "Nhóm cần ít nhất hai agent.")
    if add:
        await conn.execute(
            tm.insert(),
            [{"thread_id": thread.id, "member_type": "agent", "member_id": a} for a in add],
        )
    if remove:
        await conn.execute(
            delete(tm).where(
                tm.c.thread_id == thread.id, tm.c.member_type == "agent", tm.c.member_id.in_(remove)
            )
        )
    row = (await conn.execute(select(t.threads).where(t.threads.c.id == thread.id))).one()
    view = await thread_view(conn, row, user.id)
    _publish_thread(request, conn, user.id, view)
    return view


@router.get("/threads/{thread_id}/messages")
async def list_messages(
    thread_id: str, conn: Conn, user: UserRole, before: int | None = None, limit: int = 50
) -> list[dict]:
    thread = await member_thread(conn, thread_id, user.id)
    limit = max(1, min(limit, 200))
    m = t.messages
    query = select(m.c.id).where(m.c.thread_id == thread.id)
    if before is not None:
        query = query.where(m.c.id < before)
    ids = (await conn.execute(query.order_by(m.c.id.desc()).limit(limit))).scalars().all()
    return [await message_view(conn, i) for i in reversed(ids)]


@router.post("/threads/{thread_id}/messages", status_code=201)
async def post_user_message(
    thread_id: str,
    request: Request,
    conn: Conn,
    user: UserRole,
    text: Annotated[str | None, Form(max_length=20_000)] = None,
    reply_to: Annotated[str | None, Form()] = None,
    choice_id: Annotated[str | None, Form(max_length=64)] = None,
    target: Annotated[str | None, Form()] = None,
    mention: Annotated[str | None, Form(max_length=64)] = None,
    files: Annotated[list[UploadFile] | None, File()] = None,
) -> dict:
    thread = await member_thread(conn, thread_id, user.id)
    group = (
        (
            await conn.execute(
                select(t.groups, t.users.c.status, t.domains.c.status.label("domain_status"))
                .select_from(
                    t.groups.join(t.users, t.groups.c.technical_owner_id == t.users.c.id).join(
                        t.domains, t.users.c.domain_id == t.domains.c.id
                    )
                )
                .where(t.groups.c.technical_owner_id == thread.user_id)
            )
        ).one_or_none()
        if thread.kind == "group"
        else None
    )
    deliver_to = None
    mentioned = None
    if group is None:
        if target is not None or mention is not None:
            raise ApiError(400, "invalid_request")
        check_domain_available(user)
    else:
        if target not in (None, "group", "lead"):
            raise ApiError(400, "invalid_request")
        if mention is not None:
            # An @agent mention is an AI request routed through the group's lead; the agent is
            # looked up only in this group's own team (never a person's or another group's).
            if target == "group":
                raise ApiError(400, "invalid_request")
            target = "lead"
        deliver_to = set()
        if target == "lead":
            lead = await conn.scalar(
                select(t.agents.c.id)
                .join(t.thread_members, t.thread_members.c.member_id == t.agents.c.id)
                .where(
                    t.agents.c.user_id == thread.user_id,
                    t.agents.c.is_lead.is_(True),
                    t.agents.c.state == "active",
                    t.thread_members.c.thread_id == thread.id,
                    t.thread_members.c.member_type == "agent",
                )
            )
            if group.status != "active" or lead is None:
                raise ApiError(409, "group_ai_unavailable")
            if group.domain_status != "available":
                raise ApiError(503, "domain_unavailable")
            if mention is not None:
                a = t.agents
                mentioned = (
                    await conn.execute(
                        select(a.c.slug, a.c.display_name).where(
                            a.c.user_id == thread.user_id,
                            a.c.slug == mention.strip().lower(),
                            a.c.state == "active",
                        )
                    )
                ).one_or_none()
                if mentioned is None:
                    raise ApiError(400, "invalid_agent_mention")
            deliver_to = {lead}
    if thread.read_only:
        raise ApiError(409, "thread_read_only")
    uploads = [
        (f.filename or "file", await f.read(attachments.MAX_BYTES + 1), f.content_type)
        for f in (files or [])
    ]
    incoming = attachments.from_upload(uploads)
    if not (text or "").strip() and not incoming:
        raise ApiError(400, "invalid_request", "Tin nhắn trống.")
    content: dict = {"text": text or ""}
    if target == "lead":
        content["target"] = "lead"
    if mentioned is not None:
        content["mention"] = {"slug": mentioned.slug, "name": mentioned.display_name}
    if reply_to is not None:
        try:
            content["reply_to"] = int(reply_to)
        except ValueError:
            raise ApiError(400, "invalid_request") from None
    if choice_id:
        content["choice_id"] = choice_id
    harness = request.app.state.harness

    async def store_and_copy(message_id: int, receivers: list) -> None:
        stored = await attachments.store(conn, request.app.state.settings, message_id, incoming)
        await attachments.copy_to_inboxes(harness, receivers, message_id, stored)

    from backend import ids

    message_id = await post_message(
        harness,
        conn,
        thread_id=thread.id,
        sender_type="user",
        sender_id=user.id,
        content=content,
        trace_id=ids.trace_id(),
        before_deliveries=store_and_copy,
        deliver_to=deliver_to,
    )
    return await message_view(conn, message_id)


@router.post("/threads/{thread_id}/read", status_code=204)
async def mark_read(thread_id: str, body: ReadMark, conn: Conn, user: UserRole) -> Response:
    thread = await member_thread(conn, thread_id, user.id)
    tm = t.thread_members
    newest = await conn.scalar(
        select(func.max(t.messages.c.id)).where(
            t.messages.c.thread_id == thread.id, t.messages.c.id <= body.message_id
        )
    )
    await conn.execute(
        update(tm)
        .where(tm.c.thread_id == thread.id, tm.c.member_type == "user", tm.c.member_id == user.id)
        .values(last_read_message_id=newest)
    )
    return Response(status_code=204)


INLINE_TYPES = ("image/", "application/pdf", "text/plain")


@router.get("/attachments/{attachment_id}")
async def get_attachment(attachment_id: str, conn: Conn, user: AnyUser) -> FileResponse:
    try:
        aid = uuid.UUID(attachment_id)
    except ValueError:
        raise ApiError(404, "not_found") from None
    a, m, th = t.attachments, t.messages, t.threads
    row = (
        await conn.execute(
            select(a, th.c.user_id, th.c.id.label("thread_id"))
            .select_from(a.join(m, a.c.message_id == m.c.id).join(th, m.c.thread_id == th.c.id))
            .where(a.c.id == aid)
        )
    ).one_or_none()
    if row is None or not Path(row.path).is_file():
        raise ApiError(404, "not_found")
    if not (user.is_admin or row.user_id == user.id):
        await member_thread(conn, row.thread_id, user.id)
    inline = row.mime.startswith(INLINE_TYPES)
    return FileResponse(
        row.path,
        media_type=row.mime,
        filename=row.filename,
        content_disposition_type="inline" if inline else "attachment",
        headers={"X-Content-Type-Options": "nosniff"},
    )
