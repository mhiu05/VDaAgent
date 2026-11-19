"""Read a domain from Postgres (doc 12 "Domains"): `domain_credential_sets` for the
declarations, `domain_starters` for the team. Credential *values* are never read here — only
their set names — see `validate.py` for key-presence checks and `crypto.py` for decrypting a
value when it is actually needed (materializing an agent's `.env.d/<set>.env`).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from backend.db import tables as t

LEAD = "lead"


@dataclass
class Starter:
    slug: str
    display_name: str = ""
    description: str = ""
    avatar: dict[str, Any] = field(default_factory=dict)
    presets: list[str] = field(default_factory=list)
    credentials: list[str] = field(default_factory=list)
    prompt: str = ""


@dataclass
class Domain:
    id: str
    name: str
    credential_sets: list[str] = field(default_factory=list)
    starters: list[Starter] = field(default_factory=list)
    lead_prompt: str | None = None  # the `is_lead` starter row, overrides the platform lead role


async def credential_set_names(conn: AsyncConnection, domain_id: str) -> list[str]:
    cs = t.domain_credential_sets
    rows = await conn.execute(
        select(cs.c.name).where(cs.c.domain_id == domain_id).order_by(cs.c.name)
    )
    return list(rows.scalars().all())


async def load_domain(conn: AsyncConnection, domain_id: str) -> Domain:
    """A domain as the DB says it is now. Run `validate_domain` first; this one doesn't check."""
    d = t.domains
    name = await conn.scalar(select(d.c.name).where(d.c.id == domain_id))
    domain = Domain(
        id=domain_id,
        name=str(name) if name else domain_id,
        credential_sets=await credential_set_names(conn, domain_id),
    )
    s = t.domain_starters
    rows = (
        await conn.execute(select(s).where(s.c.domain_id == domain_id).order_by(s.c.slug))
    ).all()
    for r in rows:
        if r.is_lead:
            domain.lead_prompt = r.prompt or None
            continue
        domain.starters.append(
            Starter(
                slug=r.slug,
                display_name=r.display_name or "",
                description=r.description or "",
                avatar=dict(r.avatar or {}),
                presets=list(r.presets or []),
                credentials=list(r.credentials or []),
                prompt=r.prompt or "",
            )
        )
    return domain
