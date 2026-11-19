"""`GET /api/stream`: server-sent events for the logged-in user (doc 14 "Realtime").

One connection per tab. Events are the bus events for the user (`message.created`,
`agent.status`, `task.updated`, `thread.updated`, `builder.job`, …), framed as
`event: <type>\\ndata: <json>\\n\\n`, with a `: ping` comment every 15 s. No replay: on
reconnect the client re-reads its data.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from backend import groups
from backend.api.deps import AnyUser
from backend.api.errors import ApiError

router = APIRouter(tags=["stream"])
RETRY_MS = 3000


def frame(event: dict[str, Any]) -> str:
    return f"event: {event['type']}\ndata: {json.dumps(event['data'], ensure_ascii=False)}\n\n"


async def sse_events(
    bus: Any,
    key: Any,
    request: Any,
    *,
    heartbeat_s: float = 15.0,
    agent: bool = False,
    group_owners: tuple[Any, ...] = (),
    still_member: Any = None,
) -> AsyncIterator[str]:
    queue = bus.subscribe_agent(key) if agent else bus.subscribe(key)
    active_groups = {str(owner) for owner in group_owners}
    for owner in active_groups:
        bus.subscribe_group(owner, queue)
    try:
        yield f"retry: {RETRY_MS}\n\n"
        while not await request.is_disconnected():
            try:
                event = await asyncio.wait_for(queue.get(), timeout=heartbeat_s)
            except TimeoutError:
                yield ": ping\n\n"
                continue
            owner = event.get("group_owner")
            if owner is not None:
                if owner not in active_groups:
                    continue
                if still_member is None or not await still_member(uuid.UUID(owner)):
                    bus.unsubscribe_group(owner, queue)
                    active_groups.discard(owner)
                    continue
            yield frame(event)
    finally:
        if agent:
            bus.unsubscribe_agent(key, queue)
        else:
            bus.unsubscribe(key, queue)
        for owner in active_groups:
            bus.unsubscribe_group(owner, queue)


def sse_response(events: AsyncIterator[str]) -> StreamingResponse:
    return StreamingResponse(
        events,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/stream")
async def stream(request: Request, user: AnyUser) -> StreamingResponse:
    harness = request.app.state.harness
    if harness is None:
        raise ApiError(503, "unavailable", "Realtime chưa sẵn sàng.")
    group_owners = ()
    if user.is_human and not user.is_admin:
        async with harness.db() as conn:
            group_owners = tuple(
                (await conn.execute(groups.member_group_owners(user.id))).scalars().all()
            )

    async def still_member(owner_id: uuid.UUID) -> bool:
        async with harness.db() as conn:
            return await groups.is_current_member(conn, owner_id, user.id)

    return sse_response(
        sse_events(
            harness.bus,
            user.id,
            request,
            group_owners=group_owners,
            still_member=still_member,
        )
    )
