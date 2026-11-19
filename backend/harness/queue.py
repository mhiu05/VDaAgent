"""The global task queue (doc 07 "Global task queue", decision 0001).

- **Begin** (the lead's work source, doc 03 rule 4): with no running task, the oldest `queued`
  task becomes `running`, the lead is involved, and the activation's input is `<begin_task>`.
- **End**: `contoso.end_task(outcome, status)` (lead only, the running task) → `done`/`failed`.
- **Queue**: `contoso.queue_task(description)` (lead only).
- **Cancel** (the user) and **timeout** (`TASK_MAX_S`, the scheduler) notify the lead and every
  involved agent.
`task.updated` carries the `Task` row of doc 15.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from backend.api.errors import ApiError
from backend.api.internal import Caller, harness_of
from backend.db import tables as t
from backend.db.session import on_commit
from backend.harness import items
from backend.harness.notices import send_notice

TASK_COLUMNS = (
    "id",
    "description",
    "status",
    "outcome",
    "ended_by",
    "source_message_id",
    "created_at",
    "started_at",
    "ended_at",
)


def task_view(row: Any) -> dict:
    out = {}
    for c in TASK_COLUMNS:
        v = getattr(row, c)
        out[c] = v.isoformat() if isinstance(v, datetime) else v
    group_id = getattr(row, "group_id", None)
    out["group_id"] = str(group_id) if group_id is not None else None
    return out


async def publish_task(h: Any, conn: AsyncConnection, task_id: int) -> dict:
    row = (
        await conn.execute(
            select(t.global_tasks, t.groups.c.id.label("group_id"))
            .outerjoin(t.groups, t.groups.c.technical_owner_id == t.global_tasks.c.user_id)
            .where(t.global_tasks.c.id == task_id)
        )
    ).one()
    view = task_view(row)
    on_commit(conn, lambda: h.bus.publish(row.user_id, "task.updated", view))
    on_commit(conn, lambda: h.bus.publish_group(row.user_id, "task.updated", view))
    return view


async def task_source(h: Any, conn: AsyncConnection, agent: Any) -> items.Work | None:
    if not agent.is_lead:
        return None
    g = t.global_tasks
    if await conn.scalar(
        select(g.c.id).where(g.c.user_id == agent.user_id, g.c.status == "running")
    ):
        return None
    task = (
        await conn.execute(
            select(g)
            .where(g.c.user_id == agent.user_id, g.c.status == "queued")
            .order_by(g.c.created_at, g.c.id)
            .limit(1)
            .with_for_update(skip_locked=True)
        )
    ).one_or_none()
    if task is None:
        return None
    await conn.execute(
        update(g).where(g.c.id == task.id).values(status="running", started_at=func.now())
    )
    from backend.messaging.messages import involve

    await involve(conn, task.id, [agent.id])
    await publish_task(h, conn, task.id)

    thread_ref, original, requested = None, None, None
    if task.source_message_id is not None:
        m = (
            await conn.execute(select(t.messages).where(t.messages.c.id == task.source_message_id))
        ).one()
        thread_ref, _ = await items.readable_thread(conn, m.thread_id)
        original = (m.content or {}).get("text")
        requested = items.requested_agent(m.content or {}, agent)
    block = items.begin_task(
        task_id=task.id,
        source_message=task.source_message_id,
        thread=thread_ref,
        description=task.description,
        original=original,
        requested_agent=requested,
    )
    return items.Work(
        kind="task",
        blocks=[block],
        items=[{"type": "begin_task", "task_id": task.id}],
        default_thread=thread_ref or f"direct:{agent.slug}",
        task_id=task.id,
        user_visible=True,
        response_required=True,
        requires_tools=True,
    )


async def involved_agents(conn: AsyncConnection, task: Any) -> list[Any]:
    lead = await conn.scalar(
        select(t.agents.c.id).where(
            t.agents.c.user_id == task.user_id,
            t.agents.c.is_lead.is_(True),
            t.agents.c.state == "active",
        )
    )
    others = (
        (
            await conn.execute(
                select(t.task_involvement.c.agent_id).where(t.task_involvement.c.task_id == task.id)
            )
        )
        .scalars()
        .all()
    )
    agents = [lead] if lead is not None else []
    return agents + [a for a in others if a not in agents]


async def end_by(
    h: Any,
    conn: AsyncConnection,
    task: Any,
    *,
    status: str,
    ended_by: str,
    outcome: str | None,
    notice_kind: str | None,
    notice_text: str | None,
) -> dict:
    await conn.execute(
        update(t.global_tasks)
        .where(t.global_tasks.c.id == task.id)
        .values(status=status, ended_by=ended_by, outcome=outcome, ended_at=func.now())
    )
    if notice_kind:
        for agent_id in await involved_agents(conn, task):
            await send_notice(h, conn, agent_id, notice_kind, notice_text)
    from backend.reports.service import fail_attempts_for_task

    await fail_attempts_for_task(h, conn, task.id)
    if status == "failed":
        await notify_task_failed(h, conn, task)
    return await publish_task(h, conn, task.id)


async def notify_task_failed(h: Any, conn: AsyncConnection, task: Any) -> None:
    """Doc 19: a task that ends `failed` (or by timeout) → `task-failed`, target the lead's chat."""
    from backend.notifications import notify

    th = t.threads
    thread = await conn.scalar(
        select(th.c.id).where(
            th.c.user_id == task.user_id, th.c.kind == "direct", th.c.member_key == "lead"
        )
    )
    target = {"kind": "chat", "conversationId": str(thread)} if thread else {"kind": "account"}
    await notify(
        conn, task.user_id, "task_failed", target=target, params={"task": task.id}, bus=h.bus
    )


