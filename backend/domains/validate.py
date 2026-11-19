"""Domain validation, from Postgres (doc 12 "Validation").

Rules: 1 the domain has a row (name); 2 every credential-set key has a stored value; 3 no key
name appears in two of a domain's sets; 4 starters (display_name, presets, credential sets,
slug) — the `is_lead` starter is exempt (it only ever carries a prompt); 5 seed files (still
file-based — a deliberate scope cut, see the plan this shipped with) pass catalog validation
when a domain still has a `domains/<id>/seeds/` directory on disk. `sync_domains` upserts the
results into `domains`; every admin write calls it inline now, not only at boot. Credential
*values* are only ever checked for presence, never decrypted or returned here.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncConnection

from backend.catalog.validate import validate_preset_rows, validate_skill_rows
from backend.db import tables as t
from backend.notifications import notify

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,31}$")  # doc 04 / doc 10 `agents.slug`
SKILLS = "seeds/skills.yaml"
PRESETS = "seeds/library_presets.yaml"


@dataclass
class DomainResult:
    domain_id: str
    reasons: list[str] = field(default_factory=list)
    name: str | None = None  # from the `domains` row when it is valid
    # Seed ids, for the cross-domain check (skill and preset ids are table primary keys).
    seed_ids: dict[str, set[str]] = field(default_factory=dict)

    @property
    def available(self) -> bool:
        return not self.reasons


def _names(value: Any) -> bool:
    return isinstance(value, list) and all(isinstance(v, str) for v in value)


async def validate_domain(
    conn: AsyncConnection,
    domain_id: str,
    platform_dir: Path | None = None,
    domains_dir: Path | None = None,
) -> DomainResult:
    result = DomainResult(domain_id)
    reasons = result.reasons

    d = t.domains
    name = await conn.scalar(select(d.c.name).where(d.c.id == domain_id))
    if name is None:
        reasons.append("domains: no row")
        return result
    result.name = str(name)

    # rule 2 + 3: credential sets, declared keys, stored values
    cs, cv = t.domain_credential_sets, t.domain_credential_values
    sets = (
        (
            await conn.execute(
                select(cs.c.id, cs.c.name, cs.c["keys"])
                .where(cs.c.domain_id == domain_id)
                .order_by(cs.c.name)
            )
        )
        .mappings()
        .all()
    )
    owners: dict[str, list[str]] = {}
    for row in sets:
        set_id, set_name, keys = row["id"], row["name"], list(row["keys"] or [])
        for key in keys:
            owners.setdefault(key, []).append(set_name)
        if not keys:
            continue
        present = set(
            (await conn.execute(select(cv.c.key).where(cv.c.set_id == set_id))).scalars().all()
        )
        for key in keys:
            if key not in present:
                reasons.append(f"credentials/{set_name}: missing key {key}")

    for key, owner_sets in owners.items():
        if len(owner_sets) > 1:
            reasons.append(f"key {key} appears in credential sets {', '.join(owner_sets)}")

    set_names = {row["name"] for row in sets}

    # rule 5: seeds (file-based, scope cut)
    global_skills, global_presets = _global_seeds(platform_dir)
    domain_dir = (domains_dir / domain_id) if domains_dir else None
    domain_presets, seed_reasons = _check_seeds(domain_dir, result, global_skills, global_presets)
    known_presets = {p["id"] for p in global_presets} | domain_presets

    # rule 4: starters
    reasons.extend(await _check_starters(conn, domain_id, known_presets, set_names))
    reasons.extend(seed_reasons)
    return result


# --- rule 4: starters ---------------------------------------------------------------------


async def _check_starters(
    conn: AsyncConnection, domain_id: str, presets: set[str], sets: set[str]
) -> list[str]:
    reasons: list[str] = []
    s = t.domain_starters
    rows = (
        await conn.execute(select(s).where(s.c.domain_id == domain_id).order_by(s.c.slug))
    ).all()
    for r in rows:
        if r.is_lead:
            continue  # the lead carries only a prompt; no slug/preset/credential checks
        label = f"starters/{r.slug}"
        if not SLUG_RE.fullmatch(r.slug):
            reasons.append(f"{label}: invalid slug")
            continue
        if not (r.display_name or "").strip():
            reasons.append(f"{label}: needs display_name")
        for key, known, what in (
            (list(r.presets or []), presets, "preset"),
            (list(r.credentials or []), sets, "credential set"),
        ):
            reasons.extend(f"{label}: unknown {what} {name}" for name in key if name not in known)
    return reasons


# --- rule 5: seeds ------------------------------------------------------------------------


def read_yaml(path: Path) -> Any:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _read_rows(path: Path, label: str) -> tuple[list[Any] | None, str | None]:
    """(rows, reason). A missing or empty file is no rows."""
    if not path.is_file():
        return [], None
    try:
        data = read_yaml(path)
    except yaml.YAMLError:
        return None, f"{label}: does not parse"
    if data is None:
        return [], None
    if not isinstance(data, list):
        return None, f"{label}: must be a list"
    return data, None


def _global_seeds(platform_dir: Path | None) -> tuple[list[dict], list[dict]]:
    """Global rows that parse (their own validation is the catalog's, S9)."""
    if platform_dir is None:
        return [], []
    out = []
    for name in ("skills.yaml", "library_presets.yaml"):
        try:
            rows, _ = _read_rows(platform_dir / "seeds" / name, name)
        except OSError:
            rows = None
        out.append([r for r in rows or [] if isinstance(r, dict) and r.get("id")])
    return out[0], out[1]


def _check_seeds(
    directory: Path | None,
    result: DomainResult,
    global_skills: list[dict],
    global_presets: list[dict],
) -> tuple[set[str], list[str]]:
    """(this domain's preset ids, reasons). No `directory` (an admin-only, file-less domain)
    means no domain-specific seeds — not an error."""
    if directory is None:
        result.seed_ids = {PRESETS: set(), SKILLS: set()}
        return set(), []
    reasons: list[str] = []
    presets, why = _read_rows(directory / PRESETS, PRESETS)
    if why:
        reasons.append(why)
    else:
        reasons.extend(validate_preset_rows(presets, PRESETS, {p["id"] for p in global_presets}))
    skills, why = _read_rows(directory / SKILLS, SKILLS)
    if why:
        reasons.append(why)
    else:
        reasons.extend(validate_skill_rows(skills, SKILLS, global_skills))
    preset_ids = {
        r["id"] for r in presets or [] if isinstance(r, dict) and isinstance(r.get("id"), str)
    }
    result.seed_ids = {
        PRESETS: preset_ids,
        SKILLS: {
            r["id"] for r in skills or [] if isinstance(r, dict) and isinstance(r.get("id"), str)
        },
    }
    return preset_ids, reasons


def _cross_domain_seed_ids(results: list[DomainResult]) -> None:
    for label in (PRESETS, SKILLS):
        for r in results:
            for other in results:
                if other is r:
                    continue
                for seed_id in sorted(
                    r.seed_ids.get(label, set()) & other.seed_ids.get(label, set())
                ):
                    r.reasons.append(f"{label}: id {seed_id} also in domain {other.domain_id}")


async def validate_domains(
    conn: AsyncConnection, platform_dir: Path | None = None, domains_dir: Path | None = None
) -> list[DomainResult]:
    ids = (await conn.execute(select(t.domains.c.id).order_by(t.domains.c.id))).scalars().all()
    results = [await validate_domain(conn, i, platform_dir, domains_dir) for i in ids]
    _cross_domain_seed_ids(results)
    return results


# --- `sync_domains`: upsert `domains` (boot step 3, and every admin write from now on) ----


async def sync_domains(conn: AsyncConnection, results: list[DomainResult]) -> None:
    """Upsert one row per domain. Every admin domain/credential/starter write calls this inline,
    so a change is live immediately — not only re-read at the next boot.

    When a domain goes from available to unavailable, each of its users gets a `system`
    notification (doc 19).
    """
    d = t.domains
    before = dict((await conn.execute(select(d.c.id, d.c.status))).all())
    rows = [
        {
            "id": r.domain_id,
            "name": r.name or r.domain_id,
            "status": "available" if r.available else "unavailable",
            "status_reason": "\n".join(r.reasons) or None,
        }
        for r in results
    ]
    for row in rows:
        stmt = insert(d).values(**row, synced_at=func.now())
        changes = {k: stmt.excluded[k] for k in ("name", "status", "status_reason", "synced_at")}
        await conn.execute(stmt.on_conflict_do_update(index_elements=[d.c.id], set_=changes))

    newly_down = [
        row["id"]
        for row in rows
        if row["status"] == "unavailable" and before.get(row["id"]) == "available"
    ]
    if newly_down:
        q = select(t.users.c.id).where(
            t.users.c.domain_id.in_(newly_down),
            t.users.c.role == "user",
            t.users.c.account_type == "human",
        )
        for user_id in (await conn.execute(q)).scalars():
            await notify(conn, user_id, "domain_unavailable")
