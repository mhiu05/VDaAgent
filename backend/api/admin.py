"""Admin observability routes (doc 15 "Admin API", doc 13 "Chat-trace view", "Overview page").

All under `/api/admin`, role `admin` only.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy import Float, and_, cast, func, select, update

from backend.api.agents import agent_view
from backend.api.deps import Admin, Conn, require_admin
from backend.api.errors import ApiError
from backend.api.stream import sse_events, sse_response
from backend.db import tables as t
from backend.db.session import on_commit
from backend.messaging.messages import message_view
from backend.messaging.threads import thread_view

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])
TZ = ZoneInfo("Asia/Ho_Chi_Minh")
PROJECT_ID = "contoso-poc"  # LANGFUSE_INIT_PROJECT_ID (doc 13)


def _uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError:
        raise ApiError(404, "not_found") from None


def _iso(v):
    return v.isoformat() if v else None


@router.get("/config")
async def config(request: Request) -> dict:
    s = request.app.state.settings
    return {"langfuse_url": s.LANGFUSE_PUBLIC_URL, "langfuse_project_id": PROJECT_ID}


@router.get("/overview")
async def overview(conn: Conn) -> dict:
    a, u, g, d, e = t.agents, t.users, t.global_tasks, t.deliveries, t.events
    domains = [
        {"id": r.id, "name": r.name, "status": r.status, "status_reason": r.status_reason}
        for r in (await conn.execute(select(t.domains).order_by(t.domains.c.id))).all()
    ]
    midnight = datetime.now(TZ).replace(hour=0, minute=0, second=0, microsecond=0)
    cost = (
        select(
            e.c.agent_id, func.sum(cast(e.c.payload["usage"]["cost"].astext, Float)).label("cost")
        )
        .where(e.c.kind == "assistant", e.c.created_at >= midnight)
        .group_by(e.c.agent_id)
        .subquery()
    )
    last_error = (
        select(e.c.agent_id, func.max(e.c.created_at).label("at"))
        .where(e.c.kind == "error")
        .group_by(e.c.agent_id)
        .subquery()
    )
    pending = (
        select(d.c.agent_id, func.count().label("n"))
        .where(d.c.status == "pending")
        .group_by(d.c.agent_id)
        .subquery()
    )
    queued = (
        select(g.c.user_id, func.count().label("n"))
        .where(g.c.status == "queued")
        .group_by(g.c.user_id)
        .subquery()
    )
    running = select(g.c.user_id, g.c.id, g.c.description).where(g.c.status == "running").subquery()
    rows = (
        await conn.execute(
            select(
                a,
                u.c.username,
                u.c.domain_id,
                cost.c.cost,
                last_error.c.at.label("error_at"),
                pending.c.n.label("pending"),
                queued.c.n.label("queued"),
                running.c.id.label("task_id"),
                running.c.description.label("task_desc"),
            )
            .select_from(
                a.join(u, a.c.user_id == u.c.id)
                .outerjoin(cost, cost.c.agent_id == a.c.id)
                .outerjoin(last_error, last_error.c.agent_id == a.c.id)
                .outerjoin(pending, pending.c.agent_id == a.c.id)
                .outerjoin(queued, queued.c.user_id == a.c.user_id)
                .outerjoin(running, running.c.user_id == a.c.user_id)
            )
            .where(a.c.state == "active")
            .order_by(u.c.username, a.c.is_lead.desc(), a.c.slug)
        )
    ).all()
    agents = []
    for r in rows:
        view = agent_view(r)
        view.update(
            {
                "user": {"id": str(r.user_id), "username": r.username},
                "domain": r.domain_id,
                "current_task": {"id": r.task_id, "description": r.task_desc}
                if r.task_id
                else None,
                "queue_len": (r.queued or 0) if r.is_lead else None,
                "pending": r.pending or 0,
                "cost_today": float(r.cost or 0),
                "last_error_at": _iso(r.error_at),
                "compaction_failed": r.compaction_failures >= 3,
                "compaction_pending": r.compaction_pending,
            }
        )
        agents.append(view)
    return {"domains": domains, "agents": agents}


@router.get("/users/{user_id}/agents")
async def user_agents(user_id: str, conn: Conn) -> list[dict]:
    rows = (
        await conn.execute(
            select(t.agents)
            .where(t.agents.c.user_id == _uuid(user_id))
            .order_by(t.agents.c.is_lead.desc(), t.agents.c.slug)
        )
    ).all()
    return [{**agent_view(r), "state": r.state} for r in rows]


@router.get("/users/{user_id}/threads")
async def user_threads(user_id: str, conn: Conn) -> list[dict]:
    uid = _uuid(user_id)
    rows = (
        await conn.execute(
            select(t.threads)
            .where(t.threads.c.user_id == uid)
            .order_by(t.threads.c.last_message_at.desc())
        )
    ).all()
    return [await thread_view(conn, r, uid) for r in rows]


async def _agent(conn, agent_id: str):
    row = (
        await conn.execute(select(t.agents).where(t.agents.c.id == _uuid(agent_id)))
    ).one_or_none()
    if row is None:
        raise ApiError(404, "not_found")
    return row


@router.get("/agents/{agent_id}/events")
async def agent_events(agent_id: str, conn: Conn, after_seq: int = 0, limit: int = 200) -> dict:
    agent = await _agent(conn, agent_id)
    limit = max(1, min(limit, 1000))
    e = t.events
    events = (
        await conn.execute(
            select(e)
            .where(e.c.agent_id == agent.id, e.c.seq > after_seq)
            .order_by(e.c.seq)
            .limit(limit)
        )
    ).all()
    epochs = (
        await conn.execute(
            select(t.agent_epochs)
            .where(t.agent_epochs.c.agent_id == agent.id)
            .order_by(t.agent_epochs.c.epoch)
        )
    ).all()
    jd = t.jev_decisions
    jev = (await conn.execute(select(jd).where(jd.c.lead_id == agent.id).order_by(jd.c.id))).all()
    return {
        "agent": agent_view(agent),
        "events": [
            {
                "seq": r.seq,
                "epoch": r.epoch,
                "kind": r.kind,
                "payload": r.payload,
                "trace_id": r.trace_id,
                "activation_kind": r.activation_kind,
                "task_id": r.task_id,
                "created_at": _iso(r.created_at),
            }
            for r in events
        ],
        "epochs": [
            {
                "epoch": r.epoch,
                "start_seq": r.start_seq,
                "reason": r.reason,
                "summary": r.summary,
                "system_prompt": r.system_prompt,
                "created_at": _iso(r.created_at),
            }
            for r in epochs
        ],
        "jev": [
            {
                "id": r.id,
                "message_id": r.message_id,
                "label": r.label,
                "fallback": r.fallback,
                "model": r.model,
                "latency_ms": r.latency_ms,
                "trace_id": r.trace_id,
                "observed": r.observed,
                "created_at": _iso(r.created_at),
            }
            for r in jev
        ],
    }


@router.get("/agents/{agent_id}/stream")
async def agent_stream(agent_id: str, request: Request, conn: Conn) -> StreamingResponse:
    agent = await _agent(conn, agent_id)
    harness = request.app.state.harness
    if harness is None:
        raise ApiError(503, "unavailable", "Realtime chưa sẵn sàng.")
    return sse_response(sse_events(harness.bus, agent.id, request, agent=True))


@router.post("/agents/{agent_id}/compact", status_code=204)
async def compact_now(agent_id: str, request: Request, conn: Conn) -> Response:
    agent = await _agent(conn, agent_id)
    await conn.execute(
        update(t.agents).where(t.agents.c.id == agent.id).values(compaction_pending=True)
    )
    harness = request.app.state.harness
    if harness is not None:
        on_commit(conn, lambda: harness.wake(agent.id))
    return Response(status_code=204)


@router.post("/agents/{agent_id}/reset", status_code=202)
async def reset_agent(agent_id: str, request: Request, conn: Conn) -> dict:
    """Doc 12 "Reset agent": the admin page runs the same reset job as the builder (doc 04)."""
    from backend.agents import folders, jobs

    agent = await _agent(conn, agent_id)
    if agent.state != "active":
        raise ApiError(404, "not_found")
    j = t.jobs
    if await conn.scalar(
        select(j.c.id).where(
            j.c.agent_id == agent.id,
            j.c.kind == "agent_reset",
            j.c.status.in_(("queued", "running")),
        )
    ):
        raise ApiError(409, "job_running")
    if await folders.involved_in_running_task(conn, agent.id):
        raise ApiError(409, "agent_busy_in_task")
    job_id = await jobs.enqueue(
        request.app.state.harness,
        conn,
        user_id=agent.user_id,
        kind="agent_reset",
        request={},
        agent_id=agent.id,
    )
    return {"job_id": str(job_id)}


@router.get("/threads/{thread_id}")
async def any_thread(thread_id: str, conn: Conn, limit: int = 200) -> dict:
    row = (
        await conn.execute(select(t.threads).where(t.threads.c.id == _uuid(thread_id)))
    ).one_or_none()
    if row is None:
        raise ApiError(404, "not_found")
    m = t.messages
    ids = (
        (
            await conn.execute(
                select(m.c.id)
                .where(m.c.thread_id == row.id)
                .order_by(m.c.id.desc())
                .limit(max(1, min(limit, 1000)))
            )
        )
        .scalars()
        .all()
    )
    return {
        "thread": await thread_view(conn, row, row.user_id),
        "messages": [
            {
                **await message_view(conn, i),
                "trace_id": await conn.scalar(select(m.c.trace_id).where(m.c.id == i)),
            }
            for i in reversed(ids)
        ],
    }


class Observed(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: Literal["task", "side_question"]


@router.post("/jev/{message_id}/observed", status_code=204)
async def jev_observed(message_id: int, body: Observed, conn: Conn, admin: Admin) -> Response:
    jd = t.jev_decisions
    latest = await conn.scalar(select(func.max(jd.c.id)).where(jd.c.message_id == message_id))
    if latest is None:
        raise ApiError(404, "not_found")
    await conn.execute(
        update(jd).where(and_(jd.c.id == latest)).values(observed=body.label, observed_by=admin.id)
    )
    return Response(status_code=204)
