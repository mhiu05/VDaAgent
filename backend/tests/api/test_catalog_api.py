"""`/api/catalog/*` (doc 15 "Catalogs", doc 05)."""

from __future__ import annotations

import io
import tarfile
from pathlib import Path

import httpx
import pytest

from backend.catalog import preview as preview_mod
from backend.catalog import seeds
from backend.db import tables as t

REPO = Path(__file__).resolve().parents[3]
SHA = "dbd4588f9e1033efb41dad4bef2f7947c8993d44"
SKILL_MD = b"---\nname: xlsx\ndescription: d\n---\nHi"


@pytest.fixture
def app(make_app, tmp_path):
    domains = tmp_path / "domains"
    cred = domains / "fabrikam" / "credentials"
    cred.mkdir(parents=True)
    (cred / "warehouse.env.example").write_text(
        "# description: Kho dữ liệu bất động sản\nWAREHOUSE_DSN=\nWAREHOUSE_SNAPSHOT_ID=\n"
    )
    (cred / "web-search.env.example").write_text("TAVILY_API_KEY=\n")
    return make_app(
        DOMAINS_DIR=str(domains),
        PLATFORM_DIR=str(REPO / "platform"),
        CACHE_DIR=str(tmp_path / "cache"),
    )


@pytest.fixture
async def catalog(conn, app):
    await conn.execute(t.domains.insert().values(id="other", name="Other", status="available"))
    await conn.execute(t.domains.insert().values(id="fabrikam", name="V", status="available"))
    await seeds.upsert_catalogs(conn, app.state.settings, available=[])
    await conn.execute(
        t.skill_catalog.insert().values(
            id="vh-dict",
            name="vh-dict",
            title_vi="Từ điển kho",
            description_vi="Bảng và cột",
            tags=["Kho"],
            install_cmd=[
                "python",
                "-m",
                "contoso.skills",
                "install",
                "o/r",
                "d",
                "--ref",
                "a" * 40,
            ],
            domain_id="fabrikam",
        )
    )
    await conn.execute(
        t.skill_catalog.insert().values(
            id="other-x",
            name="other-x",
            title_vi="X",
            description_vi="X",
            tags=[],
            install_cmd=[
                "python",
                "-m",
                "contoso.skills",
                "install",
                "o/r",
                "x",
                "--ref",
                "a" * 40,
            ],
            domain_id="other",
        )
    )
    seeds.STATUS.marketplace = True


async def test_skills_are_global_plus_own_domain(accounts, catalog):
    await accounts.user("alice", domain="fabrikam")
    async with await accounts.login("alice") as c:
        r = await c.get("/api/catalog/skills")
        ids = {s["id"] for s in r.json()}
        assert ids == {"xlsx", "docx", "pdf", "pptx", "vh-dict"}
        assert set(r.json()[0]) == {"id", "name", "title_vi", "description_vi", "tags"}
        assert {
            s["id"] for s in (await c.get("/api/catalog/skills", params={"q": "excel"})).json()
        } == {"xlsx"}
        assert {
            s["id"] for s in (await c.get("/api/catalog/skills", params={"tag": "Kho"})).json()
        } == {"vh-dict"}


async def test_presets(accounts, catalog):
    await accounts.user("alice", domain="fabrikam")
    async with await accounts.login("alice") as c:
        body = (await c.get("/api/catalog/presets")).json()
    data = next(p for p in body if p["id"] == "data")
    assert data["title_vi"] == "Phân tích dữ liệu" and data["packages"][0].startswith("pandas")


async def test_credential_sets_of_my_domain(accounts, catalog):
    await accounts.user("alice", domain="fabrikam")
    async with await accounts.login("alice") as c:
        body = (await c.get("/api/catalog/credential-sets")).json()
    assert body == [
        {
            "set": "warehouse",
            "description": "Kho dữ liệu bất động sản",
            "keys": ["WAREHOUSE_DSN", "WAREHOUSE_SNAPSHOT_ID"],
        },
        {"set": "web-search", "description": "", "keys": ["TAVILY_API_KEY"]},
    ]


async def test_starters_of_my_domain(accounts, catalog, app):
    starter = Path(app.state.settings.DOMAINS_DIR) / "fabrikam" / "starters" / "data"
    starter.mkdir(parents=True)
    (starter / "agent.yaml").write_text(
        'display_name: Data\navatar: {emoji: "D", color: "#2563EB"}\ndescription: Số liệu\n'
        "presets: [data]\ncredentials: [warehouse]\n"
    )
    (starter / "prompt.md").write_text("Bạn là Data.")
    await accounts.user("alice", domain="fabrikam")
    async with await accounts.login("alice") as c:
        body = (await c.get("/api/catalog/starters")).json()
    assert body == [
        {
            "slug": "data",
            "display_name": "Data",
            "avatar": {"emoji": "D", "color": "#2563EB"},
            "description": "Số liệu",
            "presets": ["data"],
            "credentials": ["warehouse"],
        }
    ]


async def test_marketplace_disabled(accounts, catalog):
    await accounts.user("alice", domain="fabrikam")
    seeds.STATUS.marketplace = False
    try:
        async with await accounts.login("alice") as c:
            r = await c.get("/api/catalog/skills")
        assert (r.status_code, r.json()["error"]) == (503, "marketplace_disabled")
    finally:
        seeds.STATUS.marketplace = True


def tarball(members: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name, data in members.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


async def test_preview_lists_files_and_reads_skill_md(accounts, catalog, monkeypatch, tmp_path):
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(
            200,
            content=tarball(
                {
                    f"skills-{SHA}/skills/xlsx/SKILL.md": SKILL_MD,
                    f"skills-{SHA}/skills/xlsx/scripts/recalc.py": b"print(1)",
                    f"skills-{SHA}/skills/docx/SKILL.md": b"other",
                }
            ),
        )

    monkeypatch.setattr(preview_mod, "TRANSPORT", httpx.MockTransport(handler))
    await accounts.user("alice", domain="fabrikam")
    async with await accounts.login("alice") as c:
        r = await c.get("/api/catalog/skills/xlsx/preview")
        assert r.status_code == 200, r.text
        assert r.json() == {
            "skill_md": "---\nname: xlsx\ndescription: d\n---\nHi",
            "files": ["SKILL.md", "scripts/recalc.py"],
            "has_code": True,
        }
        again = await c.get("/api/catalog/skills/xlsx/preview")
        assert again.json() == r.json()
        assert (await c.get("/api/catalog/skills/other-x/preview")).status_code == 404
    assert seen == [f"https://codeload.github.com/anthropics/skills/tar.gz/{SHA}"]  # cached
