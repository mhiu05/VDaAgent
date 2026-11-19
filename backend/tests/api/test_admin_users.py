"""Admin user endpoints (docs 12 "Provisioning a user" and "User management", 15 Admin API)."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select

from backend import accounts as accounts_module
from backend.auth import passwords
from backend.db import tables as t
from backend.tests.api.conftest import PASSWORD

USERS = "/api/admin/users"


@pytest.fixture
async def admin(accounts):
    await accounts.admin()
    async with await accounts.login("admin") as c:
        yield c


async def _user(conn, uid):
    return (await conn.execute(select(t.users).where(t.users.c.id == uid))).one()


async def _notes(conn, uid):
    q = (
        select(t.user_notifications)
        .where(t.user_notifications.c.user_id == uid)
        .order_by(t.user_notifications.c.occurred_at, t.user_notifications.c.kind)
    )
    return (await conn.execute(q)).all()


async def _sessions(conn, uid):
    q = select(func.count()).select_from(t.auth_sessions).where(t.auth_sessions.c.user_id == uid)
    return (await conn.execute(q)).scalar()


async def test_list_users(admin, accounts):
    alice = await accounts.user("alice", display_name="Alice")
    await accounts.user("carol", domain="re-marketing", domain_status="unavailable")
    r = await admin.get(USERS)
    assert r.status_code == 200
    body = r.json()
    assert [u["username"] for u in body] == ["alice", "carol"]  # users only, not admins
    a = body[0]
    assert a["id"] == str(alice)
    assert a["display_name"] == "Alice"
    assert a["role"] == "user"
    assert a["status"] == "active"
    assert a["status_detail"] is None
    assert a["domain"] == {"id": "fabrikam", "name": "Domain fabrikam", "status": "available"}
    assert a["created_at"].endswith("+00:00")
    assert "password_hash" not in a
    assert body[1]["domain"]["status"] == "unavailable"


async def test_create_user_inserts_provisioning_user_and_a_job(admin, accounts, conn, rows):
    await rows.domain("fabrikam", name="Fabrikam Sales Ops")
    body = {"username": "Alice", "password": "s3cret-pass", "domain_id": "fabrikam"}
    r = await admin.post(USERS, json=body)
    assert r.status_code == 202, r.text
    out = r.json()
    user = out["user"]
    assert user["username"] == "alice"
    assert user["status"] == "provisioning"
    assert user["display_name"] == ""
    assert user["domain"]["id"] == "fabrikam"

    row = await _user(conn, uuid.UUID(user["id"]))
    assert row.role == "user"
    assert passwords.verify_password(row.password_hash, "s3cret-pass")

    job = (await conn.execute(select(t.jobs).where(t.jobs.c.id == uuid.UUID(out["job_id"])))).one()
    assert job.kind == "user_provision"
    assert job.status == "queued"
    assert job.user_id == row.id
    assert job.agent_id is None
    assert "s3cret-pass" not in str(job.request)

    [note] = await _notes(conn, row.id)
    assert note.kind == "account-created"
    assert note.target == {"kind": "account"}
    assert note.title["vi"] and note.title["en"]


async def test_create_with_display_name_and_login_works(admin, accounts, rows):
    await rows.domain("fabrikam")
    body = {"username": "bob", "password": PASSWORD, "domain_id": "fabrikam", "display_name": "Bob"}
    r = await admin.post(USERS, json=body)
    assert r.json()["user"]["display_name"] == "Bob"
    async with await accounts.login("bob") as c:
        me = (await c.get("/api/auth/me")).json()
    assert me["display_name"] == "Bob"


async def test_create_validation(admin, accounts, rows):
    await rows.domain("fabrikam")
    await accounts.user("taken")
    ok = {"username": "newbie", "password": "pw-123456", "domain_id": "fabrikam"}
    cases = [
        ({**ok, "username": "a b"}, 400, "invalid_request"),
        ({**ok, "username": "xy"}, 400, "invalid_request"),
        ({**ok, "password": ""}, 400, "invalid_request"),
        ({**ok, "domain_id": "nope"}, 400, "invalid_request"),
        ({**ok, "display_name": "x" * 101}, 400, "invalid_request"),
        ({k: v for k, v in ok.items() if k != "domain_id"}, 400, "invalid_request"),
        ({**ok, "username": "TAKEN"}, 409, "username_taken"),
    ]
    for body, status, code in cases:
        r = await admin.post(USERS, json=body)
        assert (r.status_code, r.json()["error"]) == (status, code), body


async def test_service_accounts_are_not_listed_or_managed_here(admin, accounts):
    # A group's technical owner stores role='user' but is not a person (PLAN_GROUPCHAT §8).
    await accounts.user("alice")
    service = await accounts.user("svc.0123456789abcdef", account_type="service")
    r = await admin.get(USERS)
    assert [u["username"] for u in r.json()] == ["alice"]
    r = await admin.patch(f"{USERS}/{service}", json={"disabled": True})
    assert (r.status_code, r.json()["error"]) == (404, "not_found")


async def test_the_svc_username_prefix_is_reserved(admin, rows, conn):
    await rows.domain("fabrikam")
    for username in ("svc.foo", "SVC.test123"):
        body = {"username": username, "password": "pw-123456", "domain_id": "fabrikam"}
        r = await admin.post(USERS, json=body)
        assert (r.status_code, r.json()["error"]) == (400, "invalid_request"), username
    with pytest.raises(ValueError):
        await accounts_module.create_user(conn, "svc.direct", "pw-123456", "fabrikam")
    assert (await conn.execute(select(t.users).where(t.users.c.username.like("svc.%")))).all() == []
    r = await admin.post(
        USERS, json={"username": "svcfoo", "password": "pw", "domain_id": "fabrikam"}
    )
    assert r.status_code == 202  # only the "svc." prefix is reserved


async def test_cannot_create_an_admin_or_take_the_admins_name(admin):
    r = await admin.post(USERS, json={"username": "admin", "password": "p", "domain_id": "x"})
    assert r.status_code in (400, 409)


async def test_disable_deletes_sessions_and_blocks_login(admin, accounts, conn):
    uid = await accounts.user("alice")
    alice = await accounts.login("alice")
    assert await _sessions(conn, uid) == 1

    r = await admin.patch(f"{USERS}/{uid}", json={"disabled": True})
    assert r.status_code == 200
    assert r.json()["status"] == "disabled"
    assert await _sessions(conn, uid) == 0
    assert (await alice.get("/api/auth/me")).status_code == 401
    await alice.aclose()

    from backend.tests.api.conftest import client_for

    async with client_for(accounts.app) as c:
        r = await c.post("/api/auth/login", json={"username": "alice", "password": PASSWORD})
    assert (r.status_code, r.json()["error"]) == (403, "user_disabled")

    [note] = await _notes(conn, uid)
    assert note.kind == "system"
    assert note.target == {"kind": "system-detail", "notificationId": str(note.id)}

    # Disabling again changes nothing and sends nothing.
    r = await admin.patch(f"{USERS}/{uid}", json={"disabled": True})
    assert r.status_code == 200
    assert len(await _notes(conn, uid)) == 1


async def test_enable_sets_active(admin, accounts, conn):
    uid = await accounts.user("alice", status="disabled")
    await accounts.rows.agent(uid, slug="lead", is_lead=True, origin="lead")  # provisioned
    r = await admin.patch(f"{USERS}/{uid}", json={"disabled": False})
    assert r.status_code == 200
    assert r.json()["status"] == "active"
    async with await accounts.login("alice"):
        pass


async def test_enable_leaves_a_non_disabled_status_alone(admin, accounts):
    uid = await accounts.user("alice", status="provisioning")
    r = await admin.patch(f"{USERS}/{uid}", json={"disabled": False})
    assert r.json()["status"] == "provisioning"


async def test_reset_password(admin, accounts, conn):
    uid = await accounts.user("alice")
    alice = await accounts.login("alice")
    r = await admin.patch(f"{USERS}/{uid}", json={"password": "brand-new-pass"})
    assert r.status_code == 200
    assert await _sessions(conn, uid) == 0
    assert (await alice.get("/api/auth/me")).status_code == 401
    await alice.aclose()
    row = await _user(conn, uid)
    assert passwords.verify_password(row.password_hash, "brand-new-pass")
    assert not passwords.verify_password(row.password_hash, PASSWORD)
    [note] = await _notes(conn, uid)
    assert note.kind == "system"
    assert "brand-new-pass" not in str(note.summary)


async def test_system_notifications_follow_the_users_preference(admin, accounts, conn, rows):
    uid = await accounts.user("alice")
    await rows.insert(
        t.user_preferences,
        user_id=uid,
        value={"notifications": {"reports": True, "tasks": True, "system": False}},
    )
    await admin.patch(f"{USERS}/{uid}", json={"password": "brand-new-pass"})
    await admin.patch(f"{USERS}/{uid}", json={"disabled": True})
    assert await _notes(conn, uid) == []


async def test_change_domain_is_409(admin, accounts, rows):
    uid = await accounts.user("alice")
    await rows.domain("re-marketing")
    r = await admin.patch(f"{USERS}/{uid}", json={"domain_id": "re-marketing"})
    assert r.status_code == 409
    assert r.json()["error"] == "domain_change_unsupported"


async def test_patch_validation_and_unknown_ids(admin, accounts):
    uid = await accounts.user("alice")
    r = await admin.patch(f"{USERS}/{uid}", json={"password": ""})
    assert (r.status_code, r.json()["error"]) == (400, "invalid_request")
    r = await admin.patch(f"{USERS}/{uid}", json={"role": "admin"})
    assert (r.status_code, r.json()["error"]) == (400, "invalid_request")
    r = await admin.patch(f"{USERS}/{uuid.uuid4()}", json={"disabled": True})
    assert (r.status_code, r.json()["error"]) == (404, "not_found")
    r = await admin.patch(f"{USERS}/not-a-uuid", json={"disabled": True})
    assert r.status_code == 404


async def test_admins_are_not_managed_here(admin, conn):
    admin_id = (await conn.execute(select(t.users.c.id).where(t.users.c.role == "admin"))).scalar()
    r = await admin.patch(f"{USERS}/{admin_id}", json={"disabled": True})
    assert r.status_code == 404


async def test_users_cannot_use_admin_user_routes(accounts):
    uid = await accounts.user("alice")
    async with await accounts.login("alice") as c:
        assert (await c.get(USERS)).status_code == 403
        assert (await c.post(USERS, json={})).status_code == 403
        assert (await c.patch(f"{USERS}/{uid}", json={"disabled": True})).status_code == 403


# --- display name vs password (a browser can autofill one into the other) -----------------------


async def test_display_name_is_stored_as_given_and_the_password_never_leaks(admin, conn, rows):
    await rows.domain("fabrikam")
    body = {
        "username": "test-user",
        "password": "Test123456!",
        "domain_id": "fabrikam",
        "display_name": "Test User",
    }
    r = await admin.post(USERS, json=body)
    assert r.status_code == 202
    assert r.json()["user"]["display_name"] == "Test User"  # USER-1
    assert "Test123456!" not in r.text  # USER-2: not in the response
    row = (await conn.execute(select(t.users).where(t.users.c.username == "test-user"))).one()
    assert row.display_name == "Test User"
    assert passwords.verify_password(row.password_hash, "Test123456!")
    assert "Test123456!" not in row.password_hash  # hashed, never stored plain
    others = {k: v for k, v in row._mapping.items() if k != "password_hash"}
    assert "Test123456!" not in str(others)  # in no other column
    listed = (await admin.get(USERS)).text
    assert "Test123456!" not in listed


async def test_a_display_name_equal_to_the_password_is_refused(admin, conn, rows):
    await rows.domain("fabrikam")
    body = {
        "username": "sang2",
        "password": "123456",
        "domain_id": "fabrikam",
        "display_name": "123456",
    }
    r = await admin.post(USERS, json=body)
    assert (r.status_code, r.json()["error"]) == (400, "invalid_request")
    assert "123456" not in r.text
    assert (
        await conn.scalar(
            select(func.count()).select_from(t.users).where(t.users.c.username == "sang2")
        )
        == 0
    )


async def test_an_empty_display_name_is_allowed(admin, rows):  # USER-3: unchanged rule
    await rows.domain("fabrikam")
    body = {"username": "nodisplay", "password": "pw-123456", "domain_id": "fabrikam"}
    r = await admin.post(USERS, json=body)
    assert (r.status_code, r.json()["user"]["display_name"]) == (202, "")


async def test_reset_password_keeps_the_display_name(admin, accounts, conn):  # USER-4
    uid = await accounts.user("alice", display_name="Alice")
    r = await admin.patch(f"{USERS}/{uid}", json={"password": "brand-new-pass"})
    assert r.status_code == 200 and "brand-new-pass" not in r.text
    assert r.json()["display_name"] == "Alice"
    assert (await _user(conn, uid)).display_name == "Alice"
