"""Row factories for the schema tests. Each inserts the minimum valid row and returns its id."""

from __future__ import annotations

import hashlib
import itertools
import uuid
from datetime import UTC, datetime, timedelta

import pytest

from backend.db import tables as t

TRACE = "0" * 32
SHA = "a" * 64


class Rows:
    def __init__(self, conn):
        self.conn = conn
        self._n = itertools.count(1)

    async def insert(self, table, **values):
        pk = list(table.primary_key.columns)
        stmt = table.insert().values(**values).returning(*pk)
        row = (await self.conn.execute(stmt)).one()
        return row[0] if len(pk) == 1 else tuple(row)

    async def domain(self, id: str = "fabrikam", **kw):
        name = kw.pop("name", id)
        status = kw.pop("status", "available")
        return await self.insert(t.domains, id=id, name=name, status=status, **kw)

    async def user(self, **kw):
        n = next(self._n)
        role = kw.pop("role", "user")
        if role == "user" and "domain_id" not in kw:
            kw["domain_id"] = await self.domain(f"d{n}")
        values = {
            "username": f"user{n}",
            "password_hash": "$argon2id$x",
            "role": role,
            "status": "active",
        }
        return await self.insert(t.users, **(values | kw))

    async def agent(self, user_id, **kw):
        n = next(self._n)
        values = {
            "user_id": user_id,
            "slug": f"agent-{n}",
            "display_name": f"Agent {n}",
            "avatar": {"emoji": "📊", "color": "#16A34A"},
            "origin": "custom",
            "state": "active",
            "status": "idle",
            "baseline_commit": "deadbeef",
        }
        return await self.insert(t.agents, **(values | kw))

    async def thread(self, user_id, **kw):
        values = {"user_id": user_id, "kind": "group", "name": "Nhóm"}
        return await self.insert(t.threads, **(values | kw))

    async def message(self, thread_id, **kw):
        values = {"thread_id": thread_id, "sender_type": "system", "content": {"text": "hi"}}
        return await self.insert(t.messages, **(values | kw))

    async def event(self, agent_id, seq, **kw):
        values = {
            "agent_id": agent_id,
            "seq": seq,
            "epoch": 0,
            "kind": "input",
            "payload": {"text": "x", "items": []},
            "trace_id": TRACE,
            "activation_kind": "message",
        }
        return await self.insert(t.events, **(values | kw))

    async def task(self, user_id, **kw):
        values = {"user_id": user_id, "description": "job", "status": "queued"}
        return await self.insert(t.global_tasks, **(values | kw))

    async def report(self, user_id, agent_id, **kw):
        n = next(self._n)
        values = {
            "user_id": user_id,
            "code": f"R{n:03d}",
            "title": "Báo cáo",
            "type": "sales-summary",
            "agent_id": agent_id,
        }
        return await self.insert(t.reports, **(values | kw))

    async def version(self, report_id, sequence=1, **kw):
        values = {
            "report_id": report_id,
            "sequence": sequence,
            "schema": {"schemaVersion": 1},
            "source": {"id": "wh", "label": "Kho", "dataThrough": None, "completeness": "full"},
            "policy_version": "p1",
            "content_revision": "c1",
            "trace_id": TRACE,
        }
        return await self.insert(t.report_versions, **(values | kw))

    async def session(self, user_id, token: bytes = b"t"):
        return await self.insert(
            t.auth_sessions,
            token_hash=hashlib.sha256(token).digest(),
            user_id=user_id,
            expires_at=datetime.now(UTC) + timedelta(days=7),
        )

    @staticmethod
    def uuid():
        return uuid.uuid4()


@pytest.fixture
def rows(conn):
    return Rows(conn)
