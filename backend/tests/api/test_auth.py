"""`/api/auth/*` (docs 12 "Login", 15 "Auth") and the `X-Contoso-Client` check."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select, update

from backend.api import deps
from backend.api.errors import ApiError
from backend.auth import sessions
from backend.auth.principal import CurrentUser, user_query
from backend.db import tables as t
from backend.tests.api.conftest import PASSWORD, client_for

LOGIN = "/api/auth/login"


async def _session_count(conn, user_id=None):
    q = select(func.count()).select_from(t.auth_sessions)
    if user_id:
        q = q.where(t.auth_sessions.c.user_id == user_id)
    return (await conn.execute(q)).scalar()


async def test_login_sets_the_session_cookie_and_returns_me(client, accounts, conn):
    uid = await accounts.user("alice", display_name="Alice")
    r = await client.post(LOGIN, json={"username": "alice", "password": PASSWORD})
    assert r.status_code == 200
    assert r.json() == {
        "id": str(uid),
        "username": "alice",
        "display_name": "Alice",
        "role": "user",
        "status": "active",
        "domain": {"id": "fabrikam", "name": "Domain fabrikam", "status": "available"},
    }
    cookie = r.headers["set-cookie"]
    assert cookie.startswith("contoso_session=")
    attrs = [a.strip().lower() for a in cookie.split(";")]
    assert "httponly" in attrs
    assert "samesite=lax" in attrs
    assert "path=/" in attrs
    assert "secure" not in attrs
    assert f"max-age={7 * 24 * 3600}" in attrs
    assert await _session_count(conn, uid) == 1


async def test_cookie_is_secure_when_configured(make_app, accounts):
    app = make_app(COOKIE_SECURE=True)
    await accounts.user("alice")
    async with client_for(app) as c:
        r = await c.post(LOGIN, json={"username": "alice", "password": PASSWORD})
    assert r.status_code == 200
    assert "secure" in [a.strip().lower() for a in r.headers["set-cookie"].split(";")]


async def test_username_is_case_insensitive(client, accounts):
    await accounts.user("alice")
    r = await client.post(LOGIN, json={"username": "  Alice ", "password": PASSWORD})
    assert r.status_code == 200
    assert r.json()["username"] == "alice"


async def test_unknown_user_and_wrong_password_get_the_same_401(client, accounts, conn):
    await accounts.user("alice")
    wrong = await client.post(LOGIN, json={"username": "alice", "password": "nope"})
    unknown = await client.post(LOGIN, json={"username": "nobody", "password": PASSWORD})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()
    assert wrong.json()["error"] == "invalid_credentials"
    assert wrong.json()["message"]
    assert "set-cookie" not in wrong.headers
    assert await _session_count(conn) == 0


async def test_disabled_user_gets_403(client, accounts, conn):
    uid = await accounts.user("alice", status="disabled")
    r = await client.post(LOGIN, json={"username": "alice", "password": PASSWORD})
    assert r.status_code == 403
    assert r.json()["error"] == "user_disabled"
    assert await _session_count(conn, uid) == 0
    # A wrong password still says only "invalid credentials".
    r = await client.post(LOGIN, json={"username": "alice", "password": "nope"})
    assert r.status_code == 401


async def test_ten_failures_per_username_then_429(client, accounts):
    await accounts.user("alice")
    await accounts.user("bob")
    for _ in range(10):
        r = await client.post(LOGIN, json={"username": "alice", "password": "nope"})
        assert r.status_code == 401
    r = await client.post(LOGIN, json={"username": "ALICE", "password": PASSWORD})
    assert r.status_code == 429
    assert r.json()["error"] == "rate_limited"
    assert int(r.headers["retry-after"]) > 0
    r = await client.post(LOGIN, json={"username": "bob", "password": PASSWORD})
    assert r.status_code == 200


async def test_login_body_is_validated(client):
    r = await client.post(LOGIN, json={"username": "alice"})
    assert r.status_code == 400
    assert r.json()["error"] == "invalid_request"
    r = await client.post(LOGIN, content=b"not json", headers={"content-type": "application/json"})
    assert r.status_code == 400


async def test_me_requires_a_session(client):
    r = await client.get("/api/auth/me")
    assert r.status_code == 401
    assert r.json()["error"] == "unauthenticated"
    client.cookies.set("contoso_session", "garbage")
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_me_for_admin_has_no_domain(accounts):
    uid = await accounts.admin("root")
    async with await accounts.login("root") as c:
        r = await c.get("/api/auth/me")
    assert r.status_code == 200
    assert r.json() == {
        "id": str(uid),
        "username": "root",
        "display_name": "",
        "role": "admin",
        "status": "active",
        "domain": None,
    }


async def test_unavailable_domain_user_logs_in_and_sees_the_flag(accounts):
    await accounts.user("carol", domain="re-marketing", domain_status="unavailable")
    async with await accounts.login("carol") as c:
        me = (await c.get("/api/auth/me")).json()
    assert me["domain"]["status"] == "unavailable"


async def test_logout_deletes_the_session(accounts, conn):
    uid = await accounts.user("alice")
    async with await accounts.login("alice") as c:
        assert await _session_count(conn, uid) == 1
        r = await c.post("/api/auth/logout")
        assert r.status_code == 204
        assert "contoso_session=" in r.headers["set-cookie"]  # cleared
        assert await _session_count(conn, uid) == 0
        assert (await c.get("/api/auth/me")).status_code == 401
        assert (await c.post("/api/auth/logout")).status_code == 204  # idempotent


async def test_sliding_expiry_through_the_api(accounts, conn):
    uid = await accounts.user("alice")
    async with await accounts.login("alice") as c:
        r = await c.get("/api/auth/me")
        assert "set-cookie" not in r.headers  # used within the minute: nothing to slide
        old = datetime.now(UTC) - timedelta(minutes=5)
        await conn.execute(
            update(t.auth_sessions)
            .where(t.auth_sessions.c.user_id == uid)
            .values(last_seen_at=old, expires_at=old + timedelta(days=7))
        )
        r = await c.get("/api/auth/me")
        assert r.status_code == 200
        assert r.headers["set-cookie"].startswith("contoso_session=")
        row = (await conn.execute(select(t.auth_sessions))).one()
        assert row.last_seen_at > old + timedelta(minutes=4)
        assert row.expires_at > datetime.now(UTC) + timedelta(days=6, hours=23)


async def test_disabled_users_existing_session_stops_working(accounts):
    uid = await accounts.user("alice")
    async with await accounts.login("alice") as c:
        await accounts.set_status(uid, "disabled")
        assert (await c.get("/api/auth/me")).status_code == 401


# --- X-Contoso-Client (doc 12 "CSRF") -------------------------------------------------------


async def test_non_get_without_client_header_is_403_csrf(app, accounts):
    await accounts.user("alice")
    async with client_for(app, csrf=False) as c:
        r = await c.post(LOGIN, json={"username": "alice", "password": PASSWORD})
        assert r.status_code == 403
        assert r.json()["error"] == "csrf"
        r = await c.post(
            LOGIN,
            json={"username": "alice", "password": PASSWORD},
            headers={"X-Contoso-Client": "curl"},
        )
        assert r.status_code == 403
        for method in ("PUT", "PATCH", "DELETE"):
            r = await c.request(method, "/api/admin/users/x")
            assert (r.status_code, r.json()["error"]) == (403, "csrf")


async def test_get_needs_no_client_header(app):
    async with client_for(app, csrf=False) as c:
        r = await c.get("/api/auth/me")
    assert r.status_code == 401  # reaches auth, not the csrf check


# --- service accounts (a group's technical owner) are never request principals ---------------
# PLAN_GROUPCHAT §8: G1 login, G4 the human dependency root (G2/G3 in db/test_sessions.py).

SERVICE = "svc.0123456789abcdef"


async def test_service_account_login_is_an_invalid_credentials_401(client, accounts, conn):
    # Even with the right password stored, a service account is answered like an unknown user.
    await accounts.user(SERVICE, account_type="service")
    r = await client.post(LOGIN, json={"username": SERVICE, "password": PASSWORD})
    unknown = await client.post(LOGIN, json={"username": "nobody", "password": PASSWORD})
    assert r.status_code == 401
    assert r.json() == unknown.json()
    assert "set-cookie" not in r.headers
    assert await _session_count(conn) == 0


async def test_service_account_login_failures_count_for_the_rate_limit(client, accounts):
    await accounts.user(SERVICE, account_type="service")
    for _ in range(10):
        assert (
            await client.post(LOGIN, json={"username": SERVICE, "password": "x"})
        ).status_code == 401
    r = await client.post(LOGIN, json={"username": SERVICE, "password": PASSWORD})
    assert r.status_code == 429


async def _principal(conn, user_id) -> CurrentUser:
    row = (await conn.execute(user_query().where(t.users.c.id == user_id))).one()
    return CurrentUser.from_row(row)


async def test_human_dependency_root_rejects_a_service_principal(app, accounts, conn, monkeypatch):
    # Bypass G3 so the dependency root itself is what refuses the service principal.
    service = await _principal(conn, await accounts.user(SERVICE, account_type="service"))
    assert service.role == "user" and not service.is_human

    async def resolve(_conn, _cookie, now=None):
        return sessions.Resolved(service, datetime.now(UTC) + timedelta(days=1), False)

    monkeypatch.setattr(sessions, "resolve_session", resolve)
    async with client_for(app) as c:
        c.cookies.set("contoso_session", "x" * 43)
        for path in ("/api/auth/me", "/api/threads"):
            r = await c.get(path)
            assert r.status_code == 401, path
            assert r.json()["error"] == "unauthenticated"


async def test_require_user_needs_a_human(accounts, conn):
    human = await _principal(conn, await accounts.user("alice"))
    assert await deps.require_user(human) is human
    service = await _principal(conn, await accounts.user(SERVICE, account_type="service"))
    with pytest.raises(ApiError) as info:
        await deps.require_user(service)
    assert info.value.status == 403


async def test_humans_still_pass_the_dependencies(accounts):
    await accounts.user("alice")
    await accounts.admin("root")
    async with await accounts.login("alice") as c:
        assert (await c.get("/api/threads")).status_code == 200
    async with await accounts.login("root") as c:
        assert (await c.get("/api/admin/users")).status_code == 200
        assert (await c.get("/api/threads")).status_code == 403  # an admin has no team


async def test_demo_admin_is_hidden_without_explicit_demo_mode(make_app, accounts):
    await accounts.admin("admin-demo")
    async with client_for(
        make_app(DEMO_MODE=False, DEMO_ADMIN_PASSWORD="separate-demo-secret")
    ) as c:
        assert (await c.get("/api/auth/demo/options")).json() == {"available": []}
        assert (await c.post("/api/auth/demo/admin")).status_code == 404
        assert (await c.post("/api/auth/demo-login", json={"profile": "admin"})).status_code == 404


async def test_demo_admin_uses_normal_session_and_admin_rbac(make_app, accounts):
    await accounts.user("alice")
    await accounts.admin("admin-demo")
    app = make_app(DEMO_MODE=True, DEMO_PASSWORD=PASSWORD, DEMO_ADMIN_PASSWORD=PASSWORD)
    async with client_for(app) as c:
        options = await c.get("/api/auth/demo/options")
        assert options.status_code == 200
        assert options.headers["cache-control"] == "no-store"
        assert options.json() == {"available": ["alice"]}
        demo = await c.post("/api/auth/demo/admin")
        assert demo.status_code == 200
        assert demo.json()["username"] == "admin-demo"
        assert demo.json()["role"] == "admin"
        assert "httponly" in demo.headers["set-cookie"].lower()
        assert (await c.get("/api/auth/me")).json()["role"] == "admin"
        assert (await c.get("/api/admin/users")).status_code == 200
        assert (await c.get("/api/threads")).status_code == 403


async def test_demo_admin_rejects_wrong_identity_and_missing_secret(make_app, accounts):
    await accounts.user("admin-demo")
    app = make_app(DEMO_MODE=True, DEMO_ADMIN_PASSWORD="separate-demo-secret")
    async with client_for(app) as c:
        assert "admin" not in (await c.get("/api/auth/demo/options")).json()["available"]
        assert (await c.post("/api/auth/demo/admin")).status_code == 404
    app = make_app(DEMO_MODE=True, DEMO_ADMIN_PASSWORD="")
    async with client_for(app) as c:
        assert (await c.post("/api/auth/demo/admin")).status_code == 404


async def test_demo_admin_requires_the_configured_password_to_match(make_app, accounts):
    await accounts.admin("admin-demo")
    app = make_app(DEMO_MODE=True, DEMO_ADMIN_PASSWORD="stale-demo-secret")
    async with client_for(app) as c:
        assert "admin" not in (await c.get("/api/auth/demo/options")).json()["available"]
        assert (await c.post("/api/auth/demo/admin")).status_code == 404


async def test_quick_demo_login_uses_regular_cookie_and_never_returns_password(make_app, accounts):
    await accounts.admin("admin")
    await accounts.user("alice")
    await accounts.user("vre-demo")
    app = make_app(
        DEMO_MODE=True, ADMIN_USERNAME="admin", ADMIN_PASSWORD=PASSWORD, DEMO_PASSWORD=PASSWORD
    )
    async with client_for(app) as c:
        options = await c.get("/api/auth/demo/options")
        assert options.json() == {"available": ["admin", "vre-demo", "alice"]}
        assert PASSWORD not in options.text
        for profile, role in (("admin", "admin"), ("vre-demo", "user"), ("alice", "user")):
            result = await c.post("/api/auth/demo-login", json={"profile": profile})
            assert result.status_code == 200
            assert result.json()["username"] == profile
            assert result.json()["role"] == role
            assert "httponly" in result.headers["set-cookie"].lower()
            assert PASSWORD not in result.text
        assert (await c.post("/api/auth/demo-login", json={"profile": "other"})).status_code == 400


async def test_quick_admin_demo_reports_missing_configuration(make_app, accounts):
    await accounts.admin("admin")
    app = make_app(DEMO_MODE=True, ADMIN_USERNAME="admin", ADMIN_PASSWORD="")
    async with client_for(app) as c:
        result = await c.post("/api/auth/demo-login", json={"profile": "admin"})
        assert result.status_code == 503
        assert result.json()["error"] == "demo_admin_unavailable"
