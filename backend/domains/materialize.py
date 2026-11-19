"""Materializing a domain credential set into an agent's `.env.d/` (doc 12 "Domains").

Credentials are decrypted only here, by the backend process, and written straight into the
agent's own folder as a plain file — `execd` (`workspace/execd/run.py: build_env`) just reads it
with `dotenv_values`, exactly as when it was a symlink to a domain file. A sidecar
`<set>.env.keys` (key names only, never values) replaces the old `.example` file that
`backend.harness.render.credential_sets` used to resolve through the symlink target.

Rotation: editing a symlinked file used to update every agent instantly. A materialized (copied)
file doesn't, so `resync_credential_set` re-writes every agent currently using a set after its
values change.
"""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from backend.db import tables as t
from backend.domains.crypto import decrypt
from backend.settings import Settings


async def decrypted_values(
    conn: AsyncConnection, settings: Settings, domain_id: str, set_name: str
) -> dict[str, str] | None:
    """`{KEY: value}` for a domain's credential set, or `None` if the set doesn't exist."""
    cs, cv = t.domain_credential_sets, t.domain_credential_values
    set_id = await conn.scalar(
        select(cs.c.id).where(cs.c.domain_id == domain_id, cs.c.name == set_name)
    )
    if set_id is None:
        return None
    rows = (
        await conn.execute(select(cv.c.key, cv.c.ciphertext).where(cv.c.set_id == set_id))
    ).all()
    return {key: decrypt(settings, ciphertext) for key, ciphertext in rows}


def write_env_file(env_d: Path, set_name: str, values: dict[str, str]) -> None:
    """A plain `KEY=value` file plus its non-secret `.keys` sidecar, owner read/write only."""
    env_d.mkdir(exist_ok=True)
    path = env_d / f"{set_name}.env"
    path.write_text("".join(f"{k}={v}\n" for k, v in values.items()), encoding="utf-8")
    path.chmod(0o600)
    (env_d / f"{set_name}.env.keys").write_text("".join(f"{k}\n" for k in values), encoding="utf-8")


def remove_env_file(env_d: Path, set_name: str) -> None:
    for suffix in (".env", ".env.keys"):
        path = env_d / f"{set_name}{suffix}"
        if path.exists():
            path.unlink()


async def materialize(
    conn: AsyncConnection, settings: Settings, domain_id: str, set_name: str, env_d: Path
) -> dict[str, str]:
    """Decrypt + write; returns the values written, so a caller can report the key names
    (never the values themselves) in a "+set (keys)" notice."""
    values = await decrypted_values(conn, settings, domain_id, set_name)
    if values is None:
        raise ValueError(f"no such credential set: {set_name}")
    write_env_file(env_d, set_name, values)
    return values


async def resync_credential_set(
    conn: AsyncConnection, settings: Settings, domain_id: str, set_name: str
) -> int:
    """Rewrite `<set>.env` for every active agent under this domain that currently has it
    attached. Returns how many agents were updated."""
    from backend.agents.folders import folder_path  # local import: avoids a module cycle

    values = await decrypted_values(conn, settings, domain_id, set_name)
    if values is None:
        return 0
    a, u = t.agents, t.users
    rows = (
        await conn.execute(
            select(a.c.user_id, a.c.slug)
            .select_from(a.join(u, u.c.id == a.c.user_id))
            .where(u.c.domain_id == domain_id, a.c.state == "active")
        )
    ).all()
    n = 0
    for user_id, slug in rows:
        env_d = folder_path(settings, user_id, slug) / ".env.d"
        if (env_d / f"{set_name}.env").is_file():
            write_env_file(env_d, set_name, values)
            n += 1
    return n
