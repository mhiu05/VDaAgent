"""`make up` readiness: wait for the demo users' teams, then check the demo can be used.

    python -m backend.readiness wait-demo [timeout_s]   # demo users leave `provisioning`
    python -m backend.readiness check                   # schema, domain, users, dashboards

Both read the database only. `wait-demo` polls the real provisioning state (no fixed sleep) and
fails on `failed` or on timeout; `check` prints one line per fact and exits 1 on any problem.
"""

from __future__ import annotations

import asyncio
import sys
import time
from typing import Any

from sqlalchemy import func, select, text

from backend.db import tables as t
from backend.seed_demo import DEMO_USERS

POLL_S = 3
DEFAULT_TIMEOUT_S = 900
DEMO_DOMAIN = "fabrikam"  # the supported Group Chat / dashboard demo domain


async def demo_states(db: Any) -> dict[str, tuple[str, int]]:
    """username → (status, active agents) for the demo users that exist."""
    u, a = t.users, t.agents
    names = [name for name, _, _ in DEMO_USERS]
    async with db() as conn:
        rows = (
            await conn.execute(
                select(u.c.username, u.c.status, func.count(a.c.id).filter(a.c.state == "active"))
                .select_from(u.outerjoin(a, a.c.user_id == u.c.id))
                .where(u.c.username.in_(names), u.c.account_type == "human")
                .group_by(u.c.username, u.c.status)
            )
        ).all()
    return {r[0]: (r[1], r[2]) for r in rows}


async def wait_demo(db: Any, timeout_s: float = DEFAULT_TIMEOUT_S, poll_s: float = POLL_S) -> int:
    """Wait until no demo user is `provisioning`. 0 when all are active, 1 otherwise."""
    deadline = time.monotonic() + timeout_s
    shown = None
    while True:
        states = await demo_states(db)
        summary = ", ".join(f"{n} {s} ({k} agents)" for n, (s, k) in sorted(states.items()))
        if summary != shown:
            print(f"wait-demo: {summary or 'no demo users'}", flush=True)
            shown = summary
        failed = [n for n, (s, _) in states.items() if s in ("failed", "disabled")]
        if failed:
            print(
                f"wait-demo: provisioning failed for {', '.join(sorted(failed))}; "
                "retry it from Admin > Users (Thử lại), then run make up again",
                file=sys.stderr,
            )
            return 1
        if all(s == "active" for s, _ in states.values()):
            return 0
        if time.monotonic() >= deadline:
            print(f"wait-demo: still provisioning after {int(timeout_s)} s", file=sys.stderr)
            return 1
        await asyncio.sleep(poll_s)


async def check(db: Any, alembic_head: str, settings: Any) -> list[str]:
    """Problems that keep the demo from working; prints the facts it verified."""
    from backend.dashboard_sync import candidates

    problems: list[str] = []
    async with db() as conn:
        version = await conn.scalar(text("SELECT version_num FROM alembic_version"))
        domain = await conn.scalar(select(t.domains.c.status).where(t.domains.c.id == DEMO_DOMAIN))
        starters = await conn.scalar(
            select(func.count())
            .select_from(t.domain_starters)
            .where(t.domain_starters.c.domain_id == DEMO_DOMAIN)
        )
    if version == alembic_head:
        print(f"check: database schema at {version} (head)")
    else:
        problems.append(f"database schema at {version}, source head is {alembic_head}")
    if domain == "available" and starters:
        print(f"check: domain {DEMO_DOMAIN} available ({starters} starters)")
    else:
        problems.append(f"domain {DEMO_DOMAIN} is {domain or 'missing'} with {starters} starters")
    for name, (status, agents) in sorted((await demo_states(db)).items()):
        if status == "active" and agents:
            print(f"check: demo user {name} active with {agents} agents")
        else:
            problems.append(f"demo user {name} is {status} with {agents} agents")
    for agent in await candidates(db, settings):
        async with db() as conn:
            n = await conn.scalar(
                select(func.count())
                .select_from(t.datasets)
                .where(t.datasets.c.user_id == agent.user_id, t.datasets.c.kind == "dashboard")
            )
        if n:
            print(f"check: dashboard dataset for {agent.username}")
        else:
            problems.append(f"no dashboard dataset for {agent.username}")
    return problems


async def main(argv: list[str]) -> int:
    from alembic.script import ScriptDirectory

    from backend.db import migrate
    from backend.db.session import create_engine, transaction
    from backend.settings import Settings

    settings = Settings()
    url = settings.DATABASE_URL.get_secret_value()
    engine = create_engine(url)

    def db():
        return transaction(engine)

    try:
        if argv[:1] == ["wait-demo"]:
            timeout = float(argv[1]) if len(argv) > 1 else DEFAULT_TIMEOUT_S
            return await wait_demo(db, timeout)
        if argv[:1] == ["check"]:
            head = ScriptDirectory.from_config(migrate.config(url)).get_current_head()
            problems = await check(db, head, settings)
            for p in problems:
                print(f"check: PROBLEM: {p}", file=sys.stderr)
            return 1 if problems else 0
        print("usage: python -m backend.readiness wait-demo [timeout_s] | check", file=sys.stderr)
        return 2
    finally:
        await engine.dispose()


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1:])))
