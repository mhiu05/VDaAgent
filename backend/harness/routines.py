"""Routines (doc 09; decision 0003): `routines/<name>.yaml` → `routine_state` → activations.

- **Sync** (when a runner starts, after each activation, and on builder writes): new files insert
  rows, removed files delete them, a changed cron recomputes `next_fire_at`. Invalid files are
  skipped and get one `routine_invalid` notice per file content (sha256).
- **Fire** (scheduler tick): enabled rows with `next_fire_at <= now` become `pending`,
  `last_fired_at=now`, `next_fire_at` moves past now, the owner is woken. Repeated and missed
  fires collapse into one pending instance.
- **Run** (work source, doc 03 rule 2): the oldest due pending routine, with the prompt read
  from the file at that moment.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import yaml
from croniter import croniter
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from backend.db import tables as t
from backend.db.session import on_commit
from backend.harness import items
from backend.harness.notices import send_notice

TZ = ZoneInfo("Asia/Ho_Chi_Minh")
NAME_RE = re.compile(r"^[a-z0-9-]{2,32}$")


@dataclass
class Routine:
    name: str
    prompt: str = ""
    cron: str = ""
    enabled: bool = True
    sha: str = ""
    error: str | None = None


def valid_cron(expr: str) -> bool:
    return isinstance(expr, str) and len(expr.split()) == 5 and croniter.is_valid(expr)


def next_fire(cron: str, after: datetime) -> datetime:
    """The next fire time strictly after `after`, computed in Asia/Ho_Chi_Minh."""
    local = after.astimezone(TZ)
    return croniter(cron, local).get_next(datetime).astimezone(UTC)


def next_fires(cron: str, after: datetime, n: int = 3) -> list[datetime]:
    it = croniter(cron, after.astimezone(TZ))
    return [it.get_next(datetime).astimezone(UTC) for _ in range(n)]


def parse(path: Path) -> Routine:
    raw = path.read_bytes()
    r = Routine(name=path.stem, sha=hashlib.sha256(raw).hexdigest())
    if not NAME_RE.fullmatch(r.name):
        r.error = "name must match ^[a-z0-9-]{2,32}$"
        return r
    try:
        data = yaml.safe_load(raw.decode("utf-8"))
    except (yaml.YAMLError, UnicodeDecodeError) as e:
        r.error = f"invalid yaml: {e}".splitlines()[0]
        return r
    if not isinstance(data, dict):
        r.error = "invalid yaml: expected a mapping"
        return r
    prompt, cron, enabled = data.get("prompt"), data.get("cron"), data.get("enabled", True)
    if not isinstance(prompt, str) or not prompt.strip():
        r.error = "missing prompt"
    elif not valid_cron(cron):
        r.error = f"invalid cron: {cron!r}"
    elif not isinstance(enabled, bool):
        r.error = "enabled must be true or false"
    else:
        r.prompt, r.cron, r.enabled = prompt, cron, enabled
    return r


def read_all(folder: Path) -> list[Routine]:
    directory = Path(folder) / "routines"
    if not directory.is_dir():
        return []
    return [parse(p) for p in sorted(directory.glob("*.yaml")) if p.is_file()]


async def _already_notified(conn: AsyncConnection, agent_id: Any, sha: str) -> bool:
    d = t.deliveries
    return bool(
        await conn.scalar(
            select(func.count())
            .select_from(d)
            .where(
                d.c.agent_id == agent_id,
                d.c.notice["kind"].astext == "routine_invalid",
                d.c.notice["sha256"].astext == sha,
            )
        )
    )


async def sync(h: Any, conn: AsyncConnection, agent: Any) -> list[Routine]:
    """Make `routine_state` match the folder. Returns what was read (errors included)."""
    found = read_all(h.folder(agent))
    rs = t.routine_state
    rows = {
        r.name: r for r in (await conn.execute(select(rs).where(rs.c.agent_id == agent.id))).all()
    }
    now = datetime.now(UTC)
    valid = {r.name: r for r in found if r.error is None}
    for r in found:
        if r.error is not None and not await _already_notified(conn, agent.id, r.sha):
            await send_notice(
                h,
                conn,
                agent.id,
                "routine_invalid",
                f"routines/{r.name}.yaml is invalid and was skipped: {r.error}",
                extra={"sha256": r.sha},
            )
    for name in rows:
        if name not in valid:
            await conn.execute(delete(rs).where(rs.c.agent_id == agent.id, rs.c.name == name))
    for name, r in valid.items():
        row = rows.get(name)
        if row is None:
            await conn.execute(
                rs.insert().values(
                    agent_id=agent.id,
                    name=name,
                    cron=r.cron,
                    enabled=r.enabled,
                    prompt_sha=r.sha,
                    next_fire_at=next_fire(r.cron, now),
                )
            )
        elif (row.cron, row.enabled, row.prompt_sha) != (r.cron, r.enabled, r.sha):
            values: dict[str, Any] = {"enabled": r.enabled, "prompt_sha": r.sha}
            if row.cron != r.cron or row.next_fire_at is None:
                values.update(cron=r.cron, next_fire_at=next_fire(r.cron, now))
            await conn.execute(
                update(rs).where(rs.c.agent_id == agent.id, rs.c.name == name).values(**values)
            )
    return found


async def fire_due(h: Any) -> int:
    rs = t.routine_state
    now = datetime.now(UTC)
    async with h.db() as conn:
        due = (
            await conn.execute(
                select(rs)
                .where(rs.c.enabled.is_(True), rs.c.next_fire_at <= now)
                .with_for_update(skip_locked=True)
            )
        ).all()
        for row in due:
            await conn.execute(
                update(rs)
                .where(rs.c.agent_id == row.agent_id, rs.c.name == row.name)
                .values(pending=True, last_fired_at=now, next_fire_at=next_fire(row.cron, now))
            )
            on_commit(conn, lambda a=row.agent_id: h.wake(a))
    return len(due)


async def routine_source(h: Any, conn: AsyncConnection, agent: Any) -> items.Work | None:
    rs = t.routine_state
    pending = (
        await conn.execute(
            select(rs)
            .where(rs.c.agent_id == agent.id, rs.c.pending.is_(True), rs.c.enabled.is_(True))
            .order_by(rs.c.last_fired_at.nulls_first(), rs.c.name)
        )
    ).all()
    for row in pending:
        path = h.folder(agent) / "routines" / f"{row.name}.yaml"
        r = parse(path) if path.is_file() else None
        if r is None or r.error is not None:
            await conn.execute(delete(rs).where(rs.c.agent_id == agent.id, rs.c.name == row.name))
            continue
        fired_at = row.last_fired_at or datetime.now(UTC)
        name = row.name

        async def on_start(c: AsyncConnection, seq: int, name: str = name) -> None:
            await c.execute(
                update(rs)
                .where(rs.c.agent_id == agent.id, rs.c.name == name)
                .values(pending=False, last_started_at=func.now())
            )

        async def on_end(outcome: str, name: str = name) -> None:
            async with h.db() as c:
                await c.execute(
                    update(rs)
                    .where(rs.c.agent_id == agent.id, rs.c.name == name)
                    .values(last_ended_at=func.now())
                )

        return items.Work(
            kind="routine",
            blocks=[items.routine(name=name, fired_at=fired_at, prompt=r.prompt.strip())],
            items=[{"type": "routine", "name": name}],
            default_thread=f"direct:{agent.slug}",
            status_detail=name,
            on_start=on_start,
            on_end=on_end,
        )
    return None
