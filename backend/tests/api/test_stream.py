"""`GET /api/stream`: server-sent events for the logged-in user (doc 14 "Realtime")."""

from __future__ import annotations

import asyncio
import json
import uuid

from backend.api.stream import sse_events
from backend.harness.bus import EventBus


class Disconnects:
    def __init__(self, after: int):
        self.after = after
        self.calls = 0

    async def is_disconnected(self):
        self.calls += 1
        return self.calls > self.after


async def test_events_are_framed_as_sse_and_unsubscribed_on_disconnect():
    bus = EventBus()
    gen = sse_events(bus, "u1", Disconnects(after=3), heartbeat_s=0.01)
    first = await gen.__anext__()
    assert first.startswith("retry: ")
    bus.publish("u1", "message.created", {"id": 7, "text": "chào"})
    chunk = await gen.__anext__()
    assert chunk == (
        "event: message.created\ndata: "
        + json.dumps({"id": 7, "text": "chào"}, ensure_ascii=False)
        + "\n\n"
    )
    beat = await asyncio.wait_for(gen.__anext__(), 1)
    assert beat == ": ping\n\n"
    rest = [c async for c in gen]
    assert all(c == ": ping\n\n" for c in rest)
    assert not bus._users["u1"]  # unsubscribed


async def test_route_requires_login(client):
    r = await client.get("/api/stream")
    assert r.status_code == 401


async def test_group_channel_only_exposes_public_events_and_revokes_open_stream():
    bus = EventBus()
    owner = uuid.uuid4()
    membership = {owner}

    async def still_member(group_owner):
        return group_owner in membership

    request = Disconnects(after=100)
    stream = sse_events(
        bus,
        "alice",
        request,
        heartbeat_s=0.01,
        group_owners=(owner,),
        still_member=still_member,
    )
    assert (await stream.__anext__()).startswith("retry: ")
    bus.publish(owner, "message.created", {"text": "internal secret"})
    bus.publish(owner, "builder.job", {"text": "private job"})
    bus.publish_group(owner, "message.created", {"text": "room"})
    assert await stream.__anext__() == 'event: message.created\ndata: {"text": "room"}\n\n'
    membership.clear()
    bus.publish_group(owner, "task.updated", {"id": 1})
    assert await stream.__anext__() == ": ping\n\n"
    assert not bus._groups[str(owner)]
    bus.publish_group(owner, "message.created", {"text": "after removal"})
    assert await stream.__anext__() == ": ping\n\n"
    await stream.aclose()


async def test_group_and_personal_channels_deliver_once_each():
    bus = EventBus()
    owner = uuid.uuid4()

    async def member(_owner):
        return True

    stream = sse_events(
        bus,
        "alice",
        Disconnects(after=100),
        heartbeat_s=0.01,
        group_owners=(owner,),
        still_member=member,
    )
    await stream.__anext__()
    bus.publish("alice", "message.created", {"id": "personal"})
    bus.publish_group(owner, "message.created", {"id": "group"})
    assert '"personal"' in await stream.__anext__()
    assert '"group"' in await stream.__anext__()
    assert await stream.__anext__() == ": ping\n\n"
    await stream.aclose()
