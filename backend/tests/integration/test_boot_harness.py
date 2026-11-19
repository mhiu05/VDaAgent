"""Boot steps 6-9 (doc 16): restart handling, model windows, supervisor, internal API on :8001."""

from __future__ import annotations

import os

import httpx
import pytest

from backend.settings import Settings

pytestmark = pytest.mark.skipif(
    os.environ.get("CONTOSO_TEST_EXECD") != "1", reason="needs the compose test services"
)


def test_boot_starts_the_harness_and_the_internal_api(
    migrated_url, platform_env, clean_env, tmp_path
):
    from fastapi.testclient import TestClient

    from backend.main import create_app

    clean_env.setenv("DATABASE_URL", migrated_url)
    clean_env.setenv("EXECD_URL", os.environ.get("EXECD_URL", "http://workspace:7000"))
    settings = Settings(
        MODEL_BACKEND="fake",
        DOMAINS_DIR=str(tmp_path),
        INTERNAL_PORT=18001,
        PLATFORM_DIR=str(tmp_path),
    )
    app = create_app(settings, boot=None)
    with TestClient(app):
        h = app.state.harness
        assert h is not None and h.model.window("anthropic/claude-haiku-4.5") == 200_000
        r = httpx.get("http://127.0.0.1:18001/internal/v1/whoami", timeout=5)
        assert r.status_code == 401 and r.json()["error"] == "unauthenticated"
    with pytest.raises(httpx.HTTPError):
        httpx.get("http://127.0.0.1:18001/internal/v1/whoami", timeout=1)
