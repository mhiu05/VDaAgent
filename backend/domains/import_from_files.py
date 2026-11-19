"""One-time import: `domains/<id>/...` files → Postgres (doc 12 "Domains").

Brings every `domains/<id>/` folder (today `fabrikam`) into the DB-backed model; `make up`
runs it on each start. Reads the files
directly (does not use `backend.domains.loader`/`validate`, which are DB-only now) and encrypts
every credential value found on disk with `CREDENTIAL_ENCRYPTION_KEY`.

    docker compose exec backend python -m backend.domains.import_from_files

Safe to re-run: every insert is `ON CONFLICT DO UPDATE`.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import yaml
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection

from backend.db import tables as t
from backend.db.session import create_engine, transaction
from backend.domains.crypto import encrypt
from backend.domains.validate import sync_domains, validate_domains
from backend.settings import Settings

EXAMPLE_SUFFIX = ".env.example"


def _env_pairs(path: Path) -> dict[str, str]:
    out = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        out[key.removeprefix("export ").strip()] = value.strip().strip("'\"").strip()
    return out


def _mapping(path: Path, label: str) -> dict:
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError:
        # PyYAML errors include source snippets, which can contain credentials.
        raise ValueError(f"{label}: does not parse") from None
    if not isinstance(data, dict):
        raise ValueError(f"{label}: must be a mapping")
    return data


def _read_starters(directory: Path) -> list[dict]:
    """Validate file contracts before the importer makes any database changes."""
    starters_dir = directory / "starters"
    if not starters_dir.is_dir():
        return []
    starters = []
    for starter in sorted(p for p in starters_dir.iterdir() if p.is_dir()):
        label = f"starters/{starter.name}"
        agent_yaml = starter / "agent.yaml"
        prompt = starter / "prompt.md"
        is_lead = starter.name == "lead"
        if is_lead and agent_yaml.exists():
            raise ValueError(f"{label}/agent.yaml: the lead takes only prompt.md")
        spec = {}
        if not is_lead:
            if not agent_yaml.is_file():
                raise ValueError(f"{label}/agent.yaml: missing file")
            spec = _mapping(agent_yaml, f"{label}/agent.yaml")
            name = spec.get("display_name")
            if not isinstance(name, str) or not name.strip():
                raise ValueError(f"{label}/agent.yaml: needs display_name")
            for key in ("presets", "credentials"):
                value = spec.get(key, [])
                if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
                    raise ValueError(f"{label}/agent.yaml: {key} must be a list of names")
        if not prompt.is_file():
            raise ValueError(f"{label}/prompt.md: missing file")
        starters.append(
            {
                "slug": starter.name,
                "display_name": spec.get("display_name", ""),
                "description": str(spec.get("description") or ""),
                "avatar": spec.get("avatar") if isinstance(spec.get("avatar"), dict) else {},
                "presets": spec.get("presets", []),
                "credentials": spec.get("credentials", []),
                "prompt": prompt.read_text(encoding="utf-8"),
                "is_lead": is_lead,
            }
        )
    return starters


async def _import_one(conn: AsyncConnection, settings: Settings, directory: Path) -> str:
    domain_id = directory.name
    meta = {}
    meta_path = directory / "domain.yaml"
    if meta_path.is_file():
        meta = _mapping(meta_path, "domain.yaml")
    name = str(meta.get("name") or domain_id)
    starters = _read_starters(directory)

    d = t.domains
    stmt = pg_insert(d).values(id=domain_id, name=name, status="unavailable")
    await conn.execute(
        stmt.on_conflict_do_update(index_elements=[d.c.id], set_={"name": stmt.excluded.name})
    )

    cred_dir = directory / "credentials"
    examples = sorted(cred_dir.glob(f"*{EXAMPLE_SUFFIX}")) if cred_dir.is_dir() else []
    cs, cv = t.domain_credential_sets, t.domain_credential_values
    for example in examples:
        set_name = example.name.removesuffix(EXAMPLE_SUFFIX)
        keys = list(_env_pairs(example))
        description = ""
        first = example.read_text(encoding="utf-8").splitlines()[:1]
        if first and first[0].lower().startswith("# description:"):
            description = first[0].split(":", 1)[1].strip()
        stmt = pg_insert(cs).values(
            domain_id=domain_id, name=set_name, description=description, keys=keys
        )
        set_id = await conn.scalar(
            stmt.on_conflict_do_update(
                index_elements=[cs.c.domain_id, cs.c.name],
                set_={"description": stmt.excluded.description, "keys": stmt.excluded["keys"]},
            ).returning(cs.c.id)
        )
        real = cred_dir / f"{set_name}.env"
        if not real.is_file():
            continue
        for key, value in _env_pairs(real).items():
            if not value:
                continue
            vstmt = pg_insert(cv).values(
                set_id=set_id, key=key, ciphertext=encrypt(settings, value), updated_by="import"
            )
            await conn.execute(
                vstmt.on_conflict_do_update(
                    index_elements=[cv.c.set_id, cv.c.key],
                    set_={"ciphertext": vstmt.excluded.ciphertext, "updated_by": "import"},
                )
            )

    s = t.domain_starters
    for starter in starters:
        stmt = pg_insert(s).values(domain_id=domain_id, **starter)
        columns = (
            ("prompt",)
            if starter["is_lead"]
            else ("display_name", "description", "avatar", "presets", "credentials", "prompt")
        )
        await conn.execute(
            stmt.on_conflict_do_update(
                index_elements=[s.c.domain_id, s.c.slug],
                set_={key: stmt.excluded[key] for key in columns},
            )
        )
    return domain_id


async def run(domains_dir: Path, settings: Settings, conn: AsyncConnection) -> list[str]:
    if not domains_dir.is_dir():
        return []
    imported = []
    for directory in sorted(p for p in domains_dir.iterdir() if p.is_dir()):
        imported.append(await _import_one(conn, settings, directory))
    # Validate together so shared seed ids across domains are rejected as at boot.
    results = [
        result
        for result in await validate_domains(conn, Path(settings.PLATFORM_DIR), domains_dir)
        if result.domain_id in imported
    ]
    await sync_domains(conn, results)
    for r in results:
        print(f"domain {r.domain_id}: {'available' if r.available else 'unavailable'}")
        for reason in r.reasons:
            print(f"  - {reason}")
    return imported


async def main() -> int:
    settings = Settings()
    engine = create_engine(settings.DATABASE_URL.get_secret_value())
    try:
        async with transaction(engine) as conn:
            imported = await run(Path(settings.DOMAINS_DIR), settings, conn)
        print(f"imported {len(imported)} domain(s): {', '.join(imported) or '(none found)'}")
    finally:
        await engine.dispose()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
