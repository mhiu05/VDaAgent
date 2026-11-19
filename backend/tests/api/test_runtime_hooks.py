"""API actions that start or stop runners (doc 12 "User management", doc 04 "Delete")."""

from __future__ import annotations

import asyncio
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]


class FakeSupervisor:
    def __init__(self):
        self.calls = []

    async def stop_user(self, user_id):
        self.calls.append(("stop_user", user_id))

    async def start_user(self, user_id):
        self.calls.append(("start_user", user_id))

    async def stop_agent(self, agent_id):
        self.calls.append(("stop_agent", agent_id))


class FakeHarness:
    def __init__(self):
        self.supervisor = FakeSupervisor()


@pytest.fixture
def app(make_app, tmp_path):
    app = make_app(FOLDERS_DIR=str(tmp_path / "folders"))
    app.state.harness = FakeHarness()
    return app


async def settle():
    for _ in range(5):
        await asyncio.sleep(0)


async def test_disable_and_enable_stop_and_start_runners(app, accounts):
    alice = await accounts.user("alice")
    await accounts.rows.agent(alice, slug="lead", is_lead=True, origin="lead")
    await accounts.admin()
    async with await accounts.login("admin") as c:
        r = await c.patch(f"/api/admin/users/{alice}", json={"disabled": True})
        assert r.status_code == 200
        await settle()
        r = await c.patch(f"/api/admin/users/{alice}", json={"disabled": False})
        assert r.status_code == 200
        await settle()
    assert app.state.harness.supervisor.calls == [("stop_user", alice), ("start_user", alice)]


async def test_deleting_an_agent_stops_its_runner(app, accounts, rows, tmp_path):
    alice = await accounts.user("alice")
    agent = await rows.agent(alice, slug="data")
    folder = tmp_path / "folders" / str(alice) / "data"
    shutil.copytree(REPO / "platform" / "agent-skeleton", folder)
    subprocess.run(["git", "init", "-q"], cwd=folder, check=True)
    async with await accounts.login("alice") as c:
        assert (await c.delete(f"/api/agents/{agent}")).status_code == 204
        await settle()
    assert app.state.harness.supervisor.calls == [("stop_agent", agent)]
