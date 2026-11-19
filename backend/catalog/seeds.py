"""Boot step 4: upsert `skill_catalog` and `library_presets` from the seeds (doc 05).

Global rows come from `platform/seeds/{skills,library_presets}.yaml` (`domain_id` null); each
available domain adds `domains/<id>/seeds/*` (validated with the domain, doc 12 rule 5). Rows
are upserted by `id`, and rows no longer in any seed are removed. If the global skill seeds fail
validation, the marketplace is disabled (`STATUS.marketplace`), the reason is logged by file
name, and the skills table is left empty; everything else still runs.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection

from backend.catalog.validate import validate_preset_rows, validate_skill_rows
from backend.db import tables as t
from backend.domains.validate import PRESETS, SKILLS, _read_rows
from backend.settings import Settings

log = logging.getLogger("uvicorn.error")


@dataclass
class CatalogStatus:
    marketplace: bool = True
    reasons: list[str] = field(default_factory=list)
    skills: list[dict] = field(default_factory=list)
    presets: list[dict] = field(default_factory=list)


STATUS = CatalogStatus()


def load(platform_dir: Path, domain_dirs: list[Path]) -> CatalogStatus:
    """Read and validate the global seeds, then add each domain's (already validated) rows."""
    status = CatalogStatus()
    skills, why = _read_rows(Path(platform_dir) / SKILLS, "platform/seeds/skills.yaml")
    skill_reasons = (
        [why] if why else validate_skill_rows(skills or [], "platform/seeds/skills.yaml")
    )
    presets, why = _read_rows(Path(platform_dir) / PRESETS, "platform/seeds/library_presets.yaml")
    preset_reasons = (
        [why] if why else validate_preset_rows(presets or [], "platform/seeds/library_presets.yaml")
    )
    status.reasons = skill_reasons + preset_reasons
    status.marketplace = not skill_reasons
    status.skills = [dict(r, domain_id=None) for r in skills or []] if status.marketplace else []
    status.presets = [] if preset_reasons else [dict(r, domain_id=None) for r in presets or []]
    for directory in domain_dirs:
        for label, target in ((SKILLS, status.skills), (PRESETS, status.presets)):
            rows, why = _read_rows(directory / label, label)
            if not why:
                target.extend(dict(r, domain_id=directory.name) for r in rows or [])
    if not status.marketplace:
        status.skills = [s for s in status.skills if s["domain_id"] is not None]
    return status


async def _available_domains(conn: AsyncConnection) -> list[str]:
    rows = await conn.execute(select(t.domains.c.id).where(t.domains.c.status == "available"))
    return list(rows.scalars().all())


async def _sync(conn: AsyncConnection, table: Any, rows: list[dict], columns: list[str]) -> None:
    ids = [r["id"] for r in rows]
    if rows:
        values = [{c: r.get(c) for c in ["id", *columns]} for r in rows]
        for v in values:
            if "tags" in v and v["tags"] is None:
                v["tags"] = []
        stmt = pg_insert(table).values(values)
        await conn.execute(
            stmt.on_conflict_do_update(
                index_elements=[table.c.id], set_={c: stmt.excluded[c] for c in columns}
            )
        )
    await conn.execute(delete(table).where(table.c.id.not_in(ids)) if ids else delete(table))


async def upsert_catalogs(
    conn: AsyncConnection, settings: Settings, available: list[str] | None = None
) -> CatalogStatus:
    if available is None:
        available = await _available_domains(conn)
    domains_dir = Path(settings.DOMAINS_DIR)
    status = load(Path(settings.PLATFORM_DIR), [domains_dir / d for d in sorted(available)])
    for reason in status.reasons:
        log.warning("catalog seed: %s", reason)
    if not status.marketplace:
        log.warning("catalog: the global skill seeds are invalid; the marketplace is disabled")
    await _sync(
        conn,
        t.skill_catalog,
        status.skills,
        ["name", "title_vi", "description_vi", "tags", "install_cmd", "domain_id"],
    )
    await _sync(
        conn,
        t.library_presets,
        status.presets,
        ["title_vi", "description_vi", "packages", "domain_id"],
    )
    STATUS.marketplace, STATUS.reasons = status.marketplace, status.reasons
    STATUS.skills, STATUS.presets = status.skills, status.presets
    return status
