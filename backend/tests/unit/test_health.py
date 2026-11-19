from fastapi.testclient import TestClient

from backend.main import create_app
from backend.settings import Settings


def _client(platform_env, db_ok=True, execd_ok=True):
    async def db():
        return db_ok

    async def execd():
        return execd_ok

    app = create_app(
        Settings(), checks={"db": db, "execd": execd}, migrate=_no_migrate, boot=_no_boot
    )
    return TestClient(app)


async def _no_migrate(settings):
    return None


async def _no_boot(settings, engine, report):
    return None


def test_health_ok(platform_env):
    with _client(platform_env) as client:
        r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True, "db": True, "execd": True}


def test_health_reports_failing_dependency(platform_env):
    with _client(platform_env, execd_ok=False) as client:
        r = client.get("/api/health")
    assert r.status_code == 503
    assert r.json() == {"ok": False, "db": True, "execd": False}


def test_health_check_exception_counts_as_down(platform_env):
    async def boom():
        raise OSError("refused")

    async def ok():
        return True

    app = create_app(
        Settings(), checks={"db": boom, "execd": ok}, migrate=_no_migrate, boot=_no_boot
    )
    with TestClient(app) as client:
        r = client.get("/api/health")
    assert r.status_code == 503
    assert r.json()["db"] is False


def test_boot_refuses_missing_platform_key(platform_env, clean_env):
    clean_env.delenv("SESSION_SECRET")
    app = create_app(Settings())
    try:
        with TestClient(app):
            raise AssertionError("lifespan should have failed")
    except RuntimeError as exc:
        assert "SESSION_SECRET" in str(exc)


def test_app_factory_exposes_module_app():
    from backend import main

    assert callable(main.create_app)


def test_boot_logs_preflight_by_name(platform_env, clean_env, tmp_path, caplog):
    domains = tmp_path / "domains"
    (domains / "d1" / "credentials").mkdir(parents=True)
    (domains / "d1" / "domain.yaml").write_text("id: d1\nname: D1\n")
    (domains / "d1" / "credentials" / "w.env.example").write_text("# description: x\nK=\n")
    clean_env.setenv("DOMAINS_DIR", str(domains))

    async def ok():
        return True

    caplog.set_level("INFO")
    with TestClient(
        create_app(Settings(), checks={"db": ok, "execd": ok}, migrate=_no_migrate, boot=_no_boot)
    ):
        pass
    text = caplog.text
    assert "preflight platform: ok" in text
    # Step 1 checks platform settings before migrations; database domains belong to step 3.
    assert "preflight domains: database unreachable, skipped" in text
    assert "preflight domain d1:" not in text
    assert caplog.records[0].name == "uvicorn.error"


async def test_boot_marks_domains_checked_after_database_validation(
    conn, platform_env, clean_env, tmp_path, monkeypatch
):
    from contextlib import asynccontextmanager

    from sqlalchemy import insert

    from backend import main, preflight
    from backend.db import tables as t

    clean_env.setenv("PLATFORM_DIR", str(tmp_path / "platform"))
    clean_env.setenv("DOMAINS_DIR", str(tmp_path / "domains"))
    await conn.execute(
        insert(t.domains).values(id="db-domain", name="Database domain", status="available")
    )

    @asynccontextmanager
    async def test_transaction(_engine):
        # Keep the production boot writes inside the fixture's rolled-back transaction.
        yield conn

    monkeypatch.setattr(main, "transaction", test_transaction)
    settings = Settings()
    report = await preflight.run(settings)
    assert not report.domains_checked
    await main.run_boot_steps(settings, conn.engine, report)
    assert report.domains_checked
    assert [domain.domain_id for domain in report.domains] == ["db-domain"]
    assert "domain db-domain: available" in report.lines()
    assert not any("database unreachable" in line for line in report.lines())


def test_boot_migrates_after_preflight(platform_env):
    calls = []

    async def migrate(settings):
        calls.append(settings.DATABASE_URL.get_secret_value())

    async def ok():
        return True

    app = create_app(Settings(), checks={"db": ok, "execd": ok}, migrate=migrate, boot=_no_boot)
    with TestClient(app):
        assert calls == [platform_env["DATABASE_URL"]]
        assert app.state.engine is not None
    assert len(calls) == 1


def test_boot_fails_when_migration_fails(platform_env):
    async def migrate(settings):
        raise RuntimeError("migration failed")

    app = create_app(Settings(), migrate=migrate)
    try:
        with TestClient(app):
            raise AssertionError("lifespan should have failed")
    except RuntimeError as exc:
        assert "migration failed" in str(exc)


def test_migration_skipped_when_preflight_fails(platform_env, clean_env):
    clean_env.delenv("SESSION_SECRET")
    calls = []

    async def migrate(settings):
        calls.append(1)

    try:
        with TestClient(create_app(Settings(), migrate=migrate)):
            pass
    except RuntimeError:
        pass
    assert calls == []


def test_default_migration_needs_database_url(platform_env, clean_env):
    clean_env.delenv("DATABASE_URL")
    try:
        with TestClient(create_app(Settings())):
            raise AssertionError("lifespan should have failed")
    except RuntimeError as exc:
        assert "DATABASE_URL" in str(exc)
