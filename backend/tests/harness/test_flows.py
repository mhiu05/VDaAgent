"""Harness integration flows (doc 17 #1 golden flow, #2 group thread, #6 deadlock guard).

Everything is real except the model (FakeModel scenarios) and execd: `LocalExecd` runs each
exec as a real `python -c` subprocess in the agent folder with the real `contoso` helpers, which
call the real internal API over HTTP (served in-process on a localhost port). The full stack with
the `workspace` container is covered by the end-to-end tests (S13).
"""

from __future__ import annotations

import asyncio
import os
import socket
import subprocess
import sys
import textwrap
import time
from pathlib import Path

import pytest
import uvicorn
from sqlalchemy import select

from backend.api.internal import create_internal_app
from backend.db import tables as t
from backend.execd_client import ExecResult
from backend.harness.fake_model import FakeModelTransport, load_scenario
from backend.harness.model import ModelClient
from backend.harness.runtime import Harness
from backend.messaging.messages import post_message

REPO = Path(__file__).resolve().parents[3]
GOLDEN = REPO / "backend" / "tests" / "scenarios" / "golden.yaml"


class LocalExecd:
    """Runs code like execd does (cwd = folder, clean env + env_extra), without the container."""

    def __init__(self) -> None:
        self.calls: list[dict] = []

    async def exec(
        self, *, folder, exec_id, timeout_s, author, code=None, argv=None, env_extra=None
    ) -> ExecResult:
        self.calls.append({"folder": folder, "code": code, "author": author})
        env = {
            "PATH": os.environ["PATH"],
            "HOME": folder,
            "LANG": "C.UTF-8",
            "PYTHONPATH": str(REPO / "workspace"),
            **(env_extra or {}),
        }
        started = time.monotonic()
        proc = await asyncio.create_subprocess_exec(
            sys.executable,
            "-c",
            code,
            cwd=folder,
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout_s)
        finally:
            if proc.returncode is None:
                proc.kill()
                await proc.communicate()
        return ExecResult(
            exit_code=proc.returncode,
            stdout=out.decode(),
            stderr=err.decode(),
            duration_ms=int((time.monotonic() - started) * 1000),
            timed_out=False,
            truncated=False,
            head=None,
            changed=[],
            snapshot_error=None,
        )


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
async def stack(db, settings, tmp_path):
    """A harness with LocalExecd, the internal API on localhost, and a running supervisor."""
    servers = []

    async def start(scenario: str | Path) -> Harness:
        path = Path(scenario) if isinstance(scenario, Path) else tmp_path / "scenario.yaml"
        if not isinstance(scenario, Path):
            path.write_text(textwrap.dedent(scenario))
        port = free_port()
        settings.INTERNAL_URL = f"http://127.0.0.1:{port}"
        settings.ATTACHMENTS_DIR = str(tmp_path / "attachments")
        settings.RUNNER_POLL_S = 0.05
        # These tests exercise routing and completion; debounce has dedicated runner tests.
        settings.RUNNER_DEBOUNCE_S = 0
        model = ModelClient(
            base_url="http://fake/api/v1",
            api_key="",
            app_url="http://x",
            timeout_s=5,
            transport=FakeModelTransport(load_scenario(path)),
        )
        h = Harness(settings, db=db, execd=LocalExecd(), model=model)
        server = uvicorn.Server(
            uvicorn.Config(
                create_internal_app(h),
                host="127.0.0.1",
                port=port,
                log_level=None,
                log_config=None,
                lifespan="off",
            )
        )
        server.install_signal_handlers = lambda: None
        task = asyncio.create_task(server.serve())
        while not server.started:
            await asyncio.sleep(0.01)
        servers.append((server, task, h))
        await h.supervisor.start()
        return h

    yield start
    for server, task, h in servers:
        await h.supervisor.stop_all()
        await h.jev.drain()
        server.should_exit = True
        await task


@pytest.fixture(autouse=True)
def git_folders(team, settings):
    for slug in ("lead", "data"):
        folder = Path(settings.FOLDERS_DIR) / str(team.user) / slug
        subprocess.run(["git", "init", "-q", "-b", "main"], cwd=folder, check=True)


