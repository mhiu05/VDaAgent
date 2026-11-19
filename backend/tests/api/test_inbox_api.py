"""User notifications and preferences (doc 19 "User notifications", "Preferences")."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select

from backend.db import tables as t
from backend.notifications import notify


class FakeHarness:
    def __init__(self):
        from backend.harness.bus import EventBus

        self.bus = EventBus()


@pytest.fixture
def app(make_app):
    app = make_app()
    app.state.harness = FakeHarness()
    return app


async def test_inbox_newest_first_with_access(accounts, rows, conn):
    alice = await accounts.user("alice")
    agent = await rows.agent(alice, slug="data")
    await rows.insert(t.reports, user_id=alice, code="R1", title="x", type="x", agent_id=agent)
    thread = await rows.thread(alice, kind="direct", member_key="data", name=None)
    base = datetime.now(UTC)
    for i, (template, target, params) in enumerate(
        [
            (
                "report_ready",
                {"kind": "report", "reportId": "R1", "versionId": "R1-v1"},
                {"report": "R1", "version": "R1-v1"},
            ),
            ("report_failed", {"kind": "report", "reportId": "R9"}, {"report": "R9"}),
            ("action_required", {"kind": "chat", "conversationId": str(thread)}, {}),
        ]
    ):
        nid = await notify(conn, alice, template, target=target, params=params)
        await conn.execute(
            t.user_notifications.update()
            .where(t.user_notifications.c.id == nid)
            .values(occurred_at=base + timedelta(minutes=i))
        )
    async with await accounts.login("alice") as c:
        body = (await c.get("/api/notifications")).json()
    assert [n["kind"] for n in body] == ["action-required", "task-failed", "report-ready"]
    access = {n["kind"]: n["access"] for n in body}
    assert access == {
        "action-required": "available",
        "task-failed": "missing",
        "report-ready": "available",
    }
    ready = next(n for n in body if n["kind"] == "report-ready")
    assert ready["title"] == {"vi": "Báo cáo đã sẵn sàng", "en": "Your report is ready"}
    assert "R1-v1" in ready["summary"]["vi"] and ready["readAt"] is None
    assert set(ready) == {
        "id",
        "kind",
        "title",
        "summary",
        "occurredAt",
        "readAt",
        "target",
        "access",
    }


async def test_mark_read(app, accounts, conn):
    alice = await accounts.user("alice")
    ids = [
        str(
            await notify(
                conn,
                alice,
                "report_ready",
                target={"kind": "account"},
                params={"report": "R1", "version": "R1-v1"},
            )
        )
        for _ in range(3)
    ]
    events = app.state.harness.bus.subscribe(alice)
    async with await accounts.login("alice") as c:
        r = await c.post("/api/notifications/read", json={"ids": ids[:1]})
        assert r.status_code == 200
        assert {n["id"] for n in r.json() if n["readAt"]} == {ids[0]}
        assert events.get_nowait() == {"type": "notification.read", "data": {"ids": ids[:1]}}
        r = await c.post("/api/notifications/read", json={})
        assert all(n["readAt"] for n in r.json())
        assert events.get_nowait() == {"type": "notification.read", "data": {"all": True}}
        bad = await c.post("/api/notifications/read", json={"ids": ["not-a-uuid"]})
        assert bad.status_code == 400


async def test_other_users_notifications_are_invisible(accounts, conn):
    alice = await accounts.user("alice")
    await accounts.user("bob")
    nid = await notify(
        conn,
        alice,
        "report_ready",
        target={"kind": "account"},
        params={"report": "R1", "version": "R1-v1"},
    )
    async with await accounts.login("bob") as c:
        assert all(n["id"] != str(nid) for n in (await c.get("/api/notifications")).json())
        await c.post("/api/notifications/read", json={"ids": [str(nid)]})
    assert (
        await conn.scalar(
            select(t.user_notifications.c.read_at).where(t.user_notifications.c.id == nid)
        )
        is None
    )


async def test_retention_keeps_the_500_newest(conn, rows):
    from backend.notifications import prune

    alice = await rows.user(username="alice")
    base = datetime.now(UTC)
    await conn.execute(
        t.user_notifications.insert(),
        [
            {
                "user_id": alice,
                "kind": "system",
                "title": {"vi": "x", "en": "x"},
                "summary": {"vi": "x", "en": "x"},
                "target": {"kind": "account"},
                "occurred_at": base - timedelta(minutes=i),
            }
            for i in range(505)
        ],
    )
    assert await prune(conn) == 5
    assert await conn.scalar(select(func.count()).select_from(t.user_notifications)) == 500


async def test_preferences_round_trip(accounts, conn):
    alice = await accounts.user("alice", display_name="")
    async with await accounts.login("alice") as c:
        first = (await c.get("/api/me/preferences")).json()
        assert first == {
            "displayName": "",
            "locale": "vi",
            "theme": "light",
            "timezone": "Asia/Ho_Chi_Minh",
            "motion": "system",
            "density": "comfortable",
            "notifications": {"reports": True, "tasks": True, "system": True},
            "semanticExplanation": False,
        }
        prefs = {
            **first,
            "displayName": "Alice N.",
            "locale": "en",
            "theme": "dark",
            "notifications": {"reports": False, "tasks": True, "system": True},
            "semanticExplanation": True,
        }
        r = await c.put("/api/me/preferences", json=prefs)
        assert r.status_code == 200 and r.json() == prefs
        assert (await c.get("/api/me/preferences")).json() == prefs
        assert (await c.get("/api/auth/me")).json()["display_name"] == "Alice N."
        r = await c.put("/api/me/preferences", json={**prefs, "semanticExplanation": False})
        assert r.status_code == 200 and r.json()["semanticExplanation"] is False
        for bad in (
            {**prefs, "displayName": ""},
            {**prefs, "theme": "neon"},
            {**prefs, "timezone": "Mars/Base"},
            {**prefs, "displayName": "x" * 101},
            {**prefs, "notifications": {"reports": "yes", "tasks": True, "system": True}},
            {**prefs, "semanticExplanation": "maybe"},
        ):
            assert (await c.put("/api/me/preferences", json=bad)).status_code == 400
    # the reports group is off now: report-ready isn't created
    assert (
        await notify(
            conn,
            alice,
            "report_ready",
            target={"kind": "account"},
            params={"report": "R1", "version": "R1-v1"},
        )
        is None
    )
