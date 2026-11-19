"""Routines (doc 09; decision 0003)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import select, update

from backend.db import tables as t
from backend.harness import routines
from backend.harness.runner import AgentRunner
from backend.tests.harness.conftest import events_of

ROUTINE = 'prompt: |\n  Tóm tắt các căn mới.\ncron: "0 8 * * 1-5"\nenabled: true\n'


def write(folder: Path, name: str, text: str) -> None:
    (folder / "routines").mkdir(parents=True, exist_ok=True)
    (folder / "routines" / f"{name}.yaml").write_text(text)


# --- parsing and cron ---------------------------------------------------------------------


def test_parse_a_valid_file(tmp_path):
    write(tmp_path, "bao-cao-sang", ROUTINE)
    r = routines.parse(tmp_path / "routines" / "bao-cao-sang.yaml")
    assert (r.name, r.cron, r.enabled, r.error) == ("bao-cao-sang", "0 8 * * 1-5", True, None)
    assert r.prompt.strip() == "Tóm tắt các căn mới." and len(r.sha) == 64


@pytest.mark.parametrize(
    "name,text,error",
    [
        ("ok-name", "prompt: [unclosed", "yaml"),
        ("ok-name", 'prompt: x\ncron: "61 * * * *"\n', "cron"),
        ("ok-name", 'cron: "0 8 * * *"\n', "prompt"),
        ("ok-name", 'prompt: x\ncron: "0 8 * * *"\nenabled: maybe\n', "enabled"),
        ("Bad_Name", ROUTINE, "name"),
        ("x", ROUTINE, "name"),
    ],
)
def test_invalid_files(tmp_path, name, text, error):
    write(tmp_path, name, text)
    r = routines.parse(tmp_path / "routines" / f"{name}.yaml")
    assert r.error and error in r.error


def test_next_fire_is_in_ho_chi_minh_time():
    # Friday 2026-10-16 09:00 local = 02:00 UTC; next weekday 08:00 local is Monday 01:00 UTC
    after = datetime(2026, 10, 16, 2, 0, tzinfo=UTC)
    assert routines.next_fire("0 8 * * 1-5", after) == datetime(2026, 10, 19, 1, 0, tzinfo=UTC)
    assert routines.next_fire("*/30 * * * *", after) == datetime(2026, 10, 16, 2, 30, tzinfo=UTC)


# --- syncing routine_state ------------------------------------------------------------------


async def test_sync_inserts_updates_and_deletes_rows(conn, make_harness, team):
    h = make_harness()
    folder = h.folder(team.data)
    write(folder, "sang", ROUTINE)
    write(folder, "chieu", ROUTINE.replace("0 8", "0 17"))
    async with h.db() as c:
        await routines.sync(h, c, team.data)
    rows = {r.name: r for r in (await conn.execute(select(t.routine_state))).all()}
    assert set(rows) == {"sang", "chieu"}
    assert rows["sang"].next_fire_at is not None and rows["sang"].pending is False
    first_next = rows["chieu"].next_fire_at
    (folder / "routines" / "sang.yaml").unlink()
    write(folder, "chieu", ROUTINE.replace("0 8", "30 18"))
    async with h.db() as c:
        await routines.sync(h, c, team.data)
    rows = {r.name: r for r in (await conn.execute(select(t.routine_state))).all()}
    assert set(rows) == {"chieu"}
    assert rows["chieu"].cron == "30 18 * * 1-5" and rows["chieu"].next_fire_at != first_next


async def test_invalid_file_gets_one_notice_per_content(conn, make_harness, team):
    h = make_harness()
    h.wake = lambda a: None
    folder = h.folder(team.data)
    write(folder, "hong", 'prompt: x\ncron: "bad"\n')
    for _ in range(2):
        async with h.db() as c:
            await routines.sync(h, c, team.data)
    notices = (await conn.execute(select(t.deliveries.c.notice))).scalars().all()
    assert len(notices) == 1 and notices[0]["kind"] == "routine_invalid"
    assert "hong" in notices[0]["text"]
    write(folder, "hong", 'prompt: y\ncron: "bad"\n')  # new content → a new notice
    async with h.db() as c:
        await routines.sync(h, c, team.data)
    assert len((await conn.execute(select(t.deliveries.c.notice))).scalars().all()) == 2
    assert (await conn.execute(select(t.routine_state))).first() is None


# --- firing ---------------------------------------------------------------------------------


async def due(conn, agent_id, name, minutes_ago=1, **kw):
    await conn.execute(
        t.routine_state.insert().values(
            agent_id=agent_id,
            name=name,
            cron="0 8 * * *",
            enabled=kw.pop("enabled", True),
            prompt_sha="a" * 64,
            next_fire_at=datetime.now(UTC) - timedelta(minutes=minutes_ago),
            **kw,
        )
    )


async def test_fire_due_marks_pending_and_advances(conn, make_harness, team):
    h = make_harness()
    woken = []
    h.wake = woken.append
    await due(conn, team.data.id, "sang")
    await due(conn, team.data.id, "tat", enabled=False)
    await routines.fire_due(h)
    rows = {r.name: r for r in (await conn.execute(select(t.routine_state))).all()}
    assert rows["sang"].pending is True and rows["sang"].last_fired_at is not None
    assert rows["sang"].next_fire_at > datetime.now(UTC)
    assert rows["tat"].pending is False
    assert woken == [team.data.id]


async def test_repeated_and_missed_fires_collapse_into_one(conn, make_harness, team):
    h = make_harness()
    h.wake = lambda a: None
    await due(conn, team.data.id, "sang", minutes_ago=60 * 24 * 3)  # missed three days
    await routines.fire_due(h)
    await conn.execute(
        update(t.routine_state).values(next_fire_at=datetime.now(UTC) - timedelta(seconds=1))
    )
    await routines.fire_due(h)  # fires again while still pending
    rows = (await conn.execute(select(t.routine_state))).all()
    assert len(rows) == 1 and rows[0].pending is True


async def test_a_pending_routine_runs_when_idle(conn, make_harness, team):
    h = make_harness("""
    agents:
      data:
        - match: {input_contains: "<routine name=\\"sang\\""}
          reply: {text: "đã tóm tắt"}
    """)
    write(h.folder(team.data), "sang", ROUTINE)
    await due(
        conn,
        team.data.id,
        "sang",
        pending=True,
        last_fired_at=datetime.now(UTC) - timedelta(minutes=1),
    )
    statuses = []
    q = h.bus.subscribe(team.user)
    await AgentRunner(h, team.data.id).run_until_idle()
    evs = await events_of(conn, team.data.id)
    assert [e.kind for e in evs] == ["input", "assistant"]
    assert evs[0].activation_kind == "routine"
    assert (
        '<routine name="sang"' in evs[0].payload["text"]
        and "Tóm tắt các căn mới" in evs[0].payload["text"]
    )
    assert evs[0].payload["items"] == [{"type": "routine", "name": "sang"}]
    row = (await conn.execute(select(t.routine_state))).one()
    assert row.pending is False and row.last_started_at and row.last_ended_at
    while not q.empty():
        e = q.get_nowait()
        if e["type"] == "agent.status":
            statuses.append((e["data"]["status"], e["data"]["status_detail"]))
    assert statuses[0] == ("routine", "sang")


async def test_deliveries_come_before_routines(conn, rows, make_harness, team):
    from backend.tests.harness.conftest import user_message

    h = make_harness()
    write(h.folder(team.data), "sang", ROUTINE)
    await due(conn, team.data.id, "sang", pending=True)
    await user_message(rows, team, "data", "trước")
    async with h.db() as c:
        agent = (await c.execute(select(t.agents).where(t.agents.c.id == team.data.id))).one()
        work = await h.next_work(c, agent)
    assert work.kind == "message"


async def test_oldest_due_routine_first(conn, make_harness, team):
    h = make_harness()
    folder = h.folder(team.data)
    write(folder, "moi", ROUTINE)
    write(folder, "cu", ROUTINE)
    now = datetime.now(UTC)
    await due(conn, team.data.id, "moi", pending=True, last_fired_at=now)
    await due(conn, team.data.id, "cu", pending=True, last_fired_at=now - timedelta(hours=1))
    async with h.db() as c:
        agent = (await c.execute(select(t.agents).where(t.agents.c.id == team.data.id))).one()
        work = await routines.routine_source(h, c, agent)
    assert work.status_detail == "cu"


async def test_a_pending_routine_whose_file_is_gone_is_dropped(conn, make_harness, team):
    h = make_harness()
    await due(conn, team.data.id, "mat", pending=True)
    async with h.db() as c:
        agent = (await c.execute(select(t.agents).where(t.agents.c.id == team.data.id))).one()
        assert await routines.routine_source(h, c, agent) is None
    assert (await conn.execute(select(t.routine_state))).first() is None
