"""The tool result text (doc 03 "Tool result format") and offloading large outputs (doc 06).

```text
exit_code: 0 · 1.4 s
--- stdout ---
<stdout, or the head and tail of the output when offloaded>
--- stderr ---
<stderr, omitted when empty>
[output offloaded to .contoso/outputs/x_01J….txt (52,113 chars); showing first 2,000 and last 2,000]
[files changed: memory/preferences.md (M), helpers/peers.py (A)]
[2 notifications pending]
```

An output is offloaded when `stdout` + `stderr` is longer than `OFFLOAD_CHARS`: the full output
goes to `<folder>/.contoso/outputs/<exec_id>.txt` (written by api) and the text keeps the first and
last `OFFLOAD_HEAD_CHARS` / `OFFLOAD_TAIL_CHARS` of the output body.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from backend.db import tables as t
from backend.execd_client import ExecResult
from backend.harness import events as ev

HEAD_CHARS = 2000
TAIL_CHARS = 2000
OUTPUTS = Path(".contoso") / "outputs"


def _seconds(ms: int) -> str:
    return f"{ms / 1000:.1f} s"


def status_line(result: ExecResult, timeout_s: float) -> str:
    if result.timed_out:
        return f"exit_code: killed (timeout {timeout_s:g} s)"
    return f"exit_code: {result.exit_code} · {_seconds(result.duration_ms)}"


def output_body(stdout: str, stderr: str) -> str:
    body = f"--- stdout ---\n{stdout}"
    if stderr:
        body += f"\n--- stderr ---\n{stderr}"
    return body


def head_tail(text: str, head: int, tail: int) -> str:
    if len(text) <= head + tail:
        return text
    return f"{text[:head]}\n[…]\n{text[-tail:]}"


def offload_line(path: str, chars: int, head: int, tail: int) -> str:
    return (
        f"[output offloaded to {path} ({chars:,} chars); showing first {head:,} and last {tail:,}]"
    )


def footer(changed: list[dict[str, str]] | None, pending: int) -> list[str]:
    lines = []
    if changed:
        files = ", ".join(f"{c['path']} ({c['status']})" for c in changed)
        lines.append(f"[files changed: {files}]")
    if pending:
        lines.append(f"[{pending} notification{'s' if pending != 1 else ''} pending]")
    return lines


def write_output(folder: Path, exec_id: str, content: str) -> str:
    rel = OUTPUTS / f"{exec_id}.txt"
    path = Path(folder) / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return rel.as_posix()


def build_tool_result(
    result: ExecResult,
    *,
    folder: Path,
    exec_id: str,
    tool_call_id: str,
    timeout_s: float,
    pending: int,
    offload_chars: int,
    head_chars: int = HEAD_CHARS,
    tail_chars: int = TAIL_CHARS,
    system: bool = False,
    final: bool = False,
) -> dict[str, Any]:
    """The `tool_result` payload of doc 10; `text` is exactly what the model will see."""
    body = output_body(result.stdout, result.stderr)
    total = len(result.stdout) + len(result.stderr)
    offload_path = None
    lines = [status_line(result, timeout_s)]
    if total > offload_chars:
        offload_path = write_output(folder, exec_id, body)
        output = result.stdout + (f"\n--- stderr ---\n{result.stderr}" if result.stderr else "")
        lines.append("--- stdout ---\n" + head_tail(output, head_chars, tail_chars))
        lines.append(offload_line(offload_path, total, head_chars, tail_chars))
    else:
        lines.append(body)
    lines += footer(result.changed, pending)
    return {
        "tool_call_id": tool_call_id,
        "exec_id": exec_id,
        "text": "\n".join(lines),
        "exit_code": result.exit_code,
        "duration_ms": result.duration_ms,
        "timed_out": result.timed_out,
        "truncated": result.truncated,
        "offload_path": offload_path,
        "head": result.head,
        "changed": result.changed,
        "snapshot_error": result.snapshot_error,
        "final": final,
        "batch_offloaded_at": None,
        "system": system,
    }


async def batch_offload(
    conn: AsyncConnection,
    *,
    agent_id: uuid.UUID,
    folder: Path,
    start_seq: int,
    epoch: int,
    trace_id: str,
    activation_kind: str,
    task_id: int | None = None,
    head_chars: int = HEAD_CHARS,
    tail_chars: int = TAIL_CHARS,
) -> int:
    """Doc 06 fallback: offload every not-yet-offloaded tool result of the epoch but the newest.

    Rewrites `payload.text`, sets `payload.batch_offloaded_at` (the only change the
    `events_append_only` trigger allows) and appends an `error` event `batch_offload`.
    Returns how many results were offloaded.
    """
    e = t.events
    rows = (
        await conn.execute(
            select(e.c.id, e.c.seq, e.c.payload)
            .where(e.c.agent_id == agent_id, e.c.kind == "tool_result", e.c.seq > start_seq)
            .order_by(e.c.seq)
        )
    ).all()
    candidates = [
        r
        for r in rows[:-1]
        if not r.payload.get("offload_path") and not r.payload.get("batch_offloaded_at")
    ]
    if not candidates:
        return 0
    stamp = datetime.now(UTC).isoformat()
    for r in candidates:
        text = r.payload.get("text", "")
        exec_id = r.payload.get("exec_id") or f"seq{r.seq}"
        path = write_output(folder, exec_id, text)
        new_text = "\n".join(
            [
                head_tail(text, head_chars, tail_chars),
                offload_line(path, len(text), head_chars, tail_chars),
            ]
        )
        payload = dict(r.payload, text=new_text, batch_offloaded_at=stamp)
        await conn.execute(update(e).where(e.c.id == r.id).values(payload=payload))
    await ev.append(
        conn,
        agent_id,
        kind="error",
        payload={
            "code": "batch_offload",
            "text": f"{len(candidates)} earlier tool results were moved to .contoso/outputs/",
        },
        trace_id=trace_id,
        activation_kind=activation_kind,
        task_id=task_id,
    )
    return len(candidates)