async def until(predicate, timeout=20.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if await predicate():
            return
        await asyncio.sleep(0.05)
    raise AssertionError("condition not reached in time")


async def all_idle(h, team):
    async with h.db() as conn:
        statuses = (
            (await conn.execute(select(t.agents.c.status).where(t.agents.c.user_id == team.user)))
            .scalars()
            .all()
        )
        pending = (
            (
                await conn.execute(
                    select(t.deliveries.c.status).where(t.deliveries.c.status != "consumed")
                )
            )
            .scalars()
            .all()
        )
        routine_pending = await conn.scalar(
            select(t.routine_state.c.agent_id)
            .join(t.agents, t.agents.c.id == t.routine_state.c.agent_id)
            .where(t.agents.c.user_id == team.user, t.routine_state.c.pending.is_(True))
            .limit(1)
        )
    return set(statuses) == {"idle"} and not pending and not routine_pending and not h.jev._tasks


async def scalar(h, stmt):
    async with h.db() as conn:
        return await conn.scalar(stmt)


async def settle(h, team):
    """Wait until every agent is idle with nothing pending, then stop the runners."""
    await until(lambda: all_idle(h, team))
    await h.supervisor.stop_all()
    await h.jev.drain()


async def test_golden_flow(conn, team, stack, settings):
    h = await stack(GOLDEN)
    events = h.bus.subscribe(team.user)
    async with h.db() as c:
        await post_message(
            h,
            c,
            thread_id=team.threads["lead"],
            sender_type="user",
            sender_id=team.user,
            trace_id="1" * 32,
            content={
                "text": "Vì sao căn MAS-U03832 bán chậm? So sánh với các căn "
                "tương đồng, vẽ biểu đồ và xuất báo cáo."
            },
        )

    async def task_done():
        return await scalar(h, select(t.global_tasks.c.status)) == "done"

    await until(task_done)
    await settle(h, team)

    task = (await conn.execute(select(t.global_tasks))).one()
    assert (task.outcome, task.ended_by) == ("đã trả lời", "lead")
    involved = (
        (
            await conn.execute(
                select(t.task_involvement.c.agent_id).where(t.task_involvement.c.task_id == task.id)
            )
        )
        .scalars()
        .all()
    )
    assert sorted(involved) == sorted([team.lead.id, team.data.id])

    # the user got the answer in the lead's direct thread, with the file attached
    answer = (
        await conn.execute(
            select(t.messages).where(
                t.messages.c.thread_id == team.threads["lead"], t.messages.c.sender_type == "agent"
            )
        )
    ).one()
    assert answer.content["text"].startswith("Kết quả: căn MAS-U03832")
    att = (
        await conn.execute(select(t.attachments).where(t.attachments.c.message_id == answer.id))
    ).one()
    assert att.filename == "units.csv" and Path(att.path).read_text().startswith("unit,price")
    import hashlib

    assert att.sha256 == hashlib.sha256(Path(att.path).read_bytes()).hexdigest()

    # lead ↔ data went through their agent thread; data's file reached the lead's inbox
    agent_thread = (await conn.execute(select(t.threads).where(t.threads.c.kind == "agent"))).one()
    assert agent_thread.member_key == "data+lead"
    lead_inbox = list(
        (Path(settings.FOLDERS_DIR) / str(team.user) / "lead" / "files" / "inbox").glob(
            "*/units.csv"
        )
    )
    assert len(lead_inbox) == 1

    # jev: the user's message was a task, data's reply a side question
    labels = (
        (await conn.execute(select(t.jev_decisions.c.label).order_by(t.jev_decisions.c.id)))
        .scalars()
        .all()
    )
    assert labels == ["task", "side_question"]

    # every delivery was consumed; trace ids on every agent message and event
    statuses = (await conn.execute(select(t.deliveries.c.status))).scalars().all()
    assert set(statuses) == {"consumed"}
    agent_msgs = (
        (
            await conn.execute(
                select(t.messages.c.trace_id).where(t.messages.c.sender_type == "agent")
            )
        )
        .scalars()
        .all()
    )
    assert agent_msgs and all(tid and len(tid) == 32 for tid in agent_msgs)
    lead_events = (
        (
            await conn.execute(
                select(t.events.c.activation_kind)
                .where(t.events.c.agent_id == team.lead.id, t.events.c.kind == "input")
                .order_by(t.events.c.seq)
            )
        )
        .scalars()
        .all()
    )
    assert lead_events == ["task", "message"]

    published = []
    while not events.empty():
        published.append(events.get_nowait()["type"])
    assert "message.created" in published and "task.updated" in published


async def test_group_thread(conn, rows, team, stack, settings):
    chart = await rows.agent(team.user, slug="chart", display_name="Chart")
    await rows.insert(
        t.agent_epochs,
        agent_id=chart,
        epoch=0,
        start_seq=0,
        system_prompt="SYSTEM chart",
        reason="initial",
    )
    chart_folder = Path(settings.FOLDERS_DIR) / str(team.user) / "chart"
    chart_folder.mkdir(parents=True)
    group = await rows.thread(team.user, kind="group", name="Nhóm báo cáo Q3")
    for member_type, member in (
        ("user", team.user),
        ("agent", team.lead.id),
        ("agent", team.data.id),
        ("agent", chart),
    ):
        await rows.insert(
            t.thread_members, thread_id=group, member_type=member_type, member_id=member
        )
    h = await stack(f"""
    agents:
      data:
        - match: {{input_contains: "Báo cáo Q3"}}
          reply: {{tool: "from contoso import send_to_user\\nsend_to_user('Số liệu Q3 đã có', thread='group:{group}', final=True)"}}
    jev:
      - label: side_question
    """)  # noqa: E501
    events = h.bus.subscribe(team.user)
    async with h.db() as c:
        await post_message(
            h,
            c,
            thread_id=group,
            sender_type="user",
            sender_id=team.user,
            content={"text": "Báo cáo Q3 thế nào?"},
        )

    async def data_replied():
        return (
            await scalar(
                h,
                select(t.messages.c.id).where(
                    t.messages.c.thread_id == group, t.messages.c.sender_type == "agent"
                ),
            )
            is not None
        )

    await until(data_replied)
    await settle(h, team)
    reply = await conn.scalar(
        select(t.messages.c.id).where(
            t.messages.c.thread_id == group, t.messages.c.sender_type == "agent"
        )
    )
    # the user's message reached all three agents (the lead's copy through jev) ...
    first = await conn.scalar(
        select(t.messages.c.id).where(
            t.messages.c.thread_id == group, t.messages.c.sender_type == "user"
        )
    )
    got = (
        await conn.execute(
            select(t.deliveries.c.agent_id, t.deliveries.c.route).where(
                t.deliveries.c.message_id == first
            )
        )
    ).all()
    assert sorted(got) == sorted(
        [(team.lead.id, "jev"), (team.data.id, "notification"), (chart, "notification")]
    )
    # ... and data's reply reached the other agents and the user
    got = (
        (
            await conn.execute(
                select(t.deliveries.c.agent_id).where(t.deliveries.c.message_id == reply)
            )
        )
        .scalars()
        .all()
    )
    assert sorted(got) == sorted([team.lead.id, chart])
    types = []
    statuses = set()
    while not events.empty():
        e = events.get_nowait()
        types.append(e["type"])
        if e["type"] == "agent.status":
            statuses.add((e["data"]["slug"], e["data"]["status"]))
    assert types.count("message.created") == 2
    assert {("data", "busy"), ("data", "idle"), ("chart", "busy")} <= statuses


async def _group_with_lead(rows, team):
    group = await rows.thread(team.user, kind="group", name="Nhóm")
    for member_type, member in (
        ("user", team.user),
        ("agent", team.lead.id),
        ("agent", team.data.id),
    ):
        await rows.insert(
            t.thread_members, thread_id=group, member_type=member_type, member_id=member
        )
    return group


async def _data_replies(h, thread_id):
    async with h.db() as c:
        return (
            (
                await c.execute(
                    select(t.messages.c.content)
                    .where(
                        t.messages.c.thread_id == thread_id,
                        t.messages.c.sender_type == "agent",
                    )
                    .order_by(t.messages.c.id)
                )
            )
            .scalars()
            .all()
        )


async def test_send_to_agent_does_not_suppress_the_final_user_answer(rows, team, stack):
    group = await _group_with_lead(rows, team)
    h = await stack(f"""
    agents:
      data:
        - match: {{input_contains: "Báo cáo"}}
          reply: {{tool: "from contoso import send_to_agent\\nsend_to_agent(['lead'], 'nhờ kiểm tra', thread='group:{group}')"}}
        - reply: {{text: "Kết quả cuối"}}
    jev:
      - label: side_question
    """)  # noqa: E501
    async with h.db() as c:
        await post_message(
            h,
            c,
            thread_id=group,
            sender_type="user",
            sender_id=team.user,
            content={"text": "Báo cáo?"},
        )
    await until(lambda: _texts_include(h, group, "Kết quả cuối"))
    await settle(h, team)
    replies = await _data_replies(h, group)
    assert [r.get("audience") for r in replies] == ["agents", None]
    assert replies[-1]["text"] == "Kết quả cuối"


async def test_multiple_agent_messages_do_not_suppress_the_final_user_answer(rows, team, stack):
    group = await _group_with_lead(rows, team)
    code = (
        "from contoso import send_to_agent\\n"
        f"send_to_agent(['lead'], 'một', thread='group:{group}')\\n"
        f"send_to_agent(['lead'], 'hai', thread='group:{group}')\\n"
        "send_to_agent(['lead'], 'ba')"
    )
    h = await stack(f"""
    agents:
      data:
        - match: {{input_contains: "Báo cáo"}}
          reply: {{tool: "{code}"}}
        - reply: {{tool: "from contoso import send_to_agent\\nsend_to_agent(['lead'], 'bốn')"}}
        - reply: {{text: "Kết quả cuối"}}
    jev:
      - label: side_question
    """)
    async with h.db() as c:
        await post_message(
            h,
            c,
            thread_id=group,
            sender_type="user",
            sender_id=team.user,
            content={"text": "Báo cáo?"},
        )
    await until(lambda: _texts_include(h, group, "Kết quả cuối"))
    await settle(h, team)
    replies = await _data_replies(h, group)
    assert [r.get("audience") for r in replies] == ["agents", "agents", None]
    assert replies[-1]["text"] == "Kết quả cuối"


async def test_send_to_user_then_final_text_is_one_visible_answer(rows, team, stack):
    h = await stack("""
    agents:
      data:
        - match: {input_contains: "Báo cáo"}
          reply: {tool: "from contoso import send_to_user\\nsend_to_user('Kết quả cuối')"}
        - reply: {text: "Kết quả cuối"}
    """)
    async with h.db() as c:
        await post_message(
            h,
            c,
            thread_id=team.threads["data"],
            sender_type="user",
            sender_id=team.user,
            content={"text": "Báo cáo?"},
        )
    await until(lambda: _texts_include(h, team.threads["data"], "Kết quả cuối"))
    await settle(h, team)
    replies = await _data_replies(h, team.threads["data"])
    assert [r["text"] for r in replies] == ["Kết quả cuối"]


async def _texts_include(h, thread_id, text):
    return any(r.get("text") == text for r in await _data_replies(h, thread_id))


async def test_deadlock_guard_help_for_the_running_task_is_not_queued(conn, rows, team, stack):
    from sqlalchemy import func

    task = await rows.insert(
        t.global_tasks,
        user_id=team.user,
        description="T1: phân tích",
        status="running",
        started_at=func.now(),
    )
    await rows.insert(t.task_involvement, task_id=task, agent_id=team.lead.id)
    h = await stack("""
    agents:
      data:
        - reply: {tool: "from contoso import send_to_agent\\nsend_to_agent(['lead'], 'Cho T1 tôi cần thêm số liệu phân khu, giúp với')"}
        - reply: {text: "đợi"}
    jev:
      - label: side_question
    """)  # noqa: E501
    async with h.db() as c:
        await post_message(
            h,
            c,
            thread_id=team.threads["data"],
            sender_type="user",
            sender_id=team.user,
            content={"text": "bắt đầu đi"},
        )

    async def lead_saw_it():
        return await scalar(h, select(t.jev_decisions.c.label)) is not None

    await until(lead_saw_it)
    await settle(h, team)
    assert await conn.scalar(select(t.jev_decisions.c.label)) == "side_question"
    count = await conn.scalar(select(func.count()).select_from(t.global_tasks))
    assert count == 1  # nothing queued behind T1
    lead_inputs = (
        (
            await conn.execute(
                select(t.events.c.payload).where(
                    t.events.c.agent_id == team.lead.id, t.events.c.kind == "input"
                )
            )
        )
        .scalars()
        .all()
    )
    assert any('from="agent:data"' in p["text"] for p in lead_inputs)


# --- doc 17 #3, #4, #5 --------------------------------------------------------------------


async def events_where(h, agent_id, **kw):
    async with h.db() as c:
        q = select(t.events).where(t.events.c.agent_id == agent_id).order_by(t.events.c.seq)
        return (await c.execute(q)).all()


async def test_routine_during_a_task(conn, rows, team, stack, settings):
    """A non-involved agent runs its routine while the task runs; an involved agent's routine
    waits until its current block of work ends."""
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import func

    from backend.harness import routines

    chart = await rows.agent(team.user, slug="chart", display_name="Chart")
    await rows.insert(
        t.agent_epochs,
        agent_id=chart,
        epoch=0,
        start_seq=0,
        system_prompt="SYSTEM chart",
        reason="initial",
    )
    task = await rows.insert(
        t.global_tasks, user_id=team.user, description="T1", status="running", started_at=func.now()
    )
    await rows.insert(t.task_involvement, task_id=task, agent_id=team.data.id)
    routine = 'prompt: "Kiểm tra số liệu mới"\ncron: "0 8 * * *"\nenabled: true\n'
    for slug in ("data", "chart"):
        folder = Path(settings.FOLDERS_DIR) / str(team.user) / slug
        (folder / "routines").mkdir(parents=True, exist_ok=True)
        (folder / "routines" / "kiem-tra.yaml").write_text(routine)
    h = await stack("""
    agents:
      data:
        - match: {input_contains: "bắt đầu khối việc"}
          reply: {tool: "print('xong khối việc')"}
        - reply: {text: "xong"}
        - match: {input_contains: "<routine"}
          reply: {text: "routine của data"}
      chart:
        - match: {input_contains: "<routine"}
          reply: {text: "routine của chart"}
    jev:
      - label: side_question
    """)
    # Hold this block until Chart has run. A fixed sleep races with scheduler/DB load.
    release = asyncio.Event()
    execute = h.execd.exec

    async def gated_exec(**kwargs):
        if "xong khối việc" in (kwargs.get("code") or ""):
            await release.wait()
        return await execute(**kwargs)

    h.execd.exec = gated_exec
    async with h.db() as c:
        await post_message(
            h,
            c,
            thread_id=team.threads["data"],
            sender_type="user",
            sender_id=team.user,
            content={"text": "bắt đầu khối việc"},
        )

    async def data_in_exec():
        return h.registry.running(team.data.id) is not None

    await until(data_in_exec)

    async def routines_synced():
        return (
            await scalar(
                h,
                select(func.count())
                .select_from(t.routine_state)
                .where(t.routine_state.c.agent_id.in_([team.data.id, chart])),
            )
            == 2
        )

    await until(routines_synced)
    async with h.db() as c:  # both runners synced the file at start; make it due now
        await c.execute(
            t.routine_state.update().values(next_fire_at=datetime.now(UTC) - timedelta(seconds=1))
        )
    await routines.fire_due(h)

    async def chart_ran_routine():
        return any(
            e.activation_kind == "routine" and e.kind == "assistant"
            for e in await events_where(h, chart)
        )

    try:
        await until(chart_ran_routine)
        assert h.registry.running(team.data.id) is not None  # data still in its block of work
    finally:
        release.set()
    await settle(h, team)
    data_events = await events_where(h, team.data.id)
    kinds = [(e.activation_kind, e.kind) for e in data_events]
    assert kinds == [
        ("message", "input"),
        ("message", "assistant"),
        ("message", "tool_result"),
        ("message", "assistant"),
        ("routine", "input"),
        ("routine", "assistant"),
    ]
    status = await conn.scalar(select(t.global_tasks.c.status))
    assert status == "running"  # routines never touch the queue


async def test_compaction_at_a_safe_point(conn, rows, team, stack, settings):
    """Soft limit crossed mid-task → pending; runs only after end_task; the new epoch starts
    after the compaction's own events and re-reads memory/index.md."""
    await rows.insert(
        t.global_tasks, user_id=team.user, description="T1: phân tích", status="queued"
    )
    lead_folder = Path(settings.FOLDERS_DIR) / str(team.user) / "lead"
    (lead_folder / "memory").mkdir(exist_ok=True)
    (lead_folder / "memory" / "index.md").write_text("# Memory\n")
    h = await stack("""
    agents:
      lead:
        - match: {input_contains: "<begin_task"}
          reply: {tool: "open('memory/index.md','a').write('- preferences.md: báo cáo ngắn\\\\n')\\nprint('ghi nhớ')"}
        - reply: {tool: "from contoso import end_task\\nend_task('xong')"}
        - reply: {text: "đã xong"}
        - match: {input_contains: "<compaction>"}
          reply: {tool: "from contoso import write_summary\\nwrite_summary('T1 xong; người dùng thích báo cáo ngắn')"}
        - reply: {text: "done"}
    usage: {prompt_tokens: 2400, completion_tokens: 10, cached_tokens: 0, cost: 0}
    """)  # noqa: E501
    # soft limit 2400 (crossed by the second call of the task), hard limit 3600 (the compaction
    # prompt adds ~600 tokens, so compaction itself stays under it)
    h.model._override = 4000
    h.wake(team.lead.id)

    async def compacted():
        async with h.db() as c:
            return (
                await c.scalar(
                    func_count(t.agent_epochs).where(t.agent_epochs.c.agent_id == team.lead.id)
                )
                == 2
            )

    await until(compacted)
    await settle(h, team)
    evs = await events_where(h, team.lead.id)
    task_events = [e for e in evs if e.activation_kind == "task"]
    compaction_events = [e for e in evs if e.activation_kind == "compaction"]
    assert task_events and compaction_events
    end_task_seq = max(e.seq for e in task_events)
    assert min(e.seq for e in compaction_events) > end_task_seq  # only after the task ended
    epoch = (
        await conn.execute(
            select(t.agent_epochs).where(
                t.agent_epochs.c.agent_id == team.lead.id, t.agent_epochs.c.epoch == 1
            )
        )
    ).one()
    assert epoch.reason == "compaction" and epoch.start_seq == evs[-1].seq
    assert epoch.summary.startswith("T1 xong")
    assert "báo cáo ngắn" in epoch.system_prompt
    assert await conn.scalar(select(t.global_tasks.c.status)) == "done"


def func_count(table):
    from sqlalchemy import func

    return select(func.count()).select_from(table)


async def test_restart_mid_activation(conn, rows, team, stack):
    """Kill the runner during an exec: on boot the tool_result says lost, a notice is
    delivered, and the running task stays running."""
    from backend.harness.restart import reconcile

    await rows.insert(t.global_tasks, user_id=team.user, description="T1", status="queued")
    h = await stack("""
    agents:
      lead:
        - match: {input_contains: "<begin_task"}
          reply: {tool: "import time\\ntime.sleep(5)"}
    """)
    h.wake(team.lead.id)

    async def in_exec():
        return h.registry.running(team.lead.id) is not None

    await until(in_exec)
    h.supervisor.stop_grace_s = 0.05
    await h.supervisor.stop_all()  # the "crash": the runner is cancelled mid-exec
    woken = await reconcile(h)
    evs = await events_where(h, team.lead.id)
    assert evs[-1].kind == "tool_result"
    assert evs[-1].payload["text"] == "exit_code: lost (harness restart)"
    async with h.db() as c:
        notices = (
            (
                await c.execute(
                    select(t.deliveries.c.notice).where(t.deliveries.c.agent_id == team.lead.id)
                )
            )
            .scalars()
            .all()
        )
        status = await c.scalar(select(t.global_tasks.c.status))
    assert {n["kind"] for n in notices} == {"restart", "task_resume"}
    assert status == "running" and team.lead.id in woken
