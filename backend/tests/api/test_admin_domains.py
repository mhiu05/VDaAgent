"""Admin-managed domains (doc 12 "Domains"): the minimum integration this feature needs to keep
working — an admin creates a domain and a starter, `load_domain` reads them back from Postgres,
and nobody else can use the routes."""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.domains.loader import load_domain

REPO = Path(__file__).resolve().parents[3]
URL = "/api/admin/domains"


@pytest.fixture
def app(make_app):
    return make_app(PLATFORM_DIR=str(REPO / "platform"))


async def test_admin_created_domain_and_starter_load_from_postgres(app, accounts, conn):
    await accounts.admin()
    async with await accounts.login("admin") as c:
        r = await c.post(URL, json={"id": "contoso-sales", "name": "Contoso Sales"})
        assert r.status_code == 201, r.text
        r = await c.post(
            f"{URL}/contoso-sales/starters",
            json={"slug": "insight", "display_name": "Insight", "prompt": "Bạn là Insight.\n"},
        )
        assert r.status_code == 201, r.text
    domain = await load_domain(conn, "contoso-sales")
    assert domain.name == "Contoso Sales"
    assert [(s.slug, s.display_name, s.prompt) for s in domain.starters] == [
        ("insight", "Insight", "Bạn là Insight.\n")
    ]


async def test_non_admins_cannot_manage_domains(app, accounts):
    await accounts.user("alice")
    async with await accounts.login("alice") as c:
        assert (await c.get(URL)).status_code == 403
        r = await c.post(URL, json={"id": "contoso-sales", "name": "Contoso Sales"})
        assert r.status_code == 403
