"""`/api/threads*` and `/api/attachments/{id}` (doc 15 "Threads and messages", doc 08)."""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import select

from backend.db import tables as t


class FakeJev:
    def __init__(self):
        self.scheduled = []

    def schedule(self, delivery_id):
        self.scheduled.append(delivery_id)


class FakeHarness:
    """What the public routes use from the harness: bus, wakes, jev, job locks, settings."""

    def __init__(self, settings):
        import asyncio

        from backend.harness.bus import EventBus

        self.settings = settings
        self.bus = EventBus()
        self.woken = []
        self.jev = FakeJev()
        self._locks = {}
        self._asyncio = asyncio

    def wake(self, agent_id):
        self.woken.append(agent_id)

    def job_lock(self, agent_id):
        return self._locks.setdefault(agent_id, self._asyncio.Lock())

    def folder(self, agent):
        return Path(self.settings.FOLDERS_DIR) / str(agent.user_id) / agent.slug


@pytest.fixture
def app(make_app, tmp_path):
    app = make_app(
        FOLDERS_DIR=str(tmp_path / "folders"), ATTACHMENTS_DIR=str(tmp_path / "attachments")
    )
    app.state.harness = FakeHarness(app.state.settings)
    return app


async def setup_team(accounts, rows, conn, username="alice", domain_status="available"):
    user = await accounts.user(username, domain_status=domain_status)
    agents = {}
    threads = {}
    for slug, is_lead in (("lead", True), ("data", False), ("chart", False)):
        agent = await rows.agent(
            user,
            slug=slug,
            display_name=slug.title(),
            is_lead=is_lead,
            origin="lead" if is_lead else "starter",
        )
        thread = await rows.thread(user, kind="direct", member_key=slug, name=None)
        await rows.insert(t.thread_members, thread_id=thread, member_type="user", member_id=user)
        await rows.insert(t.thread_members, thread_id=thread, member_type="agent", member_id=agent)
        agents[slug], threads[slug] = agent, thread
    return user, agents, threads


async def test_list_threads(accounts, rows, conn):
    user, agents, threads = await setup_team(accounts, rows, conn)
    await rows.thread(user, kind="agent", member_key="data+lead", name=None)  # hidden
    await rows.message(
        threads["data"], sender_type="agent", sender_id=agents["data"], content={"text": "chào"}
    )
    from sqlalchemy import func

    await conn.execute(
        t.threads.update()
        .where(t.threads.c.id == threads["data"])
        .values(last_message_at=func.now() + func.make_interval(0, 0, 0, 0, 0, 1))
    )
    async with await accounts.login("alice") as c:
        r = await c.get("/api/threads")
    assert r.status_code == 200
    body = r.json()
    assert {th["kind"] for th in body} == {"direct"} and len(body) == 3
    data = next(th for th in body if th["id"] == str(threads["data"]))
    assert data["last_message"]["text"] == "chào" and data["unread"] == 1
    assert data["read_only"] is False and data["name"] is None
    member_types = sorted(m["type"] for m in data["members"])
    assert member_types == ["agent", "user"]
    agent_member = next(m for m in data["members"] if m["type"] == "agent")
    assert agent_member["slug"] == "data" and agent_member["display_name"] == "Data"
    assert body[0]["id"] == str(threads["data"])  # newest message first


async def test_create_and_patch_a_group(app, accounts, rows, conn):
    user, agents, _ = await setup_team(accounts, rows, conn)
    events = app.state.harness.bus.subscribe(user)
    async with await accounts.login("alice") as c:
        r = await c.post(
            "/api/threads",
            json={
                "name": "Nhóm báo cáo Q3",
                "agent_ids": [str(agents["data"]), str(agents["chart"])],
            },
        )
        assert r.status_code == 201, r.text
        group = r.json()
        assert group["kind"] == "group" and group["name"] == "Nhóm báo cáo Q3"
        assert len([m for m in group["members"] if m["type"] == "agent"]) == 2
        assert events.get_nowait()["type"] == "thread.updated"
        r = await c.patch(
            f"/api/threads/{group['id']}",
            json={
                "name": "Q3",
                "add_agent_ids": [str(agents["lead"])],
                "remove_agent_ids": [str(agents["chart"])],
            },
        )
        assert r.status_code == 200
        slugs = sorted(m["slug"] for m in r.json()["members"] if m["type"] == "agent")
        assert (r.json()["name"], slugs) == ("Q3", ["data", "lead"])
        r = await c.patch(
            f"/api/threads/{group['id']}", json={"remove_agent_ids": [str(agents["lead"])]}
        )
        assert r.status_code == 400  # a group keeps at least two agents
        r = await c.post("/api/threads", json={"name": "x", "agent_ids": [str(agents["data"])]})
        assert r.status_code == 400


async def test_patch_is_for_groups_only_and_agents_must_be_mine(accounts, rows, conn):
    _, agents, threads = await setup_team(accounts, rows, conn)
    _, bob_agents, _ = await setup_team(accounts, rows, conn, "bob")
    async with await accounts.login("alice") as c:
        r = await c.patch(f"/api/threads/{threads['data']}", json={"name": "x"})
        assert r.status_code == 400
        r = await c.post(
            "/api/threads",
            json={"name": "x", "agent_ids": [str(agents["data"]), str(bob_agents["data"])]},
        )
        assert r.status_code == 400


