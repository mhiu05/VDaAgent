"""`contoso.send_to_user` and `contoso.send_to_agent` (doc 08), as internal routes (doc 15).

Both refuse during compaction (409 `compacting`). Errors are 400 `invalid_thread`,
`invalid_receiver`, `invalid_file`, `invalid_request`; 413 `file_too_large`; 409
`thread_read_only`.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import exists, select

from backend.api.errors import ApiError
from backend.api.internal import Caller, harness_of
from backend.db import tables as t
from backend.harness.items import resolve_thread
from backend.messaging import attachments
from backend.messaging.messages import AGENT_AUDIENCE, post_message
from backend.messaging.threads import agent_ids_of, agent_thread

router = APIRouter(prefix="/internal/v1")
VERSION_RE = re.compile(r"^(R[0-9]+)-v([0-9]+)$")
COMPACTING = "messaging is disabled during compaction"


class Choice(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    label: Annotated[str, StringConstraints(min_length=1, max_length=100)]


class SendToUser(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str | None = Field(default=None, max_length=20_000)
    files: list[str] = Field(default_factory=list)
    choices: list[Choice] | None = Field(default=None, max_length=6)
    reports: list[str] = Field(default_factory=list, max_length=5)
    thread: str | None = None
    reply_to: int | None = None
    final: bool = False


class SendToAgent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    receivers: list[str] = Field(min_length=1, max_length=20)
    content: str = Field(max_length=20_000)
    files: list[str] = Field(default_factory=list)
    thread: str | None = None
    reply_to: int | None = None


def _not_compacting(caller: Any) -> None:
    if caller.compacting:
        raise ApiError(409, "compacting", COMPACTING)


async def _report_refs(conn: Any, user_id: Any, version_ids: list[str]) -> list[dict]:
    refs = []
    for vid in version_ids:
        m = VERSION_RE.match(vid)
        row = None
        if m:
            r, v = t.reports, t.report_versions
            row = (
                await conn.execute(
                    select(r.c.code, r.c.title)
                    .select_from(r.join(v, v.c.report_id == r.c.id))
                    .where(
                        r.c.user_id == user_id,
                        r.c.code == m.group(1),
                        v.c.sequence == int(m.group(2)),
                    )
                )
            ).one_or_none()
        if row is None:
            raise ApiError(400, "invalid_request", f"Không có phiên bản báo cáo {vid}.")
        refs.append({"report_id": row.code, "version_id": vid, "title": row.title})
    return refs


async def _thread_with_caller(conn: Any, caller: Any, ref: str | None) -> Any:
    thread_id = await resolve_thread(conn, caller.user_id, ref)
    if thread_id is None:
        raise ApiError(400, "invalid_thread", f"Không có cuộc trò chuyện {ref}.")
    thread = (await conn.execute(select(t.threads).where(t.threads.c.id == thread_id))).one()
    if caller.agent_id not in await agent_ids_of(conn, thread_id):
        raise ApiError(400, "invalid_thread", f"Agent không ở trong cuộc trò chuyện {ref}.")
    return thread


async def _is_group_room(conn: Any, thread: Any) -> bool:
    """A Group Chat room: the `group` thread owned by a group's technical owner."""
    return thread.kind == "group" and bool(
        await conn.scalar(select(exists().where(t.groups.c.technical_owner_id == thread.user_id)))
    )


async def _post(
    h: Any, conn: Any, caller: Any, thread_id: Any, content: dict, files: list[attachments.Incoming]
) -> int:
    async def store_and_copy(message_id: int, receivers: list[Any]) -> None:
        stored = await attachments.store(conn, h.settings, message_id, files)
        await attachments.copy_to_inboxes(h, receivers, message_id, stored)

    return await post_message(
        h,
        conn,
        thread_id=thread_id,
        sender_type="agent",
        sender_id=caller.agent_id,
        content=content,
        trace_id=caller.trace_id,
        exec_id=caller.exec_id,
        before_deliveries=store_and_copy,
    )


