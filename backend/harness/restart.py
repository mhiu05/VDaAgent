"""Restart handling at boot (doc 03 "Restart"), before the supervisor starts.

- **Lost execs.** A tool call of an agent's last `assistant` event without a `tool_result` gets
  one: `exit_code: lost (harness restart)` (doc 10 invariant 5).
- **Interrupted agents** (`status` not `idle`, or a lost exec was found: a graceful stop sets
  the status back to `idle` but still loses the step) get the notice "The harness restarted; …",
  are set `idle` and woken.
- **Running global tasks** stay `running`; the lead gets a `task_resume` notice.
- Nothing is replayed. Returns the agents to wake.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select, update

from backend.db import tables as t
from backend.harness.notices import RESTART_TEXT, send_notice
from backend.harness.runner import error_tool_result

LOST_LINE = "exit_code: lost (harness restart)"


def resume_text(task_id: int) -> str:
    return (
        f"Task T{task_id} is still running after a harness restart. Continue it, or call "
        "end_task(outcome) if it is finished."
    )


async def reconcile(harness: Any) -> set[uuid.UUID]:
    woken: set[uuid.UUID] = set()
    async with harness.db() as conn:
        agents = (await conn.execute(select(t.agents).where(t.agents.c.state == "active"))).all()
        e = t.events
        for agent in agents:
            last_call = (
                await conn.execute(
                    select(e)
                    .where(e.c.agent_id == agent.id, e.c.kind == "assistant")
                    .order_by(e.c.seq.desc())
                    .limit(1)
                )
            ).one_or_none()
            lost = False
            if last_call is not None and last_call.payload.get("tool_calls"):
                answered = set(
                    (
                        await conn.execute(
                            select(e.c.payload["tool_call_id"].astext).where(
                                e.c.agent_id == agent.id,
                                e.c.kind == "tool_result",
                                e.c.seq > last_call.seq,
                            )
                        )
                    )
                    .scalars()
                    .all()
                )
                for call in last_call.payload["tool_calls"]:
                    if call["id"] not in answered:
                        lost = True
                        await harness.append(
                            conn,
                            agent,
                            kind="tool_result",
                            payload=error_tool_result(
                                call["id"], None, "lost", 0, line=LOST_LINE, system=True
                            ),
                            trace_id=last_call.trace_id,
                            activation_kind=last_call.activation_kind,
                            task_id=last_call.task_id,
                        )
            if agent.status != "idle" or lost:
                await send_notice(harness, conn, agent.id, "restart", RESTART_TEXT)
                await conn.execute(
                    update(t.agents)
                    .where(t.agents.c.id == agent.id)
                    .values(status="idle", status_detail=None)
                )
                woken.add(agent.id)

        g = t.global_tasks
        running = (
            await conn.execute(select(g.c.id, g.c.user_id).where(g.c.status == "running"))
        ).all()
        for task in running:
            lead = await conn.scalar(
                select(t.agents.c.id).where(
                    t.agents.c.user_id == task.user_id,
                    t.agents.c.is_lead.is_(True),
                    t.agents.c.state == "active",
                )
            )
            if lead is not None:
                await send_notice(harness, conn, lead, "task_resume", resume_text(task.id))
                woken.add(lead)
    return woken
