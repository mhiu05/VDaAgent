"""Health checks against the real compose services (compose.test.yaml)."""

import asyncio
import os

import pytest

from backend.main import default_checks
from backend.settings import Settings


@pytest.mark.skipif(not os.environ.get("DATABASE_URL"), reason="needs DATABASE_URL")
def test_db_check_reaches_postgres():
    assert asyncio.run(default_checks(Settings())["db"]()) is True


@pytest.mark.skipif(
    os.environ.get("CONTOSO_TEST_EXECD") != "1", reason="needs the workspace service"
)
def test_execd_check_reaches_workspace():
    assert asyncio.run(default_checks(Settings())["execd"]()) is True


def test_checks_fail_closed_when_unreachable():
    s = Settings(DATABASE_URL="postgresql://u:p@127.0.0.1:1/x", EXECD_URL="http://127.0.0.1:1")
    checks = default_checks(s)
    with pytest.raises(OSError):
        asyncio.run(checks["db"]())
    with pytest.raises(Exception):  # noqa: B017 - any transport error
        asyncio.run(checks["execd"]())


def test_boot_migrates_and_health_queries_the_db(migrated_url, platform_env, clean_env):
    """Boot step 2 against the real test database; `/api/health` runs `SELECT 1`."""
    from fastapi.testclient import TestClient

    from backend.main import create_app

    clean_env.setenv("DATABASE_URL", migrated_url)
    app = create_app(Settings())
    with TestClient(app) as client:
        assert app.state.engine is not None
        r = client.get("/api/health")
    assert r.json()["db"] is True
