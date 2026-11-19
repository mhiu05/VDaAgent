"""Provisioning a user (doc 12 "Provisioning a user"): the `user_provision` job.

1. Create the lead (prompt: the domain's `is_lead` starter row, else `platform/lead/prompt.md`).
2. Create every starter of the domain (`domain_starters`), in alphabetical slug order.
3. For a group's technical owner, attach the lead to the group room; then set `status='active'`
   (one transaction).

Agents that already exist are skipped, so a retry continues where a failure stopped. A failure
sets `status='failed'` with `status_detail` naming the step.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select, update

from backend.agents import folders, jobs
from backend.db import tables as t
from backend.db.session import on_commit
from backend.domains.loader import load_domain
from backend.harness import routines

LEAD_AVATAR = {"emoji": "🧭", "color": "#0EA5E9"}
LEAD_NAME = "Điều phối"


async def progress(
    conn: Any,
    users: list[Any],
    *,
    include_finished: bool = False,
    include_agents: bool = False,
) -> dict[Any, dict]:
    """Where each provisioning user's job is, for the admin list: the job's status and the next
    agent to create (the job creates the lead, then starters in loader order, and commits each
    agent when it is ready). Built from `jobs`, `agents` and the domain's DB rows only — no job
    output. `include_finished` also reports accounts that are no longer provisioning, and
    `include_agents` adds a per-agent `ready | installing | pending` list (the group card).
    """
    users = users if include_finished else [u for u in users if u.status == "provisioning"]
    if not users:
        return {}
    ids = [u.id for u in users]
    j, a = t.jobs, t.agents
    job_status = dict(
        (
            await conn.execute(
                select(j.c.user_id, j.c.status).where(
                    j.c.user_id.in_(ids),
                    j.c.kind == "user_provision",
                    j.c.status.in_(("queued", "running")),
                )
            )
        ).all()
    )
    existing: dict[Any, set[str]] = {}
    for user_id, slug in (
        await conn.execute(select(a.c.user_id, a.c.slug).where(a.c.user_id.in_(ids)))
    ).all():
        existing.setdefault(user_id, set()).add(slug)
    domains: dict[str, Any] = {}
    out = {}
    for u in users:
        if u.domain_id not in domains:
            domains[u.domain_id] = await load_domain(conn, u.domain_id or "")
        steps = [("lead", "lead", LEAD_NAME)] + [
            (f"starter {s.slug}", s.slug, s.display_name or s.slug)
            for s in domains[u.domain_id].starters
        ]
        have = existing.get(u.id, set())
        pending = [(step, name) for step, slug, name in steps if slug not in have]
        step, agent = pending[0] if pending else (None, None)
        detail = {
            "job_status": job_status.get(u.id),
            "step": step,
            "agent": agent,
            "done": len(steps) - len(pending),
            "total": len(steps),
        }
        if include_agents:
            installing = next((slug for _, slug, _ in steps if slug not in have), None)
            detail["agents"] = [
                {
                    "slug": slug,
                    "name": name,
                    "state": (
                        "ready"
                        if slug in have
                        else "installing"
                        if detail["job_status"] == "running" and slug == installing
                        else "pending"
                    ),
                }
                for _, slug, name in steps
            ]
        out[u.id] = detail
    return out


async def _existing(conn: Any, user_id: Any) -> set[str]:
    rows = await conn.execute(select(t.agents.c.slug).where(t.agents.c.user_id == user_id))
    return set(rows.scalars().all())


async def _create(h: Any, user_id: Any, domain_id: str, **kw: Any) -> None:
    async with h.db() as conn:
        packages = await jobs.preset_packages(conn, kw.pop("preset_ids"), domain_id)
        row = await folders.create_agent(
            conn,
            settings=h.settings,
            execd=h.execd,
            user_id=user_id,
            domain_id=domain_id,
            presets=packages,
            **kw,
        )
        await routines.sync(h, conn, row)
        on_commit(conn, lambda: h.supervisor.start_agent(row.id, row.user_id))


async def user_provision(h: Any, job: Any) -> str:
    s = h.settings
    domain_id = job.request["domain_id"]
    done, step = [], "lead"
    try:
        # inside the try: a failed DB read marks the account failed instead of leaving it stuck
        async with h.db() as conn:
            domain = await load_domain(conn, domain_id)
            existing = await _existing(conn, job.user_id)
            prompt = (
                await folders.template_prompt(conn, s, domain_id, origin="lead", slug="lead") or ""
            )
        if "lead" not in existing:
            await _create(
                h,
                job.user_id,
                domain_id,
                slug="lead",
                display_name=LEAD_NAME,
                avatar=LEAD_AVATAR,
                description="Điều phối nhóm agent",
                origin="lead",
                is_lead=True,
                prompt=prompt,
                preset_ids=[],
                credential_sets=[],
            )
            done.append("lead")
        for starter in domain.starters:  # alphabetical (loader order)
            step = f"starter {starter.slug}"
            if starter.slug in existing:
                continue
            await _create(
                h,
                job.user_id,
                domain_id,
                slug=starter.slug,
                display_name=starter.display_name or starter.slug,
                avatar=starter.avatar or {"emoji": "🤖", "color": "#64748B"},
                description=starter.description,
                origin="starter",
                prompt=starter.prompt,
                preset_ids=starter.presets,
                credential_sets=starter.credentials,
            )
            done.append(starter.slug)
        # The room membership and active status commit together. For ordinary humans this is
        # a no-op, so their provisioning path stays the same.
        async with h.db() as conn:
            from backend import groups

            await groups.attach_lead_to_room(conn, job.user_id)
            await conn.execute(
                update(t.users)
                .where(t.users.c.id == job.user_id)
                .values(status="active", status_detail=None)
            )
    except Exception as e:
        reason = getattr(e, "message", "") or str(e)
        async with h.db() as conn:
            await conn.execute(
                update(t.users)
                .where(t.users.c.id == job.user_id)
                .values(status="failed", status_detail=f"{step}: {reason}"[:1000])
            )
        raise jobs.JobFailed(f"{step}: {reason}") from e
    return "created " + (", ".join(done) or "nothing (all agents existed)")
