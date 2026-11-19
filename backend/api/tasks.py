"""`/api/tasks` and `/api/presence` (doc 15 "Tasks, presence and stream"; doc 07).

`Task = {id, description, status, outcome, ended_by, source_message_id, created_at, started_at,
ended_at}`. Presence sends the lead a `presence` notice at most once per 30 minutes.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Request, Response
from sqlalchemy import or_, select

from backend import groups
from backend.api.deps import Conn, UserRole, get_owned
from backend.api.errors import ApiError
from backend.db import tables as t
from backend.harness.notices import send_notice
from backend.harness.queue import cancel_task, task_view

router = APIRouter(tags=["tasks"])

STATUSES = ("queued", "running", "done", "failed", "cancelled")
PRESENCE_EVERY = timedelta(minutes=30)
PRESENCE_TEXT = "The user just opened the app."


@router.get("/tasks")
async def list_tasks(conn: Conn, user: UserRole, status: str | None = None) -> list[dict]:
    g = t.global_tasks
    query = (
        select(g, t.groups.c.id.label("group_id"))
        .outerjoin(t.groups, t.groups.c.technical_owner_id == g.c.user_id)
        .where(or_(g.c.user_id == user.id, g.c.user_id.in_(groups.member_group_owners(user.id))))
        .order_by(g.c.created_at, g.c.id)
    )
    if status:
        wanted = [s.strip() for s in status.split(",") if s.strip()]
        if not wanted or any(s not in STATUSES for s in wanted):
            raise ApiError(400, "invalid_request")
        query = query.where(g.c.status.in_(wanted))
    return [task_view(r) for r in (await conn.execute(query)).all()]


@router.post("/tasks/{task_id}/cancel")
async def cancel(task_id: str, request: Request, conn: Conn, user: UserRole) -> dict:
    try:
        tid = int(task_id)
    except ValueError:
        raise ApiError(404, "not_found") from None
    g = t.global_tasks
    task = (
        await conn.execute(
            select(g)
            .where(
                g.c.id == tid,
                or_(g.c.user_id == user.id, g.c.user_id.in_(groups.member_group_owners(user.id))),
            )
            .with_for_update()
        )
    ).one_or_none()
    if task is None:
        raise ApiError(404, "not_found")
    return await cancel_task(request.app.state.harness, conn, task)


@router.post("/presence", status_code=204)
async def presence(request: Request, conn: Conn, user: UserRole) -> Response:
    a, d = t.agents, t.deliveries
    lead = await conn.scalar(
        select(a.c.id).where(a.c.user_id == user.id, a.c.is_lead.is_(True), a.c.state == "active")
    )
    if lead is not None:
        last = await conn.scalar(
            select(d.c.created_at)
            .where(d.c.agent_id == lead, d.c.notice["kind"].astext == "presence")
            .order_by(d.c.created_at.desc())
            .limit(1)
        )
        if last is None or datetime.now(UTC) - last > PRESENCE_EVERY:
            await send_notice(request.app.state.harness, conn, lead, "presence", PRESENCE_TEXT)
    return Response(status_code=204)


__all__ = ["get_owned", "router"]
