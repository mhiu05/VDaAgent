"""Input items (doc 06 "Input items") and readable thread ids."""

from __future__ import annotations

from datetime import UTC, datetime

from backend.db import tables as t
from backend.harness import items
from backend.tests.harness.conftest import user_message

AT = datetime(2026, 10, 17, 3, 2, 5, tzinfo=UTC)  # 10:02:05 local


def test_notification_block():
    text = items.notification(
        delivery_id=981,
        sender="user:alice",
        thread="direct:data",
        message_id=5521,
        at=AT,
        text="Lấy giúp bảng giá dự án 100.",
        attachments=["files/inbox/m_5521/bang-gia.xlsx"],
    )
    assert text == (
        '<notification id="d_981" from="user:alice" thread="direct:data" message="m_5521" '
        'at="10:02:05">\n'
        "Lấy giúp bảng giá dự án 100.\n"
        "attachments: files/inbox/m_5521/bang-gia.xlsx\n"
        "</notification>"
    )


def test_group_notification_has_the_name_and_choice():
    text = items.notification(
        delivery_id=1,
        sender="agent:lead",
        thread="group:abc",
        thread_name='Nhóm "Q3"',
        message_id=2,
        at=AT,
        text="hi",
        choice_id="pdf",
    )
    assert 'thread="group:abc" name="Nhóm &quot;Q3&quot;"' in text
    assert "choice: pdf" in text


def test_notice_routine_and_begin_task():
    assert items.notice(delivery_id=990, kind="builder", at=AT, text="Kỹ năng mới: xlsx") == (
        '<notice id="d_990" kind="builder" at="10:02:05">Kỹ năng mới: xlsx</notice>'
    )
    assert items.routine(name="bao-cao-sang", fired_at=AT, prompt="Tóm tắt") == (
        '<routine name="bao-cao-sang" fired_at="10:02:05">\nTóm tắt\n</routine>'
    )
    assert items.begin_task(
        task_id=42,
        source_message=5520,
        thread="direct:lead",
        description="Phân tích",
        original="Vì sao?",
    ) == (
        '<begin_task id="T42" source_message="m_5520" thread="direct:lead">\n'
        "Phân tích\n--- original message ---\nVì sao?\n</begin_task>"
    )


async def test_readable_thread_ids(conn, rows, team):
    direct = await items.readable_thread(conn, team.threads["data"])
    assert direct == ("direct:data", None)
    group = await rows.thread(team.user, kind="group", name="Nhóm báo cáo")
    assert await items.readable_thread(conn, group) == (f"group:{group}", "Nhóm báo cáo")
    agent_thread = await rows.thread(team.user, kind="agent", member_key="data+lead", name=None)
    assert await items.readable_thread(conn, agent_thread) == ("agent:data+lead", None)


async def test_resolve_readable_thread(conn, rows, team):
    assert await items.resolve_thread(conn, team.user, "direct:data") == team.threads["data"]
    group = await rows.thread(team.user, kind="group", name="G")
    assert await items.resolve_thread(conn, team.user, f"group:{group}") == group
    assert await items.resolve_thread(conn, team.user, str(group)) == group
    assert await items.resolve_thread(conn, team.user, "direct:nope") is None
    assert await items.resolve_thread(conn, team.user, "garbage") is None


async def test_delivery_items_from_rows(conn, rows, team):
    msg, d = await user_message(rows, team, "data", "Xin số liệu")
    await rows.insert(
        t.attachments,
        message_id=msg,
        filename="a.xlsx",
        mime="x",
        size=1,
        sha256="a" * 64,
        path=f"/data/attachments/{msg}/a.xlsx",
    )
    notice = await rows.insert(
        t.deliveries,
        agent_id=team.data.id,
        route="notification",
        status="pending",
        notice={"kind": "builder", "text": "Kỹ năng"},
    )
    work = await items.pending_deliveries_work(conn, team.data)
    assert work is not None and work.kind == "message"
    assert work.delivery_ids == [d, notice]
    assert work.items[0] == {"type": "notification", "delivery_id": d, "message_id": msg}
    assert work.items[1] == {"type": "notice", "delivery_id": notice, "kind": "builder"}
    assert f'from="user:alice" thread="direct:data" message="m_{msg}"' in work.blocks[0]
    assert f"attachments: files/inbox/m_{msg}/a.xlsx" in work.blocks[0]
    assert work.blocks[1].startswith(f'<notice id="d_{notice}" kind="builder"')
    assert work.default_thread == "direct:data"  # the newest delivery from the user


async def test_default_thread_without_user_input_is_the_direct_thread(conn, rows, team):
    await rows.insert(
        t.deliveries,
        agent_id=team.data.id,
        route="notification",
        status="pending",
        notice={"kind": "builder", "text": "x"},
    )
    work = await items.pending_deliveries_work(conn, team.data)
    assert work.default_thread == "direct:data"


async def test_classifying_deliveries_are_ignored(conn, rows, team):
    await user_message(rows, team, "lead", "x", route="jev", status="classifying")
    assert await items.pending_deliveries_work(conn, team.lead) is None
