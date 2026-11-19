"""Catalog seeds and boot step 4 (doc 05 "Catalog", "Libraries"; doc 16 boot sequence)."""

from __future__ import annotations

import shutil
from pathlib import Path

from sqlalchemy import select

from backend.catalog import seeds
from backend.db import tables as t
from backend.domains.validate import validate_domains
from backend.settings import Settings
from backend.tests.db.conftest import rows  # noqa: F401

REPO = Path(__file__).resolve().parents[3]


def test_shipped_seeds_are_valid():
    status = seeds.load(REPO / "platform", [])
    assert status.reasons == [] and status.marketplace is True
    assert {s["id"] for s in status.skills} == {"xlsx", "docx", "pdf", "pptx"}
    assert {p["id"] for p in status.presets} == {
        "data",
        "postgres",
        "charts",
        "stats",
        "documents",
        "web",
    }


async def test_shipped_domains_pass_the_starter_and_seed_rules(conn):
    from backend.domains.import_from_files import run

    settings = Settings(DOMAINS_DIR=str(REPO / "domains"), PLATFORM_DIR=str(REPO / "platform"))
    await run(REPO / "domains", settings, conn)
    results = {
        r.domain_id: r for r in await validate_domains(conn, REPO / "platform", REPO / "domains")
    }
    assert set(results) >= {"fabrikam"}
    for r in results.values():
        # only missing credential files may make a shipped domain unavailable here
        assert all("credential" in reason for reason in r.reasons), r.reasons


def _platform(tmp_path, skills: str | None = None, presets: str | None = None) -> Path:
    p = tmp_path / "platform"
    shutil.copytree(REPO / "platform", p)
    if skills is not None:
        (p / "seeds" / "skills.yaml").write_text(skills)
    if presets is not None:
        (p / "seeds" / "library_presets.yaml").write_text(presets)
    return p


async def test_upsert_inserts_global_and_domain_rows(conn, rows, tmp_path):  # noqa: F811
    await rows.domain("fabrikam")
    domain_dir = tmp_path / "domains" / "fabrikam" / "seeds"
    domain_dir.mkdir(parents=True)
    (domain_dir / "library_presets.yaml").write_text(
        "- id: vh-gis\n  title_vi: Bản đồ\n  description_vi: GIS\n  packages: [shapely]\n"
    )
    settings = Settings(PLATFORM_DIR=str(REPO / "platform"), DOMAINS_DIR=str(tmp_path / "domains"))
    status = await seeds.upsert_catalogs(conn, settings, available=["fabrikam"])
    assert status.marketplace is True
    skills = (await conn.execute(select(t.skill_catalog))).all()
    assert {s.id for s in skills} == {"xlsx", "docx", "pdf", "pptx"}
    xlsx = next(s for s in skills if s.id == "xlsx")
    assert xlsx.install_cmd[:3] == ["python", "-m", "contoso.skills"] and xlsx.domain_id is None
    presets = {p.id: p for p in (await conn.execute(select(t.library_presets))).all()}
    assert presets["vh-gis"].domain_id == "fabrikam" and presets["data"].domain_id is None
    assert presets["data"].packages[0].startswith("pandas")


async def test_upsert_updates_and_removes(conn, tmp_path):
    platform = _platform(tmp_path)
    settings = Settings(PLATFORM_DIR=str(platform), DOMAINS_DIR=str(tmp_path / "none"))
    await seeds.upsert_catalogs(conn, settings, available=[])
    text = (platform / "seeds" / "skills.yaml").read_text()
    head = text.split("- id: docx")[0].replace("Đọc & tạo file Excel", "Excel mới")
    (platform / "seeds" / "skills.yaml").write_text(head)
    await seeds.upsert_catalogs(conn, settings, available=[])
    skills = (await conn.execute(select(t.skill_catalog))).all()
    assert [(s.id, s.title_vi) for s in skills] == [("xlsx", "Excel mới")]


async def test_invalid_global_seeds_disable_the_marketplace(conn, tmp_path, caplog):
    platform = _platform(
        tmp_path,
        skills="- id: bad\n  name: bad\n  title_vi: x\n"
        "  description_vi: x\n  install_cmd: [sh, -c, x]\n",
    )
    settings = Settings(PLATFORM_DIR=str(platform), DOMAINS_DIR=str(tmp_path / "none"))
    status = await seeds.upsert_catalogs(conn, settings, available=[])
    assert status.marketplace is False and status.reasons
    assert "skills.yaml" in status.reasons[0]
    # presets still load; the skills table is left empty
    assert (await conn.execute(select(t.skill_catalog))).first() is None
    assert (await conn.execute(select(t.library_presets))).first() is not None
    assert seeds.STATUS.marketplace is False
