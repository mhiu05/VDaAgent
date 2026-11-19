"""Supervisor (doc 02): one `AgentRunner` task per active agent of an active user whose domain
is available. A runner that crashes is restarted after a backoff, with an `error` event
(`restart`). Idle runners wait on their wake event, and re-check every `RUNNER_POLL_S`."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import uuid
from typing import Any

from sqlalchemy import select, update

from backend.db import tables as t
from backend.harness.runner import AgentRunner

log = logging.getLogger("contoso.harness")


class Supervisor:
    def __init__(self, harness: Any, restart_backoff_s: float = 5.0) -> None:
        self.harness = harness
        self.restart_backoff_s = restart_backoff_s
        self._tasks: dict[uuid.UUID, asyncio.Task] = {}
        self._events: dict[uuid.UUID, asyncio.Event] = {}
        self._users: dict[uuid.UUID, uuid.UUID] = {}
        self._stopping: set[uuid.UUID] = set()
        self.stop_grace_s = 5.0

    @staticmethod
    def eligible():
        a, u, d = t.agents, t.users, t.domains
        return (
            select(a.c.id, a.c.user_id)
            .select_from(a.join(u, a.c.user_id == u.c.id).join(d, u.c.domain_id == d.c.id))
            .where(a.c.state == "active", u.c.status == "active", d.c.status == "available")
        )

    async def start(self) -> None:
        async with self.harness.db() as conn:
            rows = (await conn.execute(self.eligible())).all()
        for row in rows:
            self.start_agent(row.id, row.user_id)

    async def start_user(self, user_id: uuid.UUID) -> None:
        async with self.harness.db() as conn:
            rows = (await conn.execute(self.eligible().where(t.agents.c.user_id == user_id))).all()
        for row in rows:
            self.start_agent(row.id, row.user_id)

    def start_agent(self, agent_id: uuid.UUID, user_id: uuid.UUID | None = None) -> None:
        task = self._tasks.get(agent_id)
        if task is not None and not task.done():
            self.wake(agent_id)
            return
        self._events[agent_id] = asyncio.Event()
        self._events[agent_id].set()  # check for work at once
        if user_id is not None:
            self._users[agent_id] = user_id
        self._tasks[agent_id] = asyncio.create_task(self._loop(agent_id), name=f"runner:{agent_id}")

    def running(self) -> list[uuid.UUID]:
        return [a for a, task in self._tasks.items() if not task.done()]

    def wake(self, agent_id: uuid.UUID) -> None:
        event = self._events.get(agent_id)
        if event is not None:
            event.set()

    async def stop_agent(self, agent_id: uuid.UUID) -> None:
        """Ask the runner to exit at its next idle point; cancel it after `stop_grace_s`."""
        task = self._tasks.pop(agent_id, None)
        self._stopping.add(agent_id)
        self.wake(agent_id)
        try:
            if task is not None and not task.done():
                try:
                    await asyncio.wait_for(asyncio.shield(task), timeout=self.stop_grace_s)
                except TimeoutError:
                    task.cancel()
                    with contextlib.suppress(asyncio.CancelledError, Exception):
                        await task
                except Exception:
                    pass
        finally:
            self._stopping.discard(agent_id)
            self._events.pop(agent_id, None)
            self._users.pop(agent_id, None)

    async def stop_user(self, user_id: uuid.UUID) -> None:
        for agent_id in [a for a, u in self._users.items() if u == user_id]:
            await self.stop_agent(agent_id)

    async def stop_all(self) -> None:
        for agent_id in list(self._tasks):
            await self.stop_agent(agent_id)

    async def _loop(self, agent_id: uuid.UUID) -> None:
        event = self._events[agent_id]
        runner = AgentRunner(self.harness, agent_id, wake_event=event)
        poll = self.harness.settings.RUNNER_POLL_S
        while agent_id not in self._stopping:
            event.clear()
            try:
                await runner.run_until_idle()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.exception("runner %s crashed", agent_id)
                await self._record_crash(agent_id, e)
                await asyncio.sleep(self.restart_backoff_s)
                event.set()
                continue
            if agent_id in self._stopping:
                return
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(event.wait(), timeout=poll)

    async def _record_crash(self, agent_id: uuid.UUID, error: Exception) -> None:
        from backend import ids

        try:
            async with self.harness.db() as conn:
                query = select(t.agents).where(t.agents.c.id == agent_id)
                agent = (await conn.execute(query)).one()
                latest = (
                    await conn.execute(
                        select(t.events)
                        .where(t.events.c.agent_id == agent_id, t.events.c.kind == "input")
                        .order_by(t.events.c.seq.desc())
                        .limit(1)
                    )
                ).one_or_none()
                trace_id = latest.trace_id if latest is not None else ids.trace_id()
                await self.harness.append(
                    conn,
                    agent,
                    kind="error",
                    payload={"code": "restart", "text": f"runner crashed: {error}"[:1000]},
                    trace_id=trace_id,
                    activation_kind=latest.activation_kind if latest is not None else "message",
                    task_id=latest.task_id if latest is not None else None,
                )
                await conn.execute(
                    update(t.agents)
                    .where(t.agents.c.id == agent_id)
                    .values(status="idle", status_detail=None)
                )
                self.harness.publish_status(conn, agent, "idle", None)
                if latest is not None and latest.task_id is not None:
                    task = (
                        await conn.execute(
                            select(t.global_tasks).where(
                                t.global_tasks.c.id == latest.task_id,
                                t.global_tasks.c.status == "running",
                            )
                        )
                    ).one_or_none()
                    if task is not None:
                        from backend.harness.queue import end_by

                        await end_by(
                            self.harness,
                            conn,
                            task,
                            status="failed",
                            ended_by="harness",
                            outcome="runner crashed",
                            notice_kind=None,
                            notice_text=None,
                        )
                if latest is not None and latest.activation_kind in ("message", "task"):
                    message_ids = [
                        item.get("message_id")
                        for item in (latest.payload or {}).get("items", [])
                        if item.get("message_id")
                    ]
                    source = None
                    if message_ids:
                        source = (
                            await conn.execute(
                                select(t.messages).where(
                                    t.messages.c.id.in_(message_ids),
                                    t.messages.c.sender_type == "user",
                                )
                            )
                        ).first()
                    if source is not None:
                        from backend.messaging.messages import user_reply_clause

                        already_sent = await conn.scalar(
                            select(t.messages.c.id).where(
                                user_reply_clause(
                                    thread_id=source.thread_id,
                                    agent_id=agent_id,
                                    trace_id=trace_id,
                                )
                            )
                        )
                        if already_sent is None:
                            from backend.messaging.system import post_system_message

                            await post_system_message(
                                self.harness,
                                conn,
                                source.thread_id,
                                "Lượt xử lý đã thất bại do lỗi nội bộ. Vui lòng thử lại.",
                            )
        except Exception:
            log.exception("could not record the crash of runner %s", agent_id)
