"""`/api/agents*` read/patch/delete and the folder viewer routes (doc 15, doc 04)."""

from __future__ import annotations

import io
import os
import shutil
import subprocess
import zipfile
from pathlib import Path

import pytest
from sqlalchemy import select

from backend.db import tables as t

REPO = Path(__file__).resolve().parents[3]


@pytest.fixture
def folders_dir(tmp_path):
    d = tmp_path / "folders"
    d.mkdir()
    return d


@pytest.fixture
def app(make_app, folders_dir, tmp_path):
    return make_app(
        FOLDERS_DIR=str(folders_dir),
        DOMAINS_DIR=str(tmp_path / "domains"),
        PLATFORM_DIR=str(REPO / "platform"),
    )


async def make_agent(accounts, rows, folders_dir, user_id, slug="data", **kw):
    agent_id = await rows.agent(user_id, slug=slug, **kw)
    folder = folders_dir / str(user_id) / slug
    shutil.copytree(REPO / "platform" / "agent-skeleton", folder)
    (folder / "prompts" / "system.md").write_text("role\n")
    for args in (
        ["init", "-q", "-b", "main"],
        ["add", "-A"],
        [
            "-c",
            "user.name=contoso-harness",
            "-c",
            "user.email=h@contoso.local",
            "commit",
            "-qm",
            f"create {slug}",
        ],
    ):
        subprocess.run(["git", *args], cwd=folder, check=True, capture_output=True)
    return agent_id, folder


async def test_list_get_patch(accounts, rows, folders_dir):
    alice = await accounts.user("alice")
    a1, _ = await make_agent(accounts, rows, folders_dir, alice, "data", display_name="Data")
    await make_agent(accounts, rows, folders_dir, alice, "old", state="deleted")
    async with await accounts.login("alice") as c:
        r = await c.get("/api/agents")
        assert r.status_code == 200
        body = r.json()
        assert [a["slug"] for a in body] == ["data"]
        assert set(body[0]) == {
            "id",
            "slug",
            "display_name",
            "avatar",
            "description",
            "origin",
            "is_lead",
            "status",
            "status_detail",
            "created_at",
        }
        r = await c.patch(
            f"/api/agents/{a1}",
            json={"display_name": "Dữ liệu", "avatar": {"emoji": "🧮", "color": "#000"}},
        )
        assert r.status_code == 200 and r.json()["display_name"] == "Dữ liệu"
        assert (await c.get(f"/api/agents/{a1}")).json()["avatar"]["emoji"] == "🧮"
        assert (await c.patch(f"/api/agents/{a1}", json={"slug": "x"})).status_code == 400


async def test_another_users_agent_is_404(accounts, rows, folders_dir):
    alice = await accounts.user("alice")
    await accounts.user("bob")
    a1, _ = await make_agent(accounts, rows, folders_dir, alice)
    async with await accounts.login("bob") as c:
        assert (await c.get(f"/api/agents/{a1}")).status_code == 404
        assert (await c.get(f"/api/agents/{a1}/tree")).status_code == 404
        assert (await c.delete(f"/api/agents/{a1}")).status_code == 404


async def test_delete(accounts, rows, folders_dir, conn):
    alice = await accounts.user("alice")
    lead, _ = await make_agent(
        accounts, rows, folders_dir, alice, "lead", is_lead=True, origin="lead"
    )
    a1, _ = await make_agent(accounts, rows, folders_dir, alice, "data")
    async with await accounts.login("alice") as c:
        assert (await c.delete(f"/api/agents/{lead}")).status_code == 409
        r = await c.delete(f"/api/agents/{a1}")
        assert r.status_code == 204
        assert (await c.get(f"/api/agents/{a1}")).status_code == 404
    state = await conn.scalar(select(t.agents.c.state).where(t.agents.c.id == a1))
    assert state == "deleted"


async def test_viewer_routes_for_the_owner(accounts, rows, folders_dir):
    alice = await accounts.user("alice")
    a1, folder = await make_agent(accounts, rows, folders_dir, alice)
    (folder / "files" / "c.png").write_bytes(b"\x89PNG\r\n\x1a\nxx")
    async with await accounts.login("alice") as c:
        tree = (await c.get(f"/api/agents/{a1}/tree", params={"path": "prompts"})).json()
        assert {e["name"] for e in tree} == {"system.md", "context.md"}
        r = await c.get(f"/api/agents/{a1}/file", params={"path": "prompts/system.md"})
        assert r.status_code == 200 and r.text == "role\n"
        assert r.headers["content-type"] == "text/plain; charset=utf-8"
        r = await c.get(f"/api/agents/{a1}/file", params={"path": "files/c.png"})
        assert r.headers["content-type"] == "image/png"
        r = await c.get(f"/api/agents/{a1}/file", params={"path": "../x"})
        assert r.status_code == 400 and r.json()["error"] == "invalid_path"
        r = await c.get(f"/api/agents/{a1}/archive")
        assert r.headers["content-type"] == "application/zip"
        assert "attachment" in r.headers["content-disposition"]
        assert "prompts/system.md" in zipfile.ZipFile(io.BytesIO(r.content)).namelist()
        log = (await c.get(f"/api/agents/{a1}/log", params={"path": "prompts/system.md"})).json()
        assert log[0]["message"] == "create data"
        diff = await c.get(f"/api/agents/{a1}/diff", params={"commit": log[0]["commit"]})
        assert diff.status_code == 200 and "+role" in diff.text
        assert (await c.get(f"/api/agents/{a1}/diff")).status_code == 400


async def test_admin_can_view_any_folder_but_not_change_agents(accounts, rows, folders_dir):
    alice = await accounts.user("alice")
    await accounts.admin()
    a1, folder = await make_agent(accounts, rows, folders_dir, alice)
    os.makedirs(folder / ".env.d")
    (folder / "secret.env").write_text("K=v\n")
    async with await accounts.login("admin") as c:
        assert (await c.get(f"/api/agents/{a1}/tree")).status_code == 200
        assert (
            await c.get(f"/api/agents/{a1}/file", params={"path": "prompts/system.md"})
        ).status_code == 200
        assert (await c.get("/api/agents")).status_code == 403
        assert (await c.delete(f"/api/agents/{a1}")).status_code == 403
