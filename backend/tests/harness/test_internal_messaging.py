"""`send_to_user` and `send_to_agent` over the internal API (doc 08, doc 15 "Internal API")."""

from __future__ import annotations

import hashlib
import time
from pathlib import Path

import httpx
import pytest
from sqlalchemy import func, select

from backend.api.internal import create_internal_app
from backend.db import tables as t
from backend.harness.tokens import ExecContext, sign


@pytest.fixture
def internal(make_harness, team, settings, tmp_path):
    settings.ATTACHMENTS_DIR = str(tmp_path / "attachments")
    h = make_harness()
    h.woken, h.jev_scheduled = [], []
    h.wake = h.woken.append
    h.jev.schedule = h.jev_scheduled.append
    app = create_internal_app(h)

    def call(agent, *, compacting=False, default_thread=None):
        exec_id = f"x_{agent.slug}_{time.monotonic_ns()}"
        ctx = ExecContext(
            agent_id=agent.id,
            user_id=team.user,
            slug=agent.slug,
            is_lead=agent.is_lead,
            exec_id=exec_id,
            trace_id="a" * 32,
            activation_kind="message",
            task_id=None,
            default_thread=default_thread or f"direct:{agent.slug}",
            folder=str(h.folder(agent)),
            compacting=compacting,
        )
        h.registry.start(ctx, now=time.time())
        token = sign(
            settings.SESSION_SECRET.get_secret_value(), agent.id, exec_id, exp=int(time.time()) + 60
        )
        client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://internal",
            headers={"Authorization": f"Bearer {token}"},
        )
        client.exec_id = exec_id
        return client

    call.h = h
    return call


async def messages_in(conn, thread_id):
    return (
        await conn.execute(
            select(t.messages).where(t.messages.c.thread_id == thread_id).order_by(t.messages.c.id)
        )
    ).all()


# --- send_to_user -------------------------------------------------------------------------


async def test_send_to_user_posts_in_the_direct_thread(conn, team, internal):
    folder = internal.h.folder(team.data)
    (folder / "files").mkdir(parents=True, exist_ok=True)
    (folder / "files" / "chart.png").write_bytes(b"\x89PNG data")
    events = internal.h.bus.subscribe(team.user)
    async with internal(team.data) as c:
        r = await c.post(
            "/internal/v1/send_to_user",
            json={
                "text": "Kết quả",
                "files": ["files/chart.png"],
                "choices": [{"id": "pdf", "label": "PDF"}],
                "thread": "direct:data",
                "final": True,
            },
        )
    assert r.status_code == 200, r.text
    msg_id = r.json()["message_id"]
    m = (await messages_in(conn, team.threads["data"]))[-1]
    assert m.id == msg_id and (m.sender_type, m.sender_id) == ("agent", team.data.id)
    assert m.content["text"] == "Kết quả" and m.content["choices"] == [
        {"id": "pdf", "label": "PDF"}
    ]
    assert m.trace_id == "a" * 32 and m.exec_id == c.exec_id
    att = (
        await conn.execute(select(t.attachments).where(t.attachments.c.message_id == msg_id))
    ).one()
    stored = Path(att.path)
    assert stored == Path(internal.h.settings.ATTACHMENTS_DIR) / str(msg_id) / "chart.png"
    assert stored.read_bytes() == b"\x89PNG data"
    assert att.sha256 == hashlib.sha256(b"\x89PNG data").hexdigest() and att.size == 9
    assert att.mime == "image/png"
    # final=True is recorded against the exec
    assert internal.h.registry.final_requested(c.exec_id)
    created = events.get_nowait()
    assert created["type"] == "message.created"
    assert created["data"]["attachments"][0]["filename"] == "chart.png"
    # the agent's own direct thread: no agent receives it
    assert await conn.scalar(select(func.count()).select_from(t.deliveries)) == 0


async def test_send_to_user_defaults_to_the_activation_thread(conn, team, internal):
    async with internal(team.data, default_thread="direct:data") as c:
        r = await c.post("/internal/v1/send_to_user", json={"text": "x"})
    assert r.status_code == 200
    assert (await messages_in(conn, team.threads["data"]))[-1].content["text"] == "x"