@router.post("/send_to_user")
async def send_to_user(body: SendToUser, caller: Caller, request: Request) -> dict:
    _not_compacting(caller)
    if not body.text and not body.files and not body.reports and not body.choices:
        raise ApiError(400, "invalid_request", "Tin nhắn trống.")
    h = harness_of(request)
    files = attachments.from_folder(Path(caller.folder), body.files)
    async with h.db() as conn:
        thread = await _thread_with_caller(conn, caller, body.thread or caller.default_thread)
        if thread.kind == "agent":
            raise ApiError(
                400, "invalid_thread", "Cuộc trò chuyện giữa các agent không có người dùng."
            )
        if thread.read_only:
            raise ApiError(409, "thread_read_only")
        content: dict[str, Any] = {"text": body.text or ""}
        if body.choices:
            content["choices"] = [c.model_dump() for c in body.choices]
        if body.reply_to:
            content["reply_to"] = body.reply_to
        if body.reports:
            content["report_refs"] = await _report_refs(conn, caller.user_id, body.reports)
        message_id = await _post(h, conn, caller, thread.id, content, files)
        if body.choices:  # doc 19: the user has to pick → action-required
            from backend.notifications import notify

            await notify(
                conn,
                caller.user_id,
                "action_required",
                target={"kind": "chat", "conversationId": str(thread.id)},
                bus=h.bus,
            )
    if body.final:
        h.registry.request_final(caller.exec_id)
    h.tracer.event(
        trace_id=caller.trace_id,
        name="send_to_user",
        metadata={
            "message_id": message_id,
            "thread": str(thread.id),
            "final": body.final,
            "files": len(files),
        },
    )
    return {"message_id": message_id}


@router.post("/send_to_agent")
async def send_to_agent(body: SendToAgent, caller: Caller, request: Request) -> dict:
    _not_compacting(caller)
    h = harness_of(request)
    files = attachments.from_folder(Path(caller.folder), body.files)
    a = t.agents
    async with h.db() as conn:
        slugs = list(dict.fromkeys(body.receivers))
        if caller.slug in slugs:
            raise ApiError(400, "invalid_receiver", "Không thể tự gửi cho chính mình.")
        receivers = (
            await conn.execute(
                select(a).where(
                    a.c.user_id == caller.user_id, a.c.slug.in_(slugs), a.c.state == "active"
                )
            )
        ).all()
        if len(receivers) != len(slugs):
            known = {r.slug for r in receivers}
            missing = ", ".join(s for s in slugs if s not in known)
            raise ApiError(400, "invalid_receiver", f"Không có agent: {missing}")
        thread = await _thread_with_caller(conn, caller, body.thread) if body.thread else None
        if thread is not None and await _is_group_room(conn, thread):
            # A group-chat room is public and its teammates are not members: delegation from
            # the lead always goes through the private agent thread, never into the room.
            thread = None
        if thread is not None:
            if thread.kind != "group":
                raise ApiError(400, "invalid_thread", "Chỉ gửi vào nhóm, hoặc bỏ trống thread.")
            others = await agent_ids_of(conn, thread.id) - {caller.agent_id}
            if others != {r.id for r in receivers}:
                raise ApiError(
                    400, "invalid_receiver", "receivers phải đúng bằng các agent khác trong nhóm."
                )
            thread_id = thread.id
        else:
            sender = (await conn.execute(select(a).where(a.c.id == caller.agent_id))).one()
            thread_id = await agent_thread(conn, caller.user_id, [sender, *receivers])
        content: dict[str, Any] = {"text": body.content, "audience": AGENT_AUDIENCE}
        if body.reply_to:
            content["reply_to"] = body.reply_to
        message_id = await _post(h, conn, caller, thread_id, content, files)
    h.tracer.event(
        trace_id=caller.trace_id,
        name="send_to_agent",
        metadata={"message_id": message_id, "thread": str(thread_id), "receivers": slugs},
    )
    return {"message_id": message_id}
