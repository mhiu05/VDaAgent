"""Notices (doc 10 `deliveries.notice`): platform messages to one agent, pre-classified.

Kinds: `builder`, `presence`, `restart`, `task_cancelled`, `task_timeout`, `routine_invalid`,
`task_resume`. The receiver is woken once the inserting transaction commits.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncConnection

from backend.db import tables as t
from backend.db.session import on_commit

RESTART_TEXT = "The harness restarted; your last step was interrupted and its result is lost."


async def send_notice(
    harness: Any,
    conn: AsyncConnection,
    agent_id: uuid.UUID,
    kind: str,
    text: str,
    *,
    extra: dict[str, Any] | None = None,
) -> int:
    delivery_id = await conn.scalar(
        t.deliveries.insert()
        .values(
            agent_id=agent_id,
            notice={"kind": kind, "text": text, **(extra or {})},
            route="notification",
            status="pending",
        )
        .returning(t.deliveries.c.id)
    )
    on_commit(conn, lambda: harness.wake(agent_id))
    return delivery_id
