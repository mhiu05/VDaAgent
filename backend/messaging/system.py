"""System messages: platform text posted into a user's thread (doc 10 `messages`, sender
`system`). Nobody receives a delivery for them; the user sees them in the thread."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from backend.db import tables as t
from backend.db.session import on_commit
from backend.messaging.messages import message_view


async def post_system_message(
    harness: Any, conn: AsyncConnection, thread_id: uuid.UUID, text: str
) -> int:
    message_id = await conn.scalar(
        t.messages.insert()
        .values(thread_id=thread_id, sender_type="system", sender_id=None, content={"text": text})
        .returning(t.messages.c.id)
    )
    await conn.execute(
        update(t.threads).where(t.threads.c.id == thread_id).values(last_message_at=func.now())
    )
    thread = (await conn.execute(select(t.threads).where(t.threads.c.id == thread_id))).one()
    view = await message_view(conn, message_id)
    on_commit(
        conn,
        lambda: harness.bus.publish(thread.user_id, "message.created", view),
    )
    if thread.kind == "group":
        on_commit(conn, lambda: harness.bus.publish_group(thread.user_id, "message.created", view))
    return message_id
