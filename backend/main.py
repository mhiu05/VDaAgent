"""App factory and boot sequence for the `api` service (docs 02, 16).

Implemented: boot steps 1 (settings + preflight), 2 (`alembic upgrade head`), 3 (domains),
4 (catalog hook, S9) and 5 (admin); `GET /api/health`, `/api/auth/*`, `/api/admin/users*`.
Later sections add the remaining boot steps to `lifespan`.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from contextlib import asynccontextmanager
from pathlib import Path
from typing import TYPE_CHECKING, Any

import httpx
import uvicorn
from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine
from sqlalchemy.pool import NullPool

from backend import accounts, preflight
from backend.api import admin as admin_api
from backend.api import admin_domains as admin_domains_api
from backend.api import admin_users as admin_users_api
from backend.api import agents as agents_api
from backend.api import auth as auth_api
from backend.api import builder as builder_api
from backend.api import catalog as catalog_api
from backend.api import dashboard as dashboard_api
from backend.api import errors as api_errors
from backend.api import groups as groups_api
from backend.api import inbox as inbox_api
from backend.api import middleware as api_middleware
from backend.api import reports as reports_api
from backend.api import stream as stream_api
from backend.api import tasks as tasks_api
from backend.api import telegram as telegram_api
from backend.api import telegram_webhook as telegram_webhook_api
from backend.api import threads as threads_api
from backend.auth.ratelimit import LoginLimiter
from backend.catalog.seeds import upsert_catalogs
from backend.db import migrate as db_migrate
from backend.db.session import create_engine, transaction
from backend.domains.validate import sync_domains, validate_domains
from backend.settings import Settings

if TYPE_CHECKING:
    from backend.harness.model import ModelClient

# uvicorn configures this logger; S10 replaces it with structlog.
log = logging.getLogger("uvicorn.error")

HealthCheck = Callable[[], Awaitable[bool]]
Migrate = Callable[[Settings], Awaitable[None]]
Boot = Callable[[Settings, AsyncEngine, preflight.Report], Awaitable[None]]


async def run_migrations(settings: Settings) -> None:
    """Boot step 2: `alembic upgrade head` (blocking, so in a worker thread)."""
    url = settings.DATABASE_URL.get_secret_value()
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    await asyncio.to_thread(db_migrate.upgrade, url)


async def run_boot_steps(settings: Settings, engine: AsyncEngine, report: preflight.Report) -> None:
    """Boot steps 3-5 (doc 16), in one transaction."""
    async with transaction(engine) as conn:
        # Step 3: domains (rules 1-5 of doc 12) — validated here, now that the schema exists
        # and a connection is available; domains live in Postgres, not step 1's `.env` reads.
        domains_dir = Path(settings.DOMAINS_DIR) if settings.DOMAINS_DIR else None
        report.domains = await validate_domains(conn, Path(settings.PLATFORM_DIR), domains_dir)
        report.domains_checked = True
        for line in report.lines():
            log.info("preflight %s", line)
        await sync_domains(conn, report.domains)
        # Step 4: catalogs from the seeds (S9).
        await upsert_catalogs(conn, settings)
        # Step 5: the first admin. The password is never logged.
        # Doc 19 "Retention": the 500 newest notifications per user.
        from backend.notifications import prune

        await prune(conn)
        await accounts.ensure_admin(
            conn, settings.ADMIN_USERNAME, settings.ADMIN_PASSWORD.get_secret_value()
        )


def default_checks(
    settings: Settings, engine: Callable[[], AsyncEngine | None] | None = None
) -> dict[str, HealthCheck]:
    """`engine` returns the app's engine; without it the db check opens its own connection."""

    async def db() -> bool:
        eng = engine() if engine else None
        own = eng is None
        if own:
            eng = create_engine(settings.DATABASE_URL.get_secret_value(), poolclass=NullPool)
        try:
            async with asyncio.timeout(2), eng.connect() as conn:
                return (await conn.execute(text("SELECT 1"))).scalar() == 1
        finally:
            if own:
                await eng.dispose()

    async def execd() -> bool:
        async with httpx.AsyncClient(timeout=2) as client:
            r = await client.get(f"{settings.EXECD_URL.rstrip('/')}/health")
        return r.status_code == 200 and r.json().get("ok") is True

    return {"db": db, "execd": execd}


