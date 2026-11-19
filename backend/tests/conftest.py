import pytest

from backend.settings import Settings

# Every key the settings read; cleared so the test process environment never leaks in.
_ENV_KEYS = list(Settings.model_fields)


@pytest.fixture
def clean_env(monkeypatch, tmp_path):
    """Run with no settings keys in the environment and an empty cwd (no stray .env)."""
    for key in _ENV_KEYS:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.chdir(tmp_path)
    return monkeypatch


@pytest.fixture
def platform_env(clean_env):
    """A complete set of required platform keys."""
    from cryptography.fernet import Fernet

    values = {
        "CREDENTIAL_ENCRYPTION_KEY": Fernet.generate_key().decode(),
        "OPENROUTER_API_KEY": "sk-or-secret-value",
        "ADMIN_USERNAME": "admin",
        "ADMIN_PASSWORD": "admin-secret-value",
        "POSTGRES_PASSWORD": "pg-secret-value",
        "SESSION_SECRET": "session-secret-value",
        "EXECD_TOKEN": "execd-secret-value",
        # Never connected to in unit tests (migrations and checks are injected).
        "DATABASE_URL": "postgresql+asyncpg://contoso:pg-secret-value@127.0.0.1:1/contoso_unit",
    }
    for key, value in values.items():
        clean_env.setenv(key, value)
    return values


# --- Database (doc 17): a fresh `contoso_test` per run, one rolled-back transaction per test ---


@pytest.fixture(scope="session")
def database_url() -> str:
    import os

    url = os.environ.get("DATABASE_URL", "")
    if not url:
        pytest.skip("needs DATABASE_URL (compose.test.yaml or CI)")
    return url


@pytest.fixture(scope="session")
async def migrated_url(database_url):
    """Recreate the test database and run `alembic upgrade head` once per run."""
    import asyncio

    from backend.db import migrate
    from backend.tests.dbutil import recreate_database

    await recreate_database(database_url)
    await asyncio.to_thread(migrate.upgrade, database_url)
    return database_url


@pytest.fixture(scope="session")
async def engine(migrated_url):
    from backend.db.session import create_engine

    eng = create_engine(migrated_url)
    yield eng
    await eng.dispose()


@pytest.fixture
async def conn(engine):
    """A connection inside a transaction that is rolled back after the test."""
    async with engine.connect() as connection:
        trans = await connection.begin()
        try:
            yield connection
        finally:
            await trans.rollback()
