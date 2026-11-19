"""`/api` middleware: the `X-Contoso-Client: web` check (doc 12 "CSRF") and the session cookie.

Every `/api` request whose method isn't GET, HEAD or OPTIONS must carry `X-Contoso-Client: web`,
otherwise 403 `csrf`, before routing or auth. After a response, a session whose expiry slid
(`current_user` sets `request.state.refresh_session`) gets its cookie sent again so the
browser's copy slides too.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response

from backend.api.errors import error_response
from backend.auth import sessions

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
CLIENT_HEADER = "x-contoso-client"
CLIENT_VALUE = "web"


def set_session_cookie(response: Response, cookie: str, secure: bool) -> None:
    response.set_cookie(
        sessions.COOKIE_NAME,
        cookie,
        max_age=int(sessions.TTL.total_seconds()),
        path="/",
        httponly=True,
        samesite="lax",
        secure=secure,
    )


def clear_session_cookie(response: Response, secure: bool) -> None:
    response.delete_cookie(
        sessions.COOKIE_NAME, path="/", httponly=True, samesite="lax", secure=secure
    )


def install(app: FastAPI) -> None:
    @app.middleware("http")
    async def api_middleware(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        path = request.url.path
        if (
            path.startswith("/api")
            and request.method not in SAFE_METHODS
            and request.headers.get(CLIENT_HEADER) != CLIENT_VALUE
        ):
            return error_response(403, "csrf")
        response = await call_next(request)
        cookie = getattr(request.state, "refresh_session", None)
        if cookie and response.status_code < 400:
            set_session_cookie(response, cookie, request.app.state.settings.COOKIE_SECURE)
        return response