async def _safe(check: HealthCheck) -> bool:
    try:
        return bool(await check())
    except Exception:
        return False


def build_harness(settings: Settings, engine: AsyncEngine):
    """The harness over the app's engine, execd and the model client (doc 02)."""
    from backend.execd_client import ExecdClient
    from backend.harness.model import build_model_client
    from backend.harness.runtime import Harness

    return Harness(
        settings,
        db=lambda: transaction(engine),
        execd=ExecdClient(settings.EXECD_URL, settings.EXECD_TOKEN.get_secret_value()),
        model=build_model_client(settings),
    )


class _InternalServer(uvicorn.Server):
    """uvicorn for `:8001` inside the main process; the main server owns the signals."""

    def install_signal_handlers(self) -> None:  # uvicorn < 0.29
        pass

    @contextlib.contextmanager
    def capture_signals(self):  # uvicorn >= 0.29
        yield


def _warn_about_models(settings: Settings, model: ModelClient) -> None:
    """Setup mistakes in AGENT_MODEL / COMPACTION_MODEL, visible in the boot log (JEV_MODEL is
    served by the Decisions API, not listed by `GET /models`).

    Only warnings: a provider may serve a model it does not list, and the runner still fails
    each activation visibly when a model or capability is really missing.
    """
    if settings.MODEL_BACKEND == "fake":  # FakeModel's catalog is not the provider's
        return
    for key in ("AGENT_MODEL", "COMPACTION_MODEL"):
        name = getattr(settings, key)
        if model.listed(name) is False:
            log.warning("%s=%s is not in the provider's model list (GET /models)", key, name)
    if model.capabilities(settings.AGENT_MODEL).supports_tools is False:
        log.warning("AGENT_MODEL=%s does not advertise tool calling", settings.AGENT_MODEL)


async def start_runtime(app: FastAPI, settings: Settings) -> None:
    """Boot steps 6-9 (doc 16): restart handling, model windows, supervisor, `:8001`."""
    from backend.api.internal import create_internal_app
    from backend.harness.restart import reconcile

    harness = build_harness(settings, app.state.engine)
    app.state.harness = harness
    await harness.jobs.fail_stale()  # boot step 6
    await reconcile(harness)
    await harness.model.load_windows()
    _warn_about_models(settings, harness.model)
    await harness.supervisor.start()
    harness.scheduler.start()
    harness.jobs.start()
    from backend.harness.jev import reclassify_pending

    await reclassify_pending(harness)
    await start_telegram(app, settings, harness)
    server = _InternalServer(
        uvicorn.Config(
            create_internal_app(harness),
            host="0.0.0.0",
            port=settings.INTERNAL_PORT,
            log_level=None,
            log_config=None,
            lifespan="off",
        )
    )
    app.state.internal_server = server
    app.state.internal_task = asyncio.create_task(server.serve(), name="internal-api")
    while not server.started:
        if app.state.internal_task.done():
            app.state.internal_task.result()  # raises the bind error
            raise RuntimeError("internal API stopped during startup")
        await asyncio.sleep(0.02)
    log.info("harness started; internal API on :%s", settings.INTERNAL_PORT)


async def start_telegram(app: FastAPI, settings: Settings, harness: Any) -> None:
    """Optional: Telegram bot bridge (see the Telegram integration plan). No-op without a token."""
    app.state.telegram_client = None
    app.state.telegram_bridge = None
    token = settings.TELEGRAM_BOT_TOKEN.get_secret_value()
    if not token:
        return
    from backend.telegram_bridge import TelegramBridge, load_links
    from backend.telegram_client import TelegramClient

    client = TelegramClient(token)
    bridge = TelegramBridge(harness, client)
    for user_id, chat_id in await load_links(harness):
        bridge.watch(user_id, chat_id)
    app.state.telegram_client = client
    app.state.telegram_bridge = bridge


