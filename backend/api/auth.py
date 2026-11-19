"""`/api/auth/*` (doc 15 "Auth"): login, logout, me."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import update

from backend import accounts
from backend.api.deps import AnyUser, Conn
from backend.api.errors import ApiError
from backend.api.middleware import clear_session_cookie, set_session_cookie
from backend.auth import passwords, sessions
from backend.auth.principal import CurrentUser, user_query
from backend.db import tables as t

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    username: str
    password: str


class DemoLoginBody(BaseModel):
    profile: Literal["admin", "vre-demo", "alice"]


@router.post("/login")
async def login(body: LoginBody, request: Request, response: Response, conn: Conn) -> dict:
    limiter = request.app.state.login_limiter
    username = accounts.normalize_username(body.username)
    if limiter.blocked(username):
        retry = limiter.retry_after(username)
        raise ApiError(429, "rate_limited", headers={"Retry-After": str(retry)})

    row = (await conn.execute(user_query().where(t.users.c.username == username))).one_or_none()
    if row is not None and row.account_type != "human":
        row = None  # a service account never logs in: answered exactly like an unknown user
    # Unknown users verify against a fixed hash: same response, about the same time.
    stored = row.password_hash if row else passwords.DUMMY_HASH
    ok = passwords.verify_password(stored, body.password)
    if row is None or not ok:
        limiter.fail(username)
        raise ApiError(401, "invalid_credentials")
    limiter.reset(username)
    if row.status == "disabled":
        raise ApiError(403, "user_disabled")

    if passwords.needs_rehash(row.password_hash):
        await conn.execute(
            update(t.users)
            .where(t.users.c.id == row.id)
            .values(password_hash=passwords.hash_password(body.password))
        )
    cookie = await sessions.create_session(conn, row.id)
    set_session_cookie(response, cookie, request.app.state.settings.COOKIE_SECURE)
    return CurrentUser.from_row(row).me()


@router.get("/demo/options")
async def demo_options(request: Request, conn: Conn, response: Response) -> dict:
    """Report demo availability without sending any credentials to the browser."""
    response.headers["Cache-Control"] = "no-store"
    settings = request.app.state.settings
    if not settings.DEMO_MODE:
        return {"available": []}
    available = []
    for profile in ("admin", "vre-demo", "alice"):
        username = settings.ADMIN_USERNAME if profile == "admin" else profile
        secret = (
            settings.ADMIN_PASSWORD if profile == "admin" else settings.DEMO_PASSWORD
        ).get_secret_value()
        if not secret:
            continue
        row = (await conn.execute(user_query().where(t.users.c.username == username))).one_or_none()
        role = "admin" if profile == "admin" else "user"
        if (
            row is not None
            and row.role == role
            and row.account_type == "human"
            and row.status == "active"
            and passwords.verify_password(row.password_hash, secret)
        ):
            available.append(profile)
    return {"available": available}


@router.post("/demo-login")
async def demo_login(body: DemoLoginBody, request: Request, response: Response, conn: Conn) -> dict:
    """Authenticate a configured demo identity through the regular login/session path."""
    settings = request.app.state.settings
    if not settings.DEMO_MODE:
        raise ApiError(404, "not_found")
    username = settings.ADMIN_USERNAME if body.profile == "admin" else body.profile
    password = (
        settings.ADMIN_PASSWORD if body.profile == "admin" else settings.DEMO_PASSWORD
    ).get_secret_value()
    if not password:
        raise ApiError(
            503, "demo_admin_unavailable" if body.profile == "admin" else "demo_unavailable"
        )
    row = (await conn.execute(user_query().where(t.users.c.username == username))).one_or_none()
    expected_role = "admin" if body.profile == "admin" else "user"
    if (
        row is None
        or row.role != expected_role
        or row.account_type != "human"
        or row.status != "active"
    ):
        raise ApiError(
            503, "demo_admin_unavailable" if body.profile == "admin" else "demo_unavailable"
        )
    try:
        return await login(LoginBody(username=username, password=password), request, response, conn)
    except ApiError as exc:
        if body.profile == "admin" and exc.status == 401:
            raise ApiError(503, "demo_admin_unavailable") from exc
        raise


@router.post("/demo/admin")
async def demo_admin(request: Request, response: Response, conn: Conn) -> dict:
    """Demo-only entry into a separate admin identity using the normal session mechanism."""
    settings = request.app.state.settings
    admin_password = settings.DEMO_ADMIN_PASSWORD.get_secret_value()
    if not settings.DEMO_MODE or not admin_password:
        raise ApiError(404, "not_found")
    row = (await conn.execute(user_query().where(t.users.c.username == "admin-demo"))).one_or_none()
    if (
        row is None
        or row.role != "admin"
        or row.account_type != "human"
        or row.status != "active"
        or not passwords.verify_password(row.password_hash, admin_password)
    ):
        raise ApiError(404, "not_found")
    cookie = await sessions.create_session(conn, row.id)
    set_session_cookie(response, cookie, request.app.state.settings.COOKIE_SECURE)
    return CurrentUser.from_row(row).me()


@router.post("/logout", status_code=204)
async def logout(request: Request, conn: Conn) -> Response:
    await sessions.delete_session(conn, request.cookies.get(sessions.COOKIE_NAME))
    response = Response(status_code=204)
    clear_session_cookie(response, request.app.state.settings.COOKIE_SECURE)
    return response


@router.get("/me")
async def me(user: AnyUser) -> dict:
    return user.me()
