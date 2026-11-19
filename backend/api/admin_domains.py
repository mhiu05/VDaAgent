"""`/api/admin/domains*` (doc 12 "Domains"): admin-managed domains, credential sets and starters.

Every write re-validates and upserts `domains.status`/`status_reason` before returning, so the
response always reflects live status — no restart needed. Credential values are write-only:
no GET endpoint here ever returns one, only key names and whether each is filled.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, StringConstraints
from sqlalchemy import exists, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from backend.api.deps import Admin, Conn, require_admin
from backend.api.errors import ApiError
from backend.db import tables as t
from backend.domains import materialize
from backend.domains.crypto import encrypt
from backend.domains.validate import SLUG_RE, sync_domains, validate_domain

router = APIRouter(prefix="/admin/domains", tags=["admin"], dependencies=[Depends(require_admin)])

DOMAIN_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")
Name = Annotated[str, StringConstraints(min_length=1, max_length=200)]


async def _resync(conn: Conn, request: Request, domain_id: str) -> dict:
    """Re-validate this one domain (against the real global presets, so `unknown preset` is
    judged correctly) and upsert it into `domains`; returns its current status."""
    platform_dir = Path(request.app.state.settings.PLATFORM_DIR)
    result = await validate_domain(conn, domain_id, platform_dir, domains_dir=None)
    await sync_domains(conn, [result])
    return {
        "id": domain_id,
        "status": "available" if result.available else "unavailable",
        "status_reason": "\n".join(result.reasons) or None,
    }


async def _known_presets(conn: Conn, domain_id: str) -> set[str]:
    p = t.library_presets
    rows = await conn.execute(
        select(p.c.id).where(or_(p.c.domain_id.is_(None), p.c.domain_id == domain_id))
    )
    return set(rows.scalars().all())


# --- domains --------------------------------------------------------------------------------


class CreateDomain(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    name: Name


class RenameDomain(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Name


@router.get("")
async def list_domains(conn: Conn) -> list[dict]:
    d = t.domains
    rows = (await conn.execute(select(d).order_by(d.c.id))).all()
    out = []
    for r in rows:
        out.append(
            {
                "id": r.id,
                "name": r.name,
                "status": r.status,
                "status_reason": r.status_reason,
                "credential_sets": await _credential_sets_view(conn, r.id),
                "starters": await _starters_view(conn, r.id),
            }
        )
    return out


async def _credential_sets_view(conn: Conn, domain_id: str) -> list[dict]:
    cs, cv = t.domain_credential_sets, t.domain_credential_values
    sets = (
        (
            await conn.execute(
                select(cs.c.id, cs.c.name, cs.c.description, cs.c["keys"])
                .where(cs.c.domain_id == domain_id)
                .order_by(cs.c.name)
            )
        )
        .mappings()
        .all()
    )
    out = []
    for s in sets:
        keys = list(s["keys"] or [])
        filled = set(
            (await conn.execute(select(cv.c.key).where(cv.c.set_id == s["id"]))).scalars().all()
        )
        out.append(
            {
                "name": s["name"],
                "description": s["description"],
                "keys": [{"key": k, "filled": k in filled} for k in keys],
            }
        )
    return out


async def _starters_view(conn: Conn, domain_id: str) -> list[dict]:
    s = t.domain_starters
    rows = (
        await conn.execute(select(s).where(s.c.domain_id == domain_id).order_by(s.c.slug))
    ).all()
    return [
        {
            "slug": r.slug,
            "display_name": r.display_name,
            "description": r.description,
            "avatar": r.avatar,
            "presets": list(r.presets or []),
            "credentials": list(r.credentials or []),
            "prompt": r.prompt,
            "is_lead": r.is_lead,
        }
        for r in rows
    ]


@router.post("", status_code=201)
async def create_domain(body: CreateDomain, conn: Conn, admin: Admin, request: Request) -> dict:
    if not DOMAIN_ID_RE.fullmatch(body.id):
        raise ApiError(400, "invalid_domain_id")
    if await conn.scalar(select(exists().where(t.domains.c.id == body.id))):
        raise ApiError(409, "domain_taken")
    await conn.execute(
        t.domains.insert().values(
            id=body.id, name=body.name, status="unavailable", created_by=admin.username
        )
    )
    return await _resync(conn, request, body.id)


@router.patch("/{domain_id}")
async def rename_domain(domain_id: str, body: RenameDomain, conn: Conn, request: Request) -> dict:
    if not await conn.scalar(select(exists().where(t.domains.c.id == domain_id))):
        raise ApiError(404, "not_found")
    await conn.execute(t.domains.update().where(t.domains.c.id == domain_id).values(name=body.name))
    return await _resync(conn, request, domain_id)


# --- credential sets --------------------------------------------------------------------------


class CreateCredentialSet(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9-]{1,63}$")]
    description: str = ""
    keys: list[Annotated[str, StringConstraints(min_length=1, max_length=128)]]


class SetValues(BaseModel):
    model_config = ConfigDict(extra="forbid")
    values: dict[str, str]


async def _domain_or_404(conn: Conn, domain_id: str) -> None:
    if not await conn.scalar(select(exists().where(t.domains.c.id == domain_id))):
        raise ApiError(404, "not_found")


@router.post("/{domain_id}/credential-sets", status_code=201)
async def create_credential_set(
    domain_id: str, body: CreateCredentialSet, conn: Conn, request: Request
) -> dict:
    await _domain_or_404(conn, domain_id)
    cs = t.domain_credential_sets
    if await conn.scalar(
        select(exists().where(cs.c.domain_id == domain_id, cs.c.name == body.name))
    ):
        raise ApiError(409, "credential_set_taken")
    await conn.execute(
        cs.insert().values(
            domain_id=domain_id, name=body.name, description=body.description, keys=body.keys
        )
    )
    return await _resync(conn, request, domain_id)


@router.put("/{domain_id}/credential-sets/{name}/values")
async def set_credential_values(
    domain_id: str, name: str, body: SetValues, conn: Conn, admin: Admin, request: Request
) -> dict:
    cs = t.domain_credential_sets
    row = (
        (
            await conn.execute(
                select(cs.c.id, cs.c["keys"]).where(cs.c.domain_id == domain_id, cs.c.name == name)
            )
        )
        .mappings()
        .one_or_none()
    )
    if row is None:
        raise ApiError(404, "not_found")
    known = set(row["keys"] or [])
    unknown = [k for k in body.values if k not in known]
    if unknown:
        raise ApiError(400, "unknown_credential_key", ", ".join(unknown))
    settings = request.app.state.settings
    cv = t.domain_credential_values
    for key, value in body.values.items():
        if not value.strip():
            continue  # blank submissions are ignored, not stored as "filled"
        stmt = pg_insert(cv).values(
            set_id=row["id"],
            key=key,
            ciphertext=encrypt(settings, value),
            updated_by=admin.username,
        )
        await conn.execute(
            stmt.on_conflict_do_update(
                index_elements=[cv.c.set_id, cv.c.key],
                set_={
                    "ciphertext": stmt.excluded.ciphertext,
                    "updated_at": stmt.excluded.updated_at,
                    "updated_by": stmt.excluded.updated_by,
                },
            )
        )
    n = await materialize.resync_credential_set(conn, settings, domain_id, name)
    result = await _resync(conn, request, domain_id)
    result["resynced_agents"] = n
    return result


@router.delete("/{domain_id}/credential-sets/{name}", status_code=204)
async def delete_credential_set(domain_id: str, name: str, conn: Conn, request: Request) -> None:
    s = t.domain_starters
    in_use = await conn.scalar(
        select(exists().where(s.c.domain_id == domain_id, s.c.credentials.contains([name])))
    )
    if in_use:
        raise ApiError(409, "credential_set_in_use")
    cs = t.domain_credential_sets
    set_id = await conn.scalar(
        select(cs.c.id).where(cs.c.domain_id == domain_id, cs.c.name == name)
    )
    if set_id is None:
        raise ApiError(404, "not_found")
    await conn.execute(
        t.domain_credential_values.delete().where(t.domain_credential_values.c.set_id == set_id)
    )
    await conn.execute(cs.delete().where(cs.c.id == set_id))
    await _resync(conn, request, domain_id)


# --- starters ---------------------------------------------------------------------------------


class Avatar(BaseModel):
    model_config = ConfigDict(extra="forbid")
    emoji: str = "🤖"
    color: str = "#64748B"


class StarterIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slug: Annotated[str, StringConstraints(pattern=SLUG_RE.pattern)]
    display_name: Name
    description: str = ""
    avatar: Avatar = Avatar()
    presets: list[str] = []
    credentials: list[str] = []
    prompt: str = ""


async def _check_starter(conn: Conn, domain_id: str, body: StarterIn) -> None:
    known_presets = await _known_presets(conn, domain_id)
    unknown_presets = [p for p in body.presets if p not in known_presets]
    if unknown_presets:
        raise ApiError(400, "unknown_preset", ", ".join(unknown_presets))
    cs = t.domain_credential_sets
    known_sets = set(
        (await conn.execute(select(cs.c.name).where(cs.c.domain_id == domain_id))).scalars().all()
    )
    unknown_sets = [c for c in body.credentials if c not in known_sets]
    if unknown_sets:
        raise ApiError(400, "unknown_credential_set", ", ".join(unknown_sets))


@router.post("/{domain_id}/starters", status_code=201)
async def create_starter(domain_id: str, body: StarterIn, conn: Conn, request: Request) -> dict:
    await _domain_or_404(conn, domain_id)
    s = t.domain_starters
    if await conn.scalar(select(exists().where(s.c.domain_id == domain_id, s.c.slug == body.slug))):
        raise ApiError(409, "starter_taken")
    await _check_starter(conn, domain_id, body)
    await conn.execute(
        s.insert().values(
            domain_id=domain_id,
            slug=body.slug,
            display_name=body.display_name,
            description=body.description,
            avatar=body.avatar.model_dump(),
            presets=body.presets,
            credentials=body.credentials,
            prompt=body.prompt,
            is_lead=False,
        )
    )
    return await _resync(conn, request, domain_id)


@router.patch("/{domain_id}/starters/{slug}")
async def update_starter(
    domain_id: str, slug: str, body: StarterIn, conn: Conn, request: Request
) -> dict:
    s = t.domain_starters
    if not await conn.scalar(
        select(exists().where(s.c.domain_id == domain_id, s.c.slug == slug, s.c.is_lead.is_(False)))
    ):
        raise ApiError(404, "not_found")
    await _check_starter(conn, domain_id, body)
    await conn.execute(
        s.update()
        .where(s.c.domain_id == domain_id, s.c.slug == slug)
        .values(
            slug=body.slug,
            display_name=body.display_name,
            description=body.description,
            avatar=body.avatar.model_dump(),
            presets=body.presets,
            credentials=body.credentials,
            prompt=body.prompt,
        )
    )
    return await _resync(conn, request, domain_id)


@router.delete("/{domain_id}/starters/{slug}", status_code=204)
async def delete_starter(domain_id: str, slug: str, conn: Conn, request: Request) -> None:
    s = t.domain_starters
    result = await conn.execute(
        s.delete().where(s.c.domain_id == domain_id, s.c.slug == slug, s.c.is_lead.is_(False))
    )
    if result.rowcount == 0:
        raise ApiError(404, "not_found")
    await _resync(conn, request, domain_id)


class LeadPrompt(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prompt: str


@router.put("/{domain_id}/lead")
async def set_lead_prompt(domain_id: str, body: LeadPrompt, conn: Conn, request: Request) -> dict:
    await _domain_or_404(conn, domain_id)
    s = t.domain_starters
    existing = await conn.scalar(
        select(s.c.id).where(s.c.domain_id == domain_id, s.c.is_lead.is_(True))
    )
    if existing is None:
        await conn.execute(
            s.insert().values(domain_id=domain_id, slug="lead", prompt=body.prompt, is_lead=True)
        )
    else:
        await conn.execute(s.update().where(s.c.id == existing).values(prompt=body.prompt))
    return await _resync(conn, request, domain_id)


@router.delete("/{domain_id}/lead", status_code=204)
async def clear_lead_prompt(domain_id: str, conn: Conn, request: Request) -> None:
    s = t.domain_starters
    await conn.execute(s.delete().where(s.c.domain_id == domain_id, s.c.is_lead.is_(True)))
    await _resync(conn, request, domain_id)