async def stop_telegram(app: FastAPI) -> None:
    bridge = getattr(app.state, "telegram_bridge", None)
    if bridge is not None:
        await bridge.stop()
    client = getattr(app.state, "telegram_client", None)
    if client is not None:
        await client.aclose()


async def stop_runtime(app: FastAPI) -> None:
    harness = getattr(app.state, "harness", None)
    server = getattr(app.state, "internal_server", None)
    await stop_telegram(app)
    if server is not None:
        server.should_exit = True
        with contextlib.suppress(Exception):
            await app.state.internal_task
    if harness is not None:
        await harness.scheduler.stop()
        await harness.jobs.stop()
        await harness.supervisor.stop_all()
        await harness.execd.aclose()
        await harness.model.aclose()


def create_app(
    settings: Settings | None = None,
    checks: Mapping[str, HealthCheck] | None = None,
    migrate: Migrate | None = None,
    boot: Boot | None = None,
    runtime: bool | None = None,
) -> FastAPI:
    """`runtime` starts the harness (boot steps 6-9); by default only with the real boot."""
    settings = settings or Settings()
    if runtime is None:
        runtime = boot is None and migrate is None
    migrate = migrate or run_migrations
    boot = boot or run_boot_steps

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # Boot step 1: settings + preflight (names only, never values). Domains live in
        # Postgres now, so they're validated in step 3, once the schema/connection exist.
        report = await preflight.run(settings)
        for line in report.lines():
            log.info("preflight %s", line)
        if not report.ok:
            raise RuntimeError("missing required keys: " + ", ".join(report.missing))
        app.state.preflight = report

        # Boot step 2: migrations, then the engine every later step uses.
        await migrate(settings)
        app.state.engine = create_engine(settings.DATABASE_URL.get_secret_value())
        log.info("database migrated to head")
        try:
            # Steps 3-5: domains, catalogs, admin.
            await boot(settings, app.state.engine, report)
            if runtime:
                await start_runtime(app, settings)
            yield
        finally:
            await stop_runtime(app)
            await app.state.engine.dispose()

    from backend.observability.logging import configure as configure_logging

    configure_logging(json_output=True)
    app = FastAPI(title="VDaAgent api", lifespan=lifespan)
    app.state.settings = settings
    app.state.engine = None
    app.state.harness = None
    app.state.telegram_client = None
    app.state.telegram_bridge = None
    app.state.login_limiter = LoginLimiter()
    api_errors.install(app)
    api_middleware.install(app)
    health_checks = (
        dict(checks)
        if checks is not None
        else default_checks(settings, engine=lambda: app.state.engine)
    )

    api = APIRouter(prefix="/api")

    @api.get("/health")
    async def health(request: Request) -> JSONResponse:
        names = list(health_checks)
        results = await asyncio.gather(*(_safe(health_checks[n]) for n in names))
        body = {"ok": all(results), **dict(zip(names, results, strict=True))}
        return JSONResponse(body, status_code=200 if body["ok"] else 503)

    api.include_router(auth_api.router)
    api.include_router(admin_users_api.router)
    api.include_router(admin_domains_api.router)
    api.include_router(admin_api.router)
    api.include_router(builder_api.router)
    api.include_router(agents_api.router)
    api.include_router(catalog_api.router)
    api.include_router(tasks_api.router)
    api.include_router(threads_api.router)
    api.include_router(groups_api.router)
    api.include_router(stream_api.router)
    api.include_router(reports_api.router)
    api.include_router(dashboard_api.router)
    api.include_router(inbox_api.router)
    api.include_router(telegram_api.router)
    app.include_router(api)
    app.include_router(telegram_webhook_api.router)
    return app


def __getattr__(name: str) -> FastAPI:
    # `uvicorn backend.main:app` builds the app on first access, so importing the
    # module (tests, tools) never reads the environment.
    if name == "app":
        global app
        app = create_app()
        return app
    raise AttributeError(name)
