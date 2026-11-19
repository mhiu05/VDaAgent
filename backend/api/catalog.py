"""`/api/catalog/*` (doc 15 "Catalogs"; doc 05). Users see the global rows plus their own
domain's; with the marketplace disabled, the skills routes answer 503 `marketplace_disabled`."""

from __future__ import annotations

from fastapi import APIRouter, Request
from sqlalchemy import any_, func, or_, select

from backend.api.deps import AnyUser, Conn, UserRole
from backend.api.errors import ApiError
from backend.catalog import preview, seeds
from backend.db import tables as t
from backend.domains.loader import load_domain

router = APIRouter(prefix="/catalog", tags=["catalog"])


def _visible(table, user):
    if user.domain_id:
        return or_(table.c.domain_id.is_(None), table.c.domain_id == user.domain_id)
    return table.c.domain_id.is_(None)


def _require_marketplace() -> None:
    if not seeds.STATUS.marketplace:
        raise ApiError(503, "marketplace_disabled", "Kho kỹ năng đang tạm tắt.")


@router.get("/skills")
async def list_skills(
    conn: Conn, user: AnyUser, q: str | None = None, tag: str | None = None
) -> list[dict]:
    _require_marketplace()
    s = t.skill_catalog
    query = select(s).where(_visible(s, user)).order_by(s.c.domain_id.nulls_first(), s.c.id)
    if q:
        like = f"%{q.strip()}%"
        query = query.where(
            or_(s.c.name.ilike(like), s.c.title_vi.ilike(like), s.c.description_vi.ilike(like))
        )
    if tag:
        query = query.where(any_(s.c.tags) == tag)
    rows = (await conn.execute(query)).all()
    return [
        {
            "id": r.id,
            "name": r.name,
            "title_vi": r.title_vi,
            "description_vi": r.description_vi,
            "tags": list(r.tags),
        }
        for r in rows
    ]


async def visible_skill(conn, user, skill_id: str):
    s = t.skill_catalog
    row = (await conn.execute(select(s).where(s.c.id == skill_id, _visible(s, user)))).one_or_none()
    if row is None:
        raise ApiError(404, "not_found")
    return row


@router.get("/skills/{skill_id}/preview")
async def skill_preview(skill_id: str, request: Request, conn: Conn, user: AnyUser) -> dict:
    _require_marketplace()
    row = await visible_skill(conn, user, skill_id)
    return await preview.fetch_preview(request.app.state.settings, list(row.install_cmd))


@router.get("/presets")
async def list_presets(conn: Conn, user: AnyUser) -> list[dict]:
    p = t.library_presets
    rows = (
        await conn.execute(
            select(p)
            .where(_visible(p, user))
            .order_by(p.c.domain_id.nulls_first(), func.lower(p.c.id))
        )
    ).all()
    return [
        {
            "id": r.id,
            "title_vi": r.title_vi,
            "description_vi": r.description_vi,
            "packages": list(r.packages),
        }
        for r in rows
    ]


async def domain_credential_sets(conn, domain_id: str | None) -> list[dict]:
    if not domain_id:
        return []
    cs = t.domain_credential_sets
    rows = (
        (
            await conn.execute(
                select(cs.c.name, cs.c.description, cs.c["keys"])
                .where(cs.c.domain_id == domain_id)
                .order_by(cs.c.name)
            )
        )
        .mappings()
        .all()
    )
    return [
        {"set": r["name"], "description": r["description"], "keys": list(r["keys"] or [])}
        for r in rows
    ]


@router.get("/credential-sets")
async def list_credential_sets(conn: Conn, user: UserRole) -> list[dict]:
    return await domain_credential_sets(conn, user.domain_id)


@router.get("/starters")
async def list_starters(conn: Conn, user: UserRole) -> list[dict]:
    """The domain's starters, for "Bắt đầu từ mẫu" when creating an agent (doc 05)."""
    if not user.domain_id:
        return []
    domain = await load_domain(conn, user.domain_id)
    return [
        {
            "slug": s.slug,
            "display_name": s.display_name or s.slug,
            "avatar": s.avatar or {"emoji": "🤖", "color": "#64748B"},
            "description": s.description,
            "presets": list(s.presets),
            "credentials": list(s.credentials),
        }
        for s in domain.starters
    ]