async def test_post_a_message_with_files(app, accounts, rows, conn, tmp_path):
    user, agents, threads = await setup_team(accounts, rows, conn)
    data_folder = tmp_path / "folders" / str(user) / "data"
    data_folder.mkdir(parents=True)
    async with await accounts.login("alice") as c:
        r = await c.post(
            f"/api/threads/{threads['data']}/messages",
            data={"text": "Bảng giá đây"},
            files=[
                ("files", ("bang-gia.xlsx", b"xlsx-bytes", "application/xlsx")),
                ("files", ("ảnh.png", b"png", "image/png")),
            ],
        )
    assert r.status_code == 201, r.text
    msg = r.json()
    assert msg["text"] == "Bảng giá đây" and msg["sender"]["type"] == "user"
    assert sorted(a["filename"] for a in msg["attachments"]) == ["bang-gia.xlsx", "ảnh.png"]
    stored = Path(tmp_path / "attachments" / str(msg["id"]) / "bang-gia.xlsx")
    assert stored.read_bytes() == b"xlsx-bytes"
    inbox = data_folder / "files" / "inbox" / f"m_{msg['id']}"
    assert (inbox / "bang-gia.xlsx").read_bytes() == b"xlsx-bytes"
    d = (await conn.execute(select(t.deliveries))).one()
    assert (d.agent_id, d.status) == (agents["data"], "pending")
    assert app.state.harness.woken == [agents["data"]]
    async with await accounts.login("alice") as c:
        att = msg["attachments"][0]
        r = await c.get(f"/api/attachments/{att['id']}")
        assert r.status_code == 200 and r.content in (b"xlsx-bytes", b"png")


async def test_post_message_rules(accounts, rows, conn, monkeypatch):
    from backend.messaging import attachments

    _, _, threads = await setup_team(accounts, rows, conn)
    monkeypatch.setattr(attachments, "MAX_BYTES", 5)
    async with await accounts.login("alice") as c:
        url = f"/api/threads/{threads['data']}/messages"
        assert (await c.post(url, data={})).status_code == 400  # nothing to send
        r = await c.post(url, files=[("files", ("big.bin", b"123456", "x"))])
        assert (r.status_code, r.json()["error"]) == (413, "file_too_large")
        r = await c.post(url, data={"text": "x", "choice_id": "pdf", "reply_to": "abc"})
        assert r.status_code == 400
    await conn.execute(
        t.threads.update().where(t.threads.c.id == threads["data"]).values(read_only=True)
    )
    async with await accounts.login("alice") as c:
        r = await c.post(f"/api/threads/{threads['data']}/messages", data={"text": "x"})
        assert (r.status_code, r.json()["error"]) == (409, "thread_read_only")


async def test_choice_click_is_a_normal_user_message(accounts, rows, conn):
    _, agents, threads = await setup_team(accounts, rows, conn)
    prompt = await rows.message(
        threads["data"],
        sender_type="agent",
        sender_id=agents["data"],
        content={"text": "Định dạng?", "choices": [{"id": "pdf", "label": "PDF"}]},
    )
    async with await accounts.login("alice") as c:
        r = await c.post(
            f"/api/threads/{threads['data']}/messages",
            data={"text": "PDF", "choice_id": "pdf", "reply_to": str(prompt)},
        )
    assert r.status_code == 201
    assert (r.json()["choice_id"], r.json()["reply_to"]) == ("pdf", prompt)


async def test_domain_unavailable_users_cannot_post(accounts, rows, conn):
    _, _, threads = await setup_team(accounts, rows, conn, domain_status="unavailable")
    async with await accounts.login("alice") as c:
        r = await c.post(f"/api/threads/{threads['data']}/messages", data={"text": "x"})
    assert (r.status_code, r.json()["error"]) == (503, "domain_unavailable")


async def test_messages_page_newest_last_and_read_marks(accounts, rows, conn):
    _user, agents, threads = await setup_team(accounts, rows, conn)
    ids = [
        await rows.message(
            threads["data"],
            sender_type="agent",
            sender_id=agents["data"],
            content={"text": f"m{i}"},
        )
        for i in range(5)
    ]
    async with await accounts.login("alice") as c:
        r = await c.get(f"/api/threads/{threads['data']}/messages", params={"limit": 2})
        assert [m["text"] for m in r.json()] == ["m3", "m4"]
        r = await c.get(
            f"/api/threads/{threads['data']}/messages", params={"limit": 2, "before": ids[3]}
        )
        assert [m["text"] for m in r.json()] == ["m1", "m2"]
        r = await c.post(f"/api/threads/{threads['data']}/read", json={"message_id": ids[4]})
        assert r.status_code == 204
        listing = (await c.get("/api/threads")).json()
    data = next(th for th in listing if th["id"] == str(threads["data"]))
    assert data["unread"] == 0


async def test_other_users_threads_and_attachments_are_404(accounts, rows, conn, tmp_path):
    _, agents, threads = await setup_team(accounts, rows, conn)
    await setup_team(accounts, rows, conn, "bob")
    msg = await rows.message(threads["data"], sender_type="agent", sender_id=agents["data"])
    path = tmp_path / "a.txt"
    path.write_text("secret")
    att = await rows.insert(
        t.attachments,
        message_id=msg,
        filename="a.txt",
        mime="text/plain",
        size=6,
        sha256="a" * 64,
        path=str(path),
    )
    async with await accounts.login("bob") as c:
        assert (await c.get(f"/api/threads/{threads['data']}/messages")).status_code == 404
        assert (
            await c.post(f"/api/threads/{threads['data']}/messages", data={"text": "x"})
        ).status_code == 404
        assert (await c.get(f"/api/attachments/{att}")).status_code == 404
