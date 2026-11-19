"""The internal API on `api:8001/internal/v1` (doc 15 "Internal API"), called by `contoso` helpers
from inside an exec with `Authorization: Bearer <exec token>` (doc 11 "Exec token").

Each request runs in its own transaction (`harness.db()`). Routes are added by the sections
that own them: messaging (S7), tasks (S6), compaction (S8), reports and datasets (S11).
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, FastAPI, Request

from backend.api import errors as api_errors
from backend.api.errors import ApiError
from backend.harness.tokens import ExecContext, TokenError, verify

router = APIRouter(prefix="/internal/v1")


def harness_of(request: Request) -> Any:
    return request.app.state.harness


async def exec_caller(request: Request) -> ExecContext:
    h = harness_of(request)
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise ApiError(401, "unauthenticated")
    try:
        return verify(
            h.settings.SESSION_SECRET.get_secret_value(),
            header.removeprefix("Bearer "),
            h.registry,
            now=h.clock(),
        )
    except TokenError:
        raise ApiError(401, "unauthenticated") from None


Caller = Annotated[ExecContext, Depends(exec_caller)]


@router.get("/whoami")
async def whoami(caller: Caller) -> dict:
    """Which agent and exec a token belongs to (diagnostics; no side effects)."""
    return {
        "agent": caller.slug,
        "exec_id": caller.exec_id,
        "activation_kind": caller.activation_kind,
    }


# Routers that sections register for the internal app.
EXTRA_ROUTERS: list[APIRouter] = []


def create_internal_app(harness: Any) -> FastAPI:
    app = FastAPI(title="VDaAgent internal", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.harness = harness
    api_errors.install(app)
    app.include_router(router)
    from backend.harness import queue

    app.include_router(queue.internal_router)
    from backend.harness import compaction
    from backend.messaging import internal as messaging_internal
    from backend.reports import internal as reports_internal

    app.include_router(reports_internal.router)

    app.include_router(compaction.internal_router)

    app.include_router(messaging_internal.router)
    for extra in EXTRA_ROUTERS:
        app.include_router(extra)
    return app
