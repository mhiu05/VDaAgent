"""Tool result format and offloading (doc 03 "Tool result format", doc 06 "Offloading")."""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import select

from backend.db import tables as t
from backend.execd_client import ExecResult
from backend.harness import events as ev
from backend.harness.offload import batch_offload, build_tool_result
from backend.tests.db.conftest import rows  # noqa: F401


def result(stdout="", stderr="", **kw):
    values = {
        "exit_code": 0,
        "stdout": stdout,
        "stderr": stderr,
        "duration_ms": 1400,
        "timed_out": False,
        "truncated": False,
        "head": "abc",
        "changed": [],
        "snapshot_error": None,
    }
    values.update(kw)
    return ExecResult(**values)


def test_basic_format(tmp_path):
    p = build_tool_result(
        result("1\n"),
        folder=tmp_path,
        exec_id="x_1",
        tool_call_id="c1",
        timeout_s=120,
        pending=0,
        offload_chars=8000,
    )
    assert p["text"] == "exit_code: 0 · 1.4 s\n--- stdout ---\n1\n"
    assert p["tool_call_id"] == "c1" and p["exec_id"] == "x_1" and p["offload_path"] is None
    assert p["batch_offloaded_at"] is None and p["final"] is False and p["system"] is False


def test_stderr_changed_files_and_pending_footer(tmp_path):
    p = build_tool_result(
        result(
            "",
            "Traceback\n",
            exit_code=1,
            changed=[
                {"path": "memory/preferences.md", "status": "M"},
                {"path": "helpers/peers.py", "status": "A"},
            ],
        ),
        folder=tmp_path,
        exec_id="x_1",
        tool_call_id="c",
        timeout_s=120,
        pending=2,
        offload_chars=8000,
    )
    assert p["text"] == (
        "exit_code: 1 · 1.4 s\n--- stdout ---\n\n--- stderr ---\nTraceback\n\n"
        "[files changed: memory/preferences.md (M), helpers/peers.py (A)]\n"
        "[2 notifications pending]"
    )


def test_timeout_line(tmp_path):
    p = build_tool_result(
        result("x", timed_out=True, exit_code=-9),
        folder=tmp_path,
        exec_id="x",
        tool_call_id="c",
        timeout_s=120,
        pending=1,
        offload_chars=8000,
    )
    assert p["text"].splitlines()[0] == "exit_code: killed (timeout 120 s)"
    assert p["text"].endswith("[1 notification pending]")


def test_threshold_boundary(tmp_path):
    at = build_tool_result(
        result("a" * 8000),
        folder=tmp_path,
        exec_id="x_a",
        tool_call_id="c",
        timeout_s=1,
        pending=0,
        offload_chars=8000,
    )
    assert at["offload_path"] is None
    over = build_tool_result(
        result("a" * 7000, "b" * 1001),
        folder=tmp_path,
        exec_id="x_b",
        tool_call_id="c",
        timeout_s=1,
        pending=0,
        offload_chars=8000,
    )
    assert over["offload_path"] == ".contoso/outputs/x_b.txt"


def test_offloaded_output_keeps_head_and_tail_and_writes_the_file(tmp_path):
    out = "H" * 3000 + "M" * 50000 + "T" * 3000
    p = build_tool_result(
        result(out, "err"),
        folder=tmp_path,
        exec_id="x_01J",
        tool_call_id="c",
        timeout_s=1,
        pending=0,
        offload_chars=8000,
    )
    full = (tmp_path / ".contoso" / "outputs" / "x_01J.txt").read_text()
    assert "H" * 3000 in full and "T" * 3000 in full and "err" in full
    text = p["text"]
    assert "H" * 2000 in text and "M" * 2001 not in text
    assert text.count("M") < 100
    assert (
        "[output offloaded to .contoso/outputs/x_01J.txt (56,003 chars); "
        "showing first 2,000 and last 2,000]"
    ) in text
    assert len(text) < 4500


def test_system_exec_flag(tmp_path):
    p = build_tool_result(
        result("ok"),
        folder=tmp_path,
        exec_id="x",
        tool_call_id="c",
        timeout_s=1,
        pending=0,
        offload_chars=8000,
        system=True,
    )
    assert p["system"] is True


# --- batch offload --------------------------------------------------------------------------


async def test_batch_offload_skips_the_newest_and_marks_rows(conn, rows, tmp_path):  # noqa: F811
    user = await rows.user()
    agent = await rows.agent(user)
    await rows.insert(
        t.agent_epochs, agent_id=agent, epoch=0, start_seq=0, system_prompt="S", reason="initial"
    )
    trace = "0" * 32
    await ev.append(
        conn,
        agent,
        kind="input",
        payload={"text": "go", "items": []},
        trace_id=trace,
        activation_kind="message",
    )
    for i in range(3):
        await ev.append(
            conn,
            agent,
            kind="assistant",
            payload={"text": None, "tool_calls": [{"id": f"c{i}", "code": "x"}]},
            trace_id=trace,
            activation_kind="message",
        )
        await ev.append(
            conn,
            agent,
            kind="tool_result",
            payload={
                "tool_call_id": f"c{i}",
                "exec_id": f"x_{i}",
                "text": f"out{i}:" + "z" * 6000,
                "offload_path": None,
                "batch_offloaded_at": None,
            },
            trace_id=trace,
            activation_kind="message",
        )
    count = await batch_offload(
        conn,
        agent_id=agent,
        folder=tmp_path,
        start_seq=0,
        epoch=0,
        trace_id=trace,
        activation_kind="message",
    )
    assert count == 2
    results = (
        (
            await conn.execute(
                select(t.events.c.payload)
                .where(t.events.c.agent_id == agent, t.events.c.kind == "tool_result")
                .order_by(t.events.c.seq)
            )
        )
        .scalars()
        .all()
    )
    assert results[0]["batch_offloaded_at"] and results[1]["batch_offloaded_at"]
    assert results[2]["batch_offloaded_at"] is None
    assert len(results[0]["text"]) < 6000 and ".contoso/outputs/x_0.txt" in results[0]["text"]
    assert (tmp_path / ".contoso/outputs/x_0.txt").read_text().startswith("out0:")
    last = (
        await conn.execute(
            select(t.events)
            .where(t.events.c.agent_id == agent)
            .order_by(t.events.c.seq.desc())
            .limit(1)
        )
    ).one()
    assert last.kind == "error" and last.payload["code"] == "batch_offload"
    assert "2" in last.payload["text"]
    # a second run has nothing left to do (only the newest isn't offloaded)
    assert (
        await batch_offload(
            conn,
            agent_id=agent,
            folder=tmp_path,
            start_seq=0,
            epoch=0,
            trace_id=trace,
            activation_kind="message",
        )
        == 0
    )


async def test_events_seq_is_gap_free_per_agent(conn, rows):  # noqa: F811
    user = await rows.user()
    a, b = await rows.agent(user), await rows.agent(user)
    seqs = []
    for agent in (a, b, a, a, b):
        seqs.append(
            await ev.append(
                conn,
                agent,
                kind="error",
                payload={"code": "restart", "text": "x"},
                trace_id="0" * 32,
                activation_kind="message",
            )
        )
    assert seqs == [1, 1, 2, 3, 2]
    epoch = await conn.scalar(select(t.events.c.epoch).where(t.events.c.agent_id == a).limit(1))
    assert epoch == 0
    assert Path  # keep import for type use above