async def test_send_to_user_in_a_group_reaches_the_other_agents(conn, rows, team, internal):
    group = await rows.thread(team.user, kind="group", name="G")
    for member_type, member in (
        ("user", team.user),
        ("agent", team.lead.id),
        ("agent", team.data.id),
    ):
        await rows.insert(
            t.thread_members, thread_id=group, member_type=member_type, member_id=member
        )
    async with internal(team.data) as c:
        r = await c.post(
            "/internal/v1/send_to_user", json={"text": "kết quả", "thread": f"group:{group}"}
        )
    assert r.status_code == 200
    d = (await conn.execute(select(t.deliveries))).one()
    assert (d.agent_id, d.route) == (team.lead.id, "jev")
    assert internal.h.jev_scheduled == [d.id]


@pytest.mark.parametrize(
    "body,status,code",
    [
        ({"text": "x", "thread": "agent:data+lead"}, 400, "invalid_thread"),
        ({"text": "x", "thread": "direct:lead"}, 400, "invalid_thread"),  # not a member
        ({"text": "x", "thread": "direct:nope"}, 400, "invalid_thread"),
        ({"text": "x", "files": ["files/missing.csv"]}, 400, "invalid_file"),
        ({"text": "x", "files": ["../../etc/passwd"]}, 400, "invalid_file"),
        ({"text": "x", "files": [f"f{i}" for i in range(11)]}, 400, "invalid_file"),
        (
            {"text": "x", "choices": [{"id": str(i), "label": "c"} for i in range(7)]},
            400,
            "invalid_request",
        ),
        ({"text": "x", "reports": ["R9-v1"]}, 400, "invalid_request"),
        ({}, 400, "invalid_request"),
    ],
)
async def test_send_to_user_validation(rows, team, internal, body, status, code):
    await rows.thread(team.user, kind="agent", member_key="data+lead", name=None)
    async with internal(team.data) as c:
        r = await c.post("/internal/v1/send_to_user", json=body)
    assert (r.status_code, r.json()["error"]) == (status, code)


async def test_files_over_the_size_limit(team, internal, monkeypatch):
    from backend.messaging import attachments

    monkeypatch.setattr(attachments, "MAX_BYTES", 10)
    folder = internal.h.folder(team.data)
    (folder / "big.bin").write_bytes(b"x" * 11)
    async with internal(team.data) as c:
        r = await c.post("/internal/v1/send_to_user", json={"text": "x", "files": ["big.bin"]})
    assert (r.status_code, r.json()["error"]) == (413, "file_too_large")


async def test_report_refs(conn, rows, team, internal):
    report = await rows.insert(
        t.reports,
        user_id=team.user,
        code="R7",
        title="Phân tích Q3",
        type="unit-analysis",
        agent_id=team.data.id,
    )
    await rows.insert(
        t.report_versions,
        report_id=report,
        sequence=1,
        schema={},
        source={},
        policy_version="1",
        content_revision="a",
        trace_id="0" * 32,
    )
    async with internal(team.data) as c:
        r = await c.post(
            "/internal/v1/send_to_user", json={"text": "Báo cáo", "reports": ["R7-v1"]}
        )
    assert r.status_code == 200, r.text
    m = (await messages_in(conn, team.threads["data"]))[-1]
    assert m.content["report_refs"] == [
        {"report_id": "R7", "version_id": "R7-v1", "title": "Phân tích Q3"}
    ]


async def test_messaging_is_disabled_during_compaction(team, internal):
    async with internal(team.data, compacting=True) as c:
        r = await c.post("/internal/v1/send_to_user", json={"text": "x"})
        assert (r.status_code, r.json()["error"]) == (409, "compacting")
        r = await c.post("/internal/v1/send_to_agent", json={"receivers": ["lead"], "content": "x"})
        assert r.status_code == 409


async def test_read_only_thread(conn, team, internal):
    await conn.execute(
        t.threads.update().where(t.threads.c.id == team.threads["data"]).values(read_only=True)
    )
    async with internal(team.data) as c:
        r = await c.post("/internal/v1/send_to_user", json={"text": "x"})
    assert (r.status_code, r.json()["error"]) == (409, "thread_read_only")


# --- send_to_agent ------------------------------------------------------------------------


