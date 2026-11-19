"""The harness: everything one `api` process needs to run agents (doc 02 "Process model").

`Harness` holds the settings, a transaction provider, the execd and model clients, the event
bus, the exec registry, per-agent job locks, the work sources and the supervisor. Every
database write goes through `harness.db()`, whose `on_commit` callbacks (wakes, bus events)
run after the commit.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import AsyncConnection

from backend.db.session import hook_scope, on_commit, run_hooks
from backend.harness import events as ev
from backend.harness.bus import EventBus
from backend.harness.items import Work, pending_deliveries_work
from backend.harness.tokens import ExecRegistry
from backend.settings import Settings

WorkSource = Callable[["Harness", AsyncConnection, Any], Awaitable[Work | None]]


class Harness:
    def __init__(
        self,
        settings: Settings,
        *,
        db: Callable[[], Any],
        execd: Any,
        model: Any,
        bus: EventBus | None = None,
    ) -> None:
        self.settings = settings
        self._db = db
        self.execd = execd
        self.model = model
        self.bus = bus or EventBus()
        self.registry = ExecRegistry()
        from backend.observability.tracing import build_tracer

        self.tracer = build_tracer(settings)
        self._locks: dict[uuid.UUID, asyncio.Lock] = {}
        # Doc 03 "Activation": checked in this order when an agent is idle. S6 fills `task`,
        # S8 fills `routine` and `compaction`.
        self.sources: dict[str, WorkSource | None] = {
            "deliveries": _deliveries_source,
            "routine": None,
            "compaction": None,
            "task": None,
        }
        from backend.harness import routines
        from backend.harness.compaction import CompactionState, compaction_source
        from backend.harness.jev import Jev
        from backend.harness.queue import task_source
        from backend.harness.scheduler import Scheduler
        from backend.harness.supervisor import Supervisor

        self.sources["routine"] = routines.routine_source
        self.sources["compaction"] = compaction_source
        self.sources["task"] = task_source
        from backend.agents.jobs import JobWorker

        self.compaction = CompactionState()
        self.jobs = JobWorker(self)
        self.jev = Jev(self)
        self.scheduler = Scheduler(self)
        self.scheduler.hooks.append(routines.fire_due)
        from backend.reports.service import fail_stale_attempts

        self.scheduler.hooks.append(fail_stale_attempts)
        self.supervisor = Supervisor(self)

    # --- infrastructure -------------------------------------------------------------------

    @asynccontextmanager
    async def db(self) -> AsyncIterator[AsyncConnection]:
        async with self._db() as conn, hook_scope(conn) as hooks:
            yield conn
        run_hooks(hooks)

    def job_lock(self, agent_id: uuid.UUID) -> asyncio.Lock:
        lock = self._locks.get(agent_id)
        if lock is None:
            lock = self._locks[agent_id] = asyncio.Lock()
        return lock

    def wake(self, agent_id: uuid.UUID) -> None:
        self.supervisor.wake(agent_id)

    def now(self) -> datetime:
        return datetime.now(UTC)

    def clock(self) -> float:
        return time.time()

    def folder(self, agent: Any) -> Path:
        return Path(self.settings.FOLDERS_DIR) / str(agent.user_id) / agent.slug

    async def append(self, conn: AsyncConnection, agent: Any, **kwargs: Any) -> int:
        """`events.append`, plus `event.appended` for admin subscribers after commit."""
        seq = await ev.append(conn, agent.id, **kwargs)
        kind = kwargs["kind"]
        on_commit(
            conn,
            lambda: self.bus.publish_agent(
                agent.id, "event.appended", {"agent_id": str(agent.id), "seq": seq, "kind": kind}
            ),
        )
        return seq

    def publish_status(
        self, conn: AsyncConnection, agent: Any, status: str, detail: str | None
    ) -> None:
        data = {
            "agent_id": str(agent.id),
            "slug": agent.slug,
            "status": status,
            "status_detail": detail,
        }

        def publish() -> None:
            self.bus.publish(agent.user_id, "agent.status", data)
            self.bus.publish_group(agent.user_id, "agent.status", data)
            self.bus.publish_agent(agent.id, "agent.status", data)  # admin trace stream

        on_commit(conn, publish)

    # --- activations (overridable in tests) -------------------------------------------------

    async def run_activation(self, runner: Any, work: Work) -> str:
        from backend.harness.runner import run_activation

        return await run_activation(self, runner, work)

    async def next_work(self, conn: AsyncConnection, agent: Any) -> Work | None:
        for source in self.sources.values():
            if source is not None:
                work = await source(self, conn, agent)
                if work is not None:
                    return work
        return None


async def _deliveries_source(harness: Harness, conn: AsyncConnection, agent: Any) -> Work | None:
    return await pending_deliveries_work(conn, agent)
