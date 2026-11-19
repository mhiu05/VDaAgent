"""Appending to an agent's event log (doc 10 `events`): gap-free `seq` per agent.

The append takes a row lock on the agent, so two writers (the runner and, at boot, the restart
handling) can never pick the same `seq`. The epoch is the agent's latest one.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncConnection

from backend.db import tables as t
from backend.harness.render import Event


async def append(
    conn: AsyncConnection,
    agent_id: uuid.UUID,
    *,
    kind: str,
    payload: dict[str, Any],
    trace_id: str,
    activation_kind: str,
    task_id: int | None = None,
) -> int:
    await conn.execute(select(t.agents.c.id).where(t.agents.c.id == agent_id).with_for_update())
    seq = 1 + await conn.scalar(
        select(func.coalesce(func.max(t.events.c.seq), 0)).where(t.events.c.agent_id == agent_id)
    )
    epoch = await conn.scalar(
        select(func.coalesce(func.max(t.agent_epochs.c.epoch), 0)).where(
            t.agent_epochs.c.agent_id == agent_id
        )
    )
    await conn.execute(
        t.events.insert().values(
            agent_id=agent_id,
            seq=seq,
            epoch=epoch,
            kind=kind,
            payload=payload,
            trace_id=trace_id,
            activation_kind=activation_kind,
            task_id=task_id,
        )
    )
    return seq


async def context_events(conn: AsyncConnection, agent_id: uuid.UUID, start_seq: int) -> list[Event]:
    """Events with `seq > start_seq`, in seq order (doc 10 invariant 2)."""
    rows = (
        await conn.execute(
            select(t.events.c.seq, t.events.c.kind, t.events.c.payload)
            .where(t.events.c.agent_id == agent_id, t.events.c.seq > start_seq)
            .order_by(t.events.c.seq)
        )
    ).all()
    return [Event(r.seq, r.kind, r.payload) for r in rows]