async def test_send_to_agent_creates_the_agent_thread_once(conn, team, internal):
    async with internal(team.lead) as c:
        r1 = await c.post(
            "/internal/v1/send_to_agent", json={"receivers": ["data"], "content": "Lấy số liệu"}
        )
        r2 = await c.post(
            "/internal/v1/send_to_agent", json={"receivers": ["data"], "content": "Thêm nữa"}
        )
    assert r1.status_code == r2.status_code == 200
    thread = (await conn.execute(select(t.threads).where(t.threads.c.kind == "agent"))).one()
    assert thread.member_key == "data+lead"
    members = (
        await conn.execute(
            select(t.thread_members.c.member_type, t.thread_members.c.member_id).where(
                t.thread_members.c.thread_id == thread.id
            )
        )
    ).all()
    assert sorted(members) == sorted([("agent", team.lead.id), ("agent", team.data.id)])
    deliveries = (await conn.execute(select(t.deliveries.c.agent_id, t.deliveries.c.route))).all()
    assert deliveries == [(team.data.id, "notification")] * 2
    assert internal.h.woken == [team.data.id, team.data.id]


async def test_an_agent_message_to_the_lead_goes_through_jev(conn, team, internal):
    async with internal(team.data) as c:
        r = await c.post(
            "/internal/v1/send_to_agent", json={"receivers": ["lead"], "content": "Xong"}
        )
    assert r.status_code == 200
    d = (await conn.execute(select(t.deliveries))).one()
    assert (d.agent_id, d.route, d.status) == (team.lead.id, "jev", "classifying")


async def test_files_are_copied_into_the_receivers_inbox(conn, team, internal):
    src = internal.h.folder(team.data) / "files"
    src.mkdir(parents=True, exist_ok=True)
    (src / "units.csv").write_text("unit,price\n")
    async with internal(team.data) as c:
        r = await c.post(
            "/internal/v1/send_to_agent",
            json={"receivers": ["lead"], "content": "Xong", "files": ["files/units.csv"]},
        )
    msg = r.json()["message_id"]
    copied = internal.h.folder(team.lead) / "files" / "inbox" / f"m_{msg}" / "units.csv"
    assert copied.read_text() == "unit,price\n"
    att = (await conn.execute(select(t.attachments))).one()
    assert att.filename == "units.csv"


@pytest.mark.parametrize(
    "body,code",
    [
        ({"receivers": ["nope"], "content": "x"}, "invalid_receiver"),
        ({"receivers": ["data"], "content": "x"}, "invalid_receiver"),  # the sender itself
        ({"receivers": [], "content": "x"}, "invalid_request"),
    ],
)
async def test_send_to_agent_validation(team, internal, body, code):
    async with internal(team.data) as c:
        r = await c.post("/internal/v1/send_to_agent", json=body)
    assert (r.status_code, r.json()["error"]) == (400, code)


async def test_send_to_agent_into_a_group(conn, rows, team, internal):
    chart = await rows.agent(team.user, slug="chart")
    group = await rows.thread(team.user, kind="group", name="G")
    for member_type, member in (
        ("user", team.user),
        ("agent", team.lead.id),
        ("agent", team.data.id),
        ("agent", chart),
    ):
        await rows.insert(
            t.thread_members, thread_id=group, member_type=member_type, member_id=member
        )
    async with internal(team.data) as c:
        bad = await c.post(
            "/internal/v1/send_to_agent",
            json={"receivers": ["chart"], "content": "x", "thread": f"group:{group}"},
        )
        assert (bad.status_code, bad.json()["error"]) == (400, "invalid_receiver")
        ok = await c.post(
            "/internal/v1/send_to_agent",
            json={"receivers": ["chart", "lead"], "content": "x", "thread": f"group:{group}"},
        )
        assert ok.status_code == 200
        direct = await c.post(
            "/internal/v1/send_to_agent",
            json={"receivers": ["lead"], "content": "x", "thread": "direct:data"},
        )
        assert (direct.status_code, direct.json()["error"]) == (400, "invalid_thread")
    receivers = (await conn.execute(select(t.deliveries.c.agent_id))).scalars().all()
    assert sorted(receivers) == sorted([chart, team.lead.id])


async def test_choices_create_an_action_required_notification(conn, team, internal):
    async with internal(team.data) as c:
        r = await c.post(
            "/internal/v1/send_to_user",
            json={"text": "Xuất định dạng nào?", "choices": [{"id": "pdf", "label": "PDF"}]},
        )
    assert r.status_code == 200
    note = (await conn.execute(select(t.user_notifications))).one()
    assert note.kind == "action-required"
    assert note.target == {"kind": "chat", "conversationId": str(team.threads["data"])}
    assert "Xuất định dạng" not in str(note.summary)  # agent text is never copied in
