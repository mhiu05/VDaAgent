"""Boot steps 3-5 end to end (doc 16 "Boot sequence"), on a scratch database.

The lifespan commits, so it runs against `<test db>_boot`, never the shared rolled-back one.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from backend.db import tables as t
from backend.db.session import create_engine, transaction
from backend.domains.import_from_files import _import_one
from backend.main import create_app, run_migrations
from backend.settings import Settings
from backend.tests.dbutil import recreate_database, with_database

ADMIN_PASSWORD = "boot-admin-password-xyz"
SECRET = "postgresql://reader:hunter2@db/cdw"


def _domains(root: Path) -> Path:
    good = root / "domains" / "fabrikam"
    (good / "credentials").mkdir(parents=True)
    (good / "domain.yaml").write_text("id: fabrikam\nname: Fabrikam Sales Ops\n")
    (good / "credentials/warehouse.env.example").write_text("# description: x\nWAREHOUSE_DSN=\n")
    (good / "credentials/warehouse.env").write_text(f"WAREHOUSE_DSN={SECRET}\n")
    bad = root / "domains" / "re-marketing"
    (bad / "credentials").mkdir(parents=True)
    (bad / "domain.yaml").write_text("id: re-marketing\nname: Real-estate marketing\n")
    (bad / "credentials/warehouse.env.example").write_text("# description: x\nWAREHOUSE_DSN=\n")
    return root / "domains"


@pytest.fixture
async def boot_url(database_url):
    from sqlalchemy.engine import make_url

    url = with_database(database_url, f"{make_url(database_url).database}_boot")
    await recreate_database(url)
    return url


async def _ok():
    return True


async def test_boot_upserts_domains_and_creates_the_admin(
    boot_url, platform_env, clean_env, tmp_path, caplog
):
    clean_env.setenv("DATABASE_URL", boot_url)
    clean_env.setenv("DOMAINS_DIR", str(_domains(tmp_path)))
    clean_env.setenv("PLATFORM_DIR", str(tmp_path / "platform"))
    clean_env.setenv("ADMIN_USERNAME", "Admin")
    clean_env.setenv("ADMIN_PASSWORD", ADMIN_PASSWORD)
    settings = Settings()
    # File import is an explicit deployment step now; boot validates persisted domains.
    await run_migrations(settings)
    engine = create_engine(boot_url)
    try:
        async with transaction(engine) as conn:
            for directory in sorted(Path(settings.DOMAINS_DIR).iterdir()):
                await _import_one(conn, settings, directory)
            # Force boot to recompute both statuses rather than accept the import defaults.
            await conn.execute(
                t.domains.update()
                .where(t.domains.c.id == "re-marketing")
                .values(status="available")
            )
    finally:
        await engine.dispose()
    caplog.set_level("DEBUG")

    for _ in range(2):  # the second boot changes nothing
        app = create_app(Settings(), checks={"db": _ok, "execd": _ok}, runtime=False)
        with TestClient(app, headers={"X-Contoso-Client": "web"}) as client:
            r = client.post(
                "/api/auth/login", json={"username": "admin", "password": ADMIN_PASSWORD}
            )
            assert r.status_code == 200, r.text
            assert r.json()["role"] == "admin"
            assert client.get("/api/admin/users").json() == []
            assert client.post("/api/auth/logout").status_code == 204

    assert ADMIN_PASSWORD not in caplog.text
    assert "hunter2" not in caplog.text
    assert "admin created" in caplog.text

    engine = create_engine(boot_url)
    try:
        async with engine.connect() as conn:
            domains = {r.id: r for r in (await conn.execute(select(t.domains))).all()}
            admins = (await conn.execute(select(t.users).where(t.users.c.role == "admin"))).all()
    finally:
        await engine.dispose()
    assert domains["fabrikam"].status == "available"
    assert domains["fabrikam"].name == "Fabrikam Sales Ops"
    assert domains["re-marketing"].status == "unavailable"
    assert (
        domains["re-marketing"].status_reason == "credentials/warehouse: missing key WAREHOUSE_DSN"
    )
    assert [a.username for a in admins] == ["admin"]
