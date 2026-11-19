"""Group streams check committed membership again for each public event."""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from backend import groups
from backend.api.stream import sse_events
from backend.db import tables as t
from backend.harness.bus import EventBus


class OpenRequest:
    async def is_disconnected(self) -> bool:
        return False


@pytest.fixture
def app(make_app):
    app = make_app()
    app.state.harness = SimpleNamespace(bus=EventBus(), jobs=SimpleNamespace(kick=lambda: None))
    return app


async def test_removed_member_existing_stream_drops_room_event(app, accounts, conn):
    await accounts.user("alice")
    bob = await accounts.user("bobby")
    async with await accounts.login("alice") as client:
        created = await client.post("/api/groups", json={"name": "Sales Team"})
        assert created.status_code == 202
        group = created.json()["group"]
        assert (
            await client.post(f"/api/groups/{group['id']}/members", json={"user_id": str(bob)})
        ).status_code == 201
    owner = await conn.scalar(
        select(t.groups.c.technical_owner_id).where(t.groups.c.id == uuid.UUID(group["id"]))
    )

    async def still_member(group_owner):
        return await groups.is_current_member(conn, group_owner, bob)

    bus = app.state.harness.bus
    stream = sse_events(
        bus,
        bob,
        OpenRequest(),
        heartbeat_s=0.01,
        group_owners=(owner,),
        still_member=still_member,
    )
    await stream.__anext__()
    bus.publish_group(owner, "message.created", {"text": "before"})
    assert "before" in await stream.__anext__()
    async with await accounts.login("alice") as client:
        assert (await client.delete(f"/api/groups/{group['id']}/members/{bob}")).status_code == 204
    bus.publish_group(owner, "message.created", {"text": "after"})
    assert "groups.changed" in await stream.__anext__()
    assert await stream.__anext__() == ": ping\n\n"
    assert bus._groups[str(owner)] == set()
    await stream.aclose()
