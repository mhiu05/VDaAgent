"""Fixtures for runtime tests: a harness on the rolled-back test connection, FakeModel and a
scripted execd, plus a small team (lead + data) with epochs, direct threads and folders."""

from __future__ import annotations

import asyncio
import textwrap
from collections.abc import Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import select

from backend.db import tables as t
from backend.execd_client import ExecResult
from backend.harness.fake_model import FakeModelTransport, load_scenario
from backend.harness.model import ModelClient
from backend.harness.runtime import Harness
from backend.settings import Settings
from backend.tests.db.conftest import rows  # noqa: F401

REPO = Path(__file__).resolve().parents[3]


def exec_result(stdout: str = "", stderr: str = "", **kw: Any) -> ExecResult:
    values = {
        "exit_code": 0,
        "stdout": stdout,
        "stderr": stderr,
        "duration_ms": 100,
        "timed_out": False,
        "truncated": False,
        "head": "abc",
        "changed": [],
        "snapshot_error": None,
    }
    values.update(kw)
    return ExecResult(**values)


class ScriptedExecd:
    """Runs `handler(call, harness)` for each exec; records every call."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.handler: Callable[[dict, Any], Any] | None = None
        self.harness: Any = None

    async def exec(self, **call: Any) -> ExecResult:
        self.calls.append(call)
        if self.handler is None:
            return exec_result("ok\n")
        out = self.handler(call, self.harness)
        if asyncio.iscoroutine(out):
            out = await out
        return out


@pytest.fixture
def db(conn):
    """The harness's transaction provider: savepoints on the test connection, one at a time."""
    lock = asyncio.Lock()

    @asynccontextmanager
    async def provider():
        async with lock, conn.begin_nested():
            yield conn

    return provider


@pytest.fixture
def settings(platform_env, tmp_path) -> Settings:
    return Settings(
        FOLDERS_DIR=str(tmp_path / "folders"),
        PLATFORM_DIR=str(REPO / "platform"),
        DOMAINS_DIR=str(tmp_path / "domains"),
        MODEL_BACKEND="fake",
        AGENT_MODEL="openai/gpt-4o-mini",
        COMPACTION_MODEL="openai/gpt-4o-mini",
    )


@pytest.fixture
def make_harness(db, settings, tmp_path):
    made: list[Harness] = []

    def _make(scenario: str = "agents: {}\n", **overrides) -> Harness:
        path = tmp_path / f"scenario-{len(made)}.yaml"
        path.write_text(textwrap.dedent(scenario))
        transport = FakeModelTransport(load_scenario(path))
        model = ModelClient(
            base_url="http://fake/api/v1",
            api_key="",
            app_url="http://x",
            timeout_s=5,
            transport=transport,
        )
        execd = ScriptedExecd()
        for k, v in overrides.items():
            setattr(settings, k, v)
        h = Harness(settings, db=db, execd=execd, model=model)
        execd.harness = h
        h.fake = transport  # type: ignore[attr-defined]
        made.append(h)
        return h

    return _make


@dataclass
class Team:
    user: Any
    lead: Any
    data: Any
    threads: dict[str, Any]


@pytest.fixture
async def team(conn, rows, settings):  # noqa: F811
    domain = await rows.domain("fabrikam")
    user = await rows.user(username="alice", domain_id=domain)
    agents = {}
    threads = {}
    for slug, name, is_lead in (("lead", "Điều phối", True), ("data", "Data", False)):
        agent_id = await rows.agent(
            user,
            slug=slug,
            display_name=name,
            is_lead=is_lead,
            origin="lead" if is_lead else "starter",
        )
        await rows.insert(
            t.agent_epochs,
            agent_id=agent_id,
            epoch=0,
            start_seq=0,
            system_prompt=f"SYSTEM {slug}",
            reason="initial",
        )
        thread = await rows.thread(user, kind="direct", member_key=slug, name=None)
        await rows.insert(t.thread_members, thread_id=thread, member_type="user", member_id=user)
        await rows.insert(
            t.thread_members, thread_id=thread, member_type="agent", member_id=agent_id
        )
        (Path(settings.FOLDERS_DIR) / str(user) / slug).mkdir(parents=True)
        agents[slug] = (await conn.execute(select(t.agents).where(t.agents.c.id == agent_id))).one()
        threads[slug] = thread
    return Team(user=user, lead=agents["lead"], data=agents["data"], threads=threads)


async def user_message(
    rows,  # noqa: F811
    team,
    slug: str,
    text: str,
    *,
    route="notification",
    status="pending",
) -> tuple[int, int]:
    """A message from the user in `slug`'s direct thread and its pending delivery."""
    msg = await rows.insert(
        t.messages,
        thread_id=team.threads[slug],
        sender_type="user",
        sender_id=team.user,
        content={"text": text},
    )
    agent = team.lead if slug == "lead" else team.data
    delivery = await rows.insert(
        t.deliveries, agent_id=agent.id, message_id=msg, route=route, status=status
    )
    return msg, delivery


async def events_of(conn, agent_id) -> list[Any]:
    return (
        await conn.execute(
            select(t.events).where(t.events.c.agent_id == agent_id).order_by(t.events.c.seq)
        )
    ).all()
