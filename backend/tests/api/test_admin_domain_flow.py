"""The Admin > Miền dữ liệu flow end to end, through the same routes the page calls: a domain made
entirely in the UI becomes available only once its declared credentials are filled, and a user
created on it is provisioned with the lead plus its starters (doc 12 "Domains")."""

from __future__ import annotations

from pathlib import Path

from cryptography.fernet import Fernet
from sqlalchemy import select

from backend.catalog import seeds
from backend.db import tables as t
from backend.tests.api.test_builder_api import REPO, FakeExecd, FakeSupervisor

URL = "/api/admin/domains"


def _app(make_app, conn, tmp_path):
    import asyncio
    from contextlib import asynccontextmanager

    from backend.harness.runtime import Harness

    app = make_app(
        FOLDERS_DIR=str(tmp_path / "folders"),
        DOMAINS_DIR=str(tmp_path / "no-domain-files"),
        PLATFORM_DIR=str(REPO / "platform"),
        CREDENTIAL_ENCRYPTION_KEY=Fernet.generate_key().decode(),
    )
    lock = asyncio.Lock()

    @asynccontextmanager
    async def provider():
        async with lock, conn.begin_nested():
            yield conn

    h = Harness(app.state.settings, db=provider, execd=FakeExecd(), model=None)
    h.supervisor = FakeSupervisor()
    h.woken = []
    h.wake = h.woken.append
    app.state.harness = h
    return app


async def _domain(c, domain_id="demo-domain-audit"):
    rows = (await c.get(URL)).json()
    return next(d for d in rows if d["id"] == domain_id)


async def test_a_domain_made_in_the_ui_provisions_its_team(make_app, conn, tmp_path, accounts):
    app = _app(make_app, conn, tmp_path)
    from backend.tests.api.conftest import Accounts

    accounts = Accounts(app, conn, accounts.rows)
    await accounts.admin()
    await seeds.upsert_catalogs(conn, app.state.settings, available=[])
    async with await accounts.login("admin") as c:
        # 1. metadata only: nothing declared yet, so nothing is missing (DOMAIN-2, DOMAIN-7)
        r = await c.post(URL, json={"id": "demo-domain-audit", "name": "Demo Domain Audit"})
        assert (r.status_code, r.json()["status"]) == (201, "available")
        assert (await c.post(URL, json={"id": "demo-domain-audit", "name": "x"})).status_code == 409
        assert (await c.post(URL, json={"id": "Bad Id", "name": "x"})).json()[
            "error"
        ] == "invalid_domain_id"
        # 2. a credential set with no values makes it unavailable, with the reason (DOMAIN-5)
        r = await c.post(
            f"{URL}/demo-domain-audit/credential-sets",
            json={"name": "warehouse", "description": "Kho", "keys": ["WAREHOUSE_DSN"]},
        )
        assert (r.json()["status"], r.json()["status_reason"]) == (
            "unavailable",
            "credentials/warehouse: missing key WAREHOUSE_DSN",
        )
        r = await c.put(
            f"{URL}/demo-domain-audit/credential-sets/warehouse/values",
            json={"values": {"WAREHOUSE_DSN": "postgresql://placeholder"}},
        )
        assert r.json()["status"] == "available"
        listed = await _domain(c)
        assert listed["credential_sets"][0]["keys"] == [{"key": "WAREHOUSE_DSN", "filled": True}]
        assert "placeholder" not in str(listed)  # values are write-only
        # 3. starters: unknown presets/sets are refused; a valid one is added (DOMAIN-3, DOMAIN-4)
        bad = await c.post(
            f"{URL}/demo-domain-audit/starters",
            json={"slug": "data", "display_name": "Data", "presets": ["nope"]},
        )
        assert (bad.status_code, bad.json()["error"]) == (400, "unknown_preset")
        bad = await c.post(
            f"{URL}/demo-domain-audit/starters",
            json={"slug": "data", "display_name": "Data", "credentials": ["missing"]},
        )
        assert (bad.status_code, bad.json()["error"]) == (400, "unknown_credential_set")
        for slug, creds in (("data", ["warehouse"]), ("report", [])):
            r = await c.post(
                f"{URL}/demo-domain-audit/starters",
                json={
                    "slug": slug,
                    "display_name": slug.title(),
                    "credentials": creds,
                    "prompt": f"Bạn là {slug}.",
                },
            )
            assert r.status_code == 201, r.text
        r = await c.patch(
            f"{URL}/demo-domain-audit/starters/report",
            json={"slug": "report", "display_name": "Báo cáo", "prompt": "Viết báo cáo."},
        )
        assert r.json()["status"] == "available"
        # 4. the lead prompt (stored as the domain's `lead` starter row)
        r = await c.put(f"{URL}/demo-domain-audit/lead", json={"prompt": "Điều phối nhóm Demo."})
        assert r.json()["status"] == "available"
        starters = {s["slug"]: s for s in (await _domain(c))["starters"]}
        assert set(starters) == {"lead", "data", "report"} and starters["lead"]["is_lead"]
        # 5. a user on the new domain gets the lead + both starters (DOMAIN-9)
        r = await c.post(
            "/api/admin/users",
            json={
                "username": "audituser",
                "password": "pw-123456",
                "domain_id": "demo-domain-audit",
            },
        )
        assert r.status_code == 202, r.text
    await app.state.harness.jobs.run_pending()
    user = (await conn.execute(select(t.users).where(t.users.c.username == "audituser"))).one()
    assert user.status == "active", user.status_detail
    slugs = (
        (
            await conn.execute(
                select(t.agents.c.slug)
                .where(t.agents.c.user_id == user.id)
                .order_by(t.agents.c.slug)
            )
        )
        .scalars()
        .all()
    )
    assert slugs == ["data", "lead", "report"]
    folders = Path(app.state.settings.FOLDERS_DIR) / str(user.id)
    assert (folders / "lead" / "prompts" / "system.md").read_text() == "Điều phối nhóm Demo."
    assert (folders / "data" / ".env.d" / "warehouse.env").is_file()  # decrypted into its folder
    assert not (folders / "report" / ".env.d" / "warehouse.env").exists()


async def test_only_admins_reach_the_domain_routes(make_app, conn, tmp_path, accounts):
    app = _app(make_app, conn, tmp_path)
    from backend.tests.api.conftest import Accounts

    accounts = Accounts(app, conn, accounts.rows)
    await accounts.user("alice")
    async with await accounts.login("alice") as c:  # DOMAIN-6
        for method, path in ((c.get, URL), (c.post, URL)):
            assert (await method(path)).status_code == 403
