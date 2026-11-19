"""Demo users `alice`, `bob`, and `vre-demo` (Fabrikam) with `DEMO_PASSWORD` (doc 16).

`make up` runs this when `DEMO_PASSWORD` is set in `.env`. Each new user is created like the
admin's "Tạo người dùng" (status `provisioning` plus a provisioning job); the running `api`'s
job worker provisions them. Existing users are left alone, so every `make up` may run it.

    docker compose exec -T backend python -m backend.seed_demo
"""

from __future__ import annotations

import asyncio
import os
import sys

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncConnection

from backend import accounts
from backend.auth import passwords
from backend.db import tables as t

DEMO_USERS = (
    ("alice", "fabrikam", "Alice"),
    ("bob", "fabrikam", "Bob"),
    ("vre-demo", "fabrikam", "VRE Demo"),
)


async def seed(conn: AsyncConnection, password: str, admin_password: str = "") -> list[str]:
    created = []
    for username, domain_id, display_name in DEMO_USERS:
        if await conn.scalar(select(exists().where(t.users.c.username == username))):
            continue
        if not await conn.scalar(select(exists().where(t.domains.c.id == domain_id))):
            print(f"seed-demo: domain {domain_id} is not loaded; skipping {username}")
            continue
        await accounts.create_user(conn, username, password, domain_id, display_name)
        created.append(username)
    if admin_password:
        row = (
            await conn.execute(select(t.users.c.role).where(t.users.c.username == "admin-demo"))
        ).one_or_none()
        if row is None:
            await conn.execute(
                t.users.insert().values(
                    username="admin-demo",
                    display_name="Admin Demo",
                    password_hash=passwords.hash_password(admin_password),
                    role="admin",
                    status="active",
                )
            )
            created.append("admin-demo")
        elif row.role != "admin":
            raise RuntimeError("admin-demo is already used by a non-admin account")
    return created


async def main() -> int:
    from backend.db.session import create_engine, transaction
    from backend.settings import Settings

    settings = Settings()
    password = os.environ.get("DEMO_PASSWORD", "")
    if not password:
        print("seed-demo: set DEMO_PASSWORD", file=sys.stderr)
        return 2
    admin_password = settings.DEMO_ADMIN_PASSWORD.get_secret_value() if settings.DEMO_MODE else ""
    engine = create_engine(settings.DATABASE_URL.get_secret_value())
    try:
        async with transaction(engine) as conn:
            created = await seed(conn, password, admin_password)
    finally:
        await engine.dispose()
    print("seed-demo: created " + (", ".join(created) or "nothing (users exist)"))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
