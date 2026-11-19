"""`current_state` (doc 06): rendered by the harness at the start of every `input` event."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncConnection

from backend.db import tables as t

TZ = ZoneInfo("Asia/Ho_Chi_Minh")
TASK_CHARS = 60


@dataclass(frozen=True)
class TaskLine:
    id: int
    description: str
    started_at: datetime | None


@dataclass(frozen=True)
class CurrentState:
    now: datetime
    you_slug: str
    you_name: str
    is_lead: bool
    lead_slug: str | None
    lead_name: str | None
    team: list[str]
    task: TaskLine | None
    queued: int
    status: str
    pending_notifications: int
    pending_routines: list[str] = field(default_factory=list)


def _short(text: str, n: int = TASK_CHARS) -> str:
    text = " ".join(text.split())
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def render_current_state(s: CurrentState) -> str:
    lines = [
        f"time: {s.now.astimezone(TZ).isoformat(timespec='seconds')}",
        f'you: {s.you_slug} ("{s.you_name}")',
        "lead: you"
        if s.is_lead
        else (f'lead: {s.lead_slug} ("{s.lead_name}")' if s.lead_slug else "lead: none"),
        f"team: {', '.join(s.team)}",
    ]
    if s.task is None:
        lines.append("task: none")
    else:
        since = (
            f" (running since {s.task.started_at.astimezone(TZ):%H:%M})"
            if s.task.started_at
            else ""
        )
        lines.append(f'task: T{s.task.id} "{_short(s.task.description)}"{since}')
    if s.is_lead:
        lines.append(f"queue: {s.queued} queued")
    lines.append(f"status: {s.status}")
    pending = []
    if s.pending_notifications:
        n = s.pending_notifications
        pending.append(f"{n} notification{'s' if n != 1 else ''}")
    if s.pending_routines:
        pending.append(f"routines: {', '.join(s.pending_routines)}")
    lines.append(f"pending: {'; '.join(pending) if pending else 'none'}")
    return "<current_state>\n" + "\n".join(lines) + "\n</current_state>"


async def load_current_state(
    conn: AsyncConnection, agent: Any, *, now: datetime, status: str | None = None
) -> CurrentState:
    a, g = t.agents, t.global_tasks
    team_rows = (
        await conn.execute(
            select(a.c.slug, a.c.display_name, a.c.is_lead)
            .where(a.c.user_id == agent.user_id, a.c.state == "active")
            .order_by(a.c.is_lead.desc(), a.c.created_at, a.c.slug)
        )
    ).all()
    lead = next((r for r in team_rows if r.is_lead), None)
    task = (
        await conn.execute(
            select(g.c.id, g.c.description, g.c.started_at).where(
                g.c.user_id == agent.user_id, g.c.status == "running"
            )
        )
    ).one_or_none()
    queued = await conn.scalar(
        select(func.count())
        .select_from(g)
        .where(g.c.user_id == agent.user_id, g.c.status == "queued")
    )
    pending = await conn.scalar(
        select(func.count())
        .select_from(t.deliveries)
        .where(t.deliveries.c.agent_id == agent.id, t.deliveries.c.status == "pending")
    )
    routines = (
        (
            await conn.execute(
                select(t.routine_state.c.name)
                .where(t.routine_state.c.agent_id == agent.id, t.routine_state.c.pending.is_(True))
                .order_by(t.routine_state.c.next_fire_at.nulls_last(), t.routine_state.c.name)
            )
        )
        .scalars()
        .all()
    )
    return CurrentState(
        now=now,
        you_slug=agent.slug,
        you_name=agent.display_name,
        is_lead=bool(agent.is_lead),
        lead_slug=lead.slug if lead else None,
        lead_name=lead.display_name if lead else None,
        team=[r.slug for r in team_rows],
        task=TaskLine(task.id, task.description, task.started_at) if task else None,
        queued=queued,
        status=status or agent.status,
        pending_notifications=pending,
        pending_routines=list(routines),
    )