def cancelled_text(task_id: int) -> str:
    return f"Task T{task_id} was cancelled by the user. Stop working on it."


def timeout_text(task_id: int, seconds: int) -> str:
    return f"Task T{task_id} ran longer than {seconds} s and was marked failed. Stop working on it."


async def cancel_task(h: Any, conn: AsyncConnection, task: Any) -> dict:
    if task.status not in ("queued", "running"):
        raise ApiError(409, "task_ended")
    return await end_by(
        h,
        conn,
        task,
        status="cancelled",
        ended_by="user",
        outcome=None,
        notice_kind="task_cancelled",
        notice_text=cancelled_text(task.id),
    )


async def enforce_task_timeouts(h: Any) -> int:
    limit = h.settings.TASK_MAX_S
    cutoff = datetime.now(UTC) - timedelta(seconds=limit)
    g = t.global_tasks
    async with h.db() as conn:
        due = (
            await conn.execute(
                select(g)
                .where(g.c.status == "running", g.c.started_at < cutoff)
                .with_for_update(skip_locked=True)
            )
        ).all()
        for task in due:
            await end_by(
                h,
                conn,
                task,
                status="failed",
                ended_by="timeout",
                outcome=f"timeout after {limit} s",
                notice_kind="task_timeout",
                notice_text=timeout_text(task.id, limit),
            )
    return len(due)


# --- internal routes (contoso.end_task, contoso.queue_task) ---------------------------------------

internal_router = APIRouter(prefix="/internal/v1")


class EndTask(BaseModel):
    model_config = ConfigDict(extra="forbid")
    outcome: str = Field(max_length=2000)
    status: Literal["done", "failed"] = "done"


class QueueTask(BaseModel):
    model_config = ConfigDict(extra="forbid")
    description: str = Field(min_length=1, max_length=2000)


def _lead_only(caller: Any) -> None:
    if not caller.is_lead:
        raise ApiError(403, "lead_only", "Chỉ agent điều phối được làm việc này.")


@internal_router.post("/end_task")
async def end_task(body: EndTask, caller: Caller, request: Request) -> dict:
    _lead_only(caller)
    h = harness_of(request)
    g = t.global_tasks
    async with h.db() as conn:
        task = (
            await conn.execute(
                select(g)
                .where(g.c.user_id == caller.user_id, g.c.status == "running")
                .with_for_update()
            )
        ).one_or_none()
        if task is None:
            raise ApiError(409, "no_running_task", "Không có việc nào đang chạy.")
        await end_by(
            h,
            conn,
            task,
            status=body.status,
            ended_by="lead",
            outcome=body.outcome,
            notice_kind=None,
            notice_text=None,
        )
    h.tracer.event(
        trace_id=caller.trace_id,
        name="end_task",
        metadata={"task_id": task.id, "status": body.status, "outcome": body.outcome},
    )
    return {"task_id": task.id}


@internal_router.post("/queue_task")
async def queue_task(body: QueueTask, caller: Caller, request: Request) -> dict:
    _lead_only(caller)
    h = harness_of(request)
    async with h.db() as conn:
        task_id = await conn.scalar(
            t.global_tasks.insert()
            .values(user_id=caller.user_id, description=body.description, status="queued")
            .returning(t.global_tasks.c.id)
        )
        await publish_task(h, conn, task_id)
        on_commit(conn, lambda: h.wake(caller.agent_id))
    h.tracer.event(trace_id=caller.trace_id, name="queue_task", metadata={"task_id": task_id})
    return {"task_id": task_id}
