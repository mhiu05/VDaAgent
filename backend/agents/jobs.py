"""The builder job worker (doc 02 "Builder job worker", doc 05, doc 10 `jobs`).

Jobs run one at a time, each under its lock: the agent's job lock (the same lock its execs
take), `(user_id, slug)` for creation, the user for provisioning. A job ends `done` or
`failed` with the last 4 KB of output; every status change is published as `builder.job`.
At boot, jobs left `queued` or `running` are failed with "interrupted by restart".
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from backend import ids
from backend.agents import builder, folders
from backend.agents.folders import AgentError
from backend.api.errors import ApiError
from backend.db import tables as t
from backend.db.session import on_commit
from backend.domains.loader import load_domain
from backend.harness import routines
from backend.harness.notices import send_notice

log = logging.getLogger("contoso.jobs")
OUTPUT_MAX = 4096
INTERRUPTED = "interrupted by restart"


class JobFailed(Exception):
    pass


def tail(text: str) -> str:
    return text[-OUTPUT_MAX:]


def job_view(row: Any) -> dict:
    return {
        "id": str(row.id),
        "kind": row.kind,
        "status": row.status,
        "output": row.output,
        "agent_id": str(row.agent_id) if row.agent_id else None,
        "created_at": row.created_at.isoformat(),
        "finished_at": row.finished_at.isoformat() if row.finished_at else None,
    }


async def enqueue(
    h: Any,
    conn: AsyncConnection,
    *,
    user_id: uuid.UUID,
    kind: str,
    request: dict,
    agent_id: uuid.UUID | None = None,
) -> uuid.UUID:
    job_id = await conn.scalar(
        t.jobs.insert()
        .values(user_id=user_id, agent_id=agent_id, kind=kind, request=request, status="queued")
        .returning(t.jobs.c.id)
    )
    if h is not None:
        on_commit(conn, h.jobs.kick)
    return job_id


async def active_job(
    conn: AsyncConnection, user_id: uuid.UUID, kind: str, key: str, value: Any
) -> uuid.UUID | None:
    j = t.jobs
    return await conn.scalar(
        select(j.c.id).where(
            j.c.user_id == user_id,
            j.c.kind == kind,
            j.c.status.in_(("queued", "running")),
            j.c.request[key].astext == str(value),
        )
    )


Handler = Callable[[Any, Any], Awaitable[str]]


class JobWorker:
    def __init__(self, harness: Any) -> None:
        self.h = harness
        self._event = asyncio.Event()
        self._task: asyncio.Task | None = None
        self._locks: dict[Any, asyncio.Lock] = {}
        self.handlers: dict[str, Handler] = {
            "agent_create": agent_create,
            "agent_reset": agent_reset,
            "skill_install": skill_install,
            "skill_remove": skill_remove,
            "package_add": package_change_job,
            "package_remove": package_change_job,
            "preset_apply": package_change_job,
        }
        from backend.agents.provisioning import user_provision

        self.handlers["user_provision"] = user_provision

    def kick(self) -> None:
        self._event.set()

    async def fail_stale(self) -> int:
        async with self.h.db() as conn:
            rows = (
                await conn.execute(
                    update(t.jobs)
                    .where(t.jobs.c.status.in_(("queued", "running")))
                    .values(status="failed", output=INTERRUPTED, finished_at=func.now())
                    .returning(t.jobs.c.id, t.jobs.c.kind, t.jobs.c.user_id)
                )
            ).all()
            # Doc 12: a provisioning that did not finish leaves the user `failed`, so the admin's
            # retry (only for `failed` users) can continue it; never `provisioning` forever.
            provisioned = {r.user_id for r in rows if r.kind == "user_provision"}
            if provisioned:
                await conn.execute(
                    update(t.users)
                    .where(t.users.c.id.in_(provisioned), t.users.c.status == "provisioning")
                    .values(status="failed", status_detail=f"provisioning {INTERRUPTED}; retry")
                )
        return len(rows)

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._loop(), name="job-worker")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    async def _loop(self) -> None:
        while True:
            self._event.clear()
            try:
                await self.run_pending()
            except Exception:
                log.exception("job worker")
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._event.wait(), timeout=self.h.settings.RUNNER_POLL_S)

    async def run_pending(self) -> int:
        n = 0
        while (job := await self._claim()) is not None:
            await self._run(job)
            n += 1
        return n

    async def _claim(self) -> Any | None:
        j = t.jobs
        async with self.h.db() as conn:
            job = (
                await conn.execute(
                    select(j)
                    .where(j.c.status == "queued")
                    .order_by(j.c.created_at, j.c.id)
                    .limit(1)
                    .with_for_update(skip_locked=True)
                )
            ).one_or_none()
            if job is None:
                return None
            job = (
                await conn.execute(
                    update(j).where(j.c.id == job.id).values(status="running").returning(*j.c)
                )
            ).one()
            self._publish(conn, job)
        return job

    def _publish(self, conn: AsyncConnection, job: Any) -> None:
        view = {
            "job_id": str(job.id),
            "agent_id": str(job.agent_id) if job.agent_id else None,
            "kind": job.kind,
            "status": job.status,
            "output_tail": job.output[-500:],
        }
        on_commit(conn, lambda: self.h.bus.publish(job.user_id, "builder.job", view))

    def _lock_for(self, job: Any) -> asyncio.Lock:
        if job.agent_id is not None:
            return self.h.job_lock(job.agent_id)
        key = (
            (job.user_id, job.request.get("slug"))
            if job.kind == "agent_create"
            else (job.user_id, job.kind)
        )
        return self._locks.setdefault(key, asyncio.Lock())

    async def _run(self, job: Any) -> None:
        status, output = "done", ""
        try:
            async with self._lock_for(job):
                output = await self.handlers[job.kind](self.h, job)
        except (JobFailed, AgentError, ApiError) as e:
            status, output = "failed", getattr(e, "message", "") or str(e)
        except Exception as e:
            log.exception("job %s (%s) failed", job.id, job.kind)
            status, output = "failed", f"{type(e).__name__}: {e}"
        async with self.h.db() as conn:
            row = (
                await conn.execute(
                    update(t.jobs)
                    .where(t.jobs.c.id == job.id)
                    .values(status=status, output=tail(output or ""), finished_at=func.now())
                    .returning(*t.jobs.c)
                )
            ).one()
            self._publish(conn, row)


# --- helpers --------------------------------------------------------------------------------


async def _agent(conn: AsyncConnection, agent_id: Any) -> Any:
    row = (await conn.execute(select(t.agents).where(t.agents.c.id == agent_id))).one_or_none()
    if row is None or row.state != "active":
        raise JobFailed("agent not found")
    return row


async def _username(conn: AsyncConnection, user_id: Any) -> str:
    return await conn.scalar(select(t.users.c.username).where(t.users.c.id == user_id))


async def system_exec(
    h: Any, folder: Path, argv: list[str], author: str, env_extra: dict | None = None
) -> Any:
    result = await h.execd.exec(
        folder=str(folder),
        exec_id=ids.exec_id(),
        argv=argv,
        timeout_s=folders.exec_timeout(h.settings, argv),
        author=author,
        env_extra=env_extra or {},
    )
    output = (result.stdout or "") + (result.stderr or "")
    if result.exit_code != 0:
        raise JobFailed(output or f"{' '.join(argv)} exited {result.exit_code}")
    return result


async def preset_packages(
    conn: AsyncConnection, preset_ids: list[str], domain_id: str | None
) -> list[list[str]]:
    p = t.library_presets
    rows = {
        r.id: r
        for r in (
            await conn.execute(
                select(p).where(
                    p.c.id.in_(preset_ids), (p.c.domain_id.is_(None)) | (p.c.domain_id == domain_id)
                )
            )
        ).all()
    }
    missing = [i for i in preset_ids if i not in rows]
    if missing:
        raise ApiError(400, "invalid_request", f"Không có bộ thư viện: {', '.join(missing)}")
    return [list(rows[i].packages) for i in preset_ids]


# --- handlers -------------------------------------------------------------------------------


async def agent_create(h: Any, job: Any) -> str:
    r = job.request
    s = h.settings
    async with h.db() as conn:
        domain_id = await conn.scalar(
            select(t.users.c.domain_id).where(t.users.c.id == job.user_id)
        )
        prompt, presets, sets, origin = (
            r.get("prompt", ""),
            r.get("presets") or [],
            r.get("credentials") or [],
            r.get("origin", "custom"),
        )
        if r.get("starter"):
            domain = await load_domain(conn, domain_id or "")
            starter = next((x for x in domain.starters if x.slug == r["starter"]), None)
            if starter is None:
                raise JobFailed(f"unknown starter {r['starter']}")
            prompt, presets, sets, origin = (
                starter.prompt,
                starter.presets,
                starter.credentials,
                "starter",
            )
        packages = await preset_packages(conn, presets, domain_id)
        row = await folders.create_agent(
            conn,
            settings=s,
            execd=h.execd,
            user_id=job.user_id,
            domain_id=domain_id,
            slug=r["slug"],
            display_name=r["display_name"],
            avatar=r["avatar"],
            description=r.get("description", ""),
            origin=r.get("force_origin") or origin,
            prompt=prompt,
            is_lead=bool(r.get("is_lead")),
            presets=packages,
            credential_sets=sets,
            author=r.get("author") or "contoso-harness",
        )
        await conn.execute(update(t.jobs).where(t.jobs.c.id == job.id).values(agent_id=row.id))
        await routines.sync(h, conn, row)
        on_commit(conn, lambda: h.supervisor.start_agent(row.id, row.user_id))
        from backend import groups  # local import: groups imports this module

        await groups.team_changed(h, conn, job.user_id)
    return f"created {r['slug']}"


async def agent_reset(h: Any, job: Any) -> str:
    async with h.db() as conn:
        agent = await _agent(conn, job.agent_id)
        await folders.reset_agent(conn, settings=h.settings, execd=h.execd, agent=agent)
        await routines.sync(h, conn, agent)
        on_commit(conn, lambda: h.wake(agent.id))
    return "reset"


async def skill_install(h: Any, job: Any) -> str:
    r = job.request
    async with h.db() as conn:
        agent = await _agent(conn, job.agent_id)
        author = builder.author_of(await _username(conn, job.user_id))
    env = {"CONTOSO_SKILLS_CODELOAD_URL": h.settings.SKILLS_CODELOAD_URL}
    token = h.settings.GITHUB_TOKEN.get_secret_value()
    if token:
        env["GITHUB_TOKEN"] = token
    result = await system_exec(h, h.folder(agent), list(r["argv"]), author, env)
    try:
        installed = json.loads(result.stdout.strip().splitlines()[-1])["installed"]
    except (ValueError, KeyError, IndexError):
        raise JobFailed(f"unexpected installer output: {result.stdout[-500:]}") from None
    name = installed.removeprefix("skills/")
    async with h.db() as conn:
        await send_notice(
            h, conn, agent.id, "builder", f"Kỹ năng mới: {name} — đọc skills/{name}/SKILL.md"
        )
    return result.stdout


async def skill_remove(h: Any, job: Any) -> str:
    async with h.db() as conn:
        agent = await _agent(conn, job.agent_id)
        username = await _username(conn, job.user_id)
        return await builder.remove_skill(
            h, conn, agent, h.folder(agent), job.request["name"], username
        )


async def package_change_job(h: Any, job: Any) -> str:
    async with h.db() as conn:
        agent = await _agent(conn, job.agent_id)
        author = builder.author_of(await _username(conn, job.user_id))
    folder = h.folder(agent)
    before = builder.dependencies(folder)
    result = await system_exec(h, folder, list(job.request["argv"]), author)
    change = builder.package_change(before, builder.dependencies(folder))
    if change:
        async with h.db() as conn:
            await send_notice(h, conn, agent.id, "builder", f"Thư viện đã thay đổi: {change}")
    return (result.stdout or "") + (result.stderr or "")
