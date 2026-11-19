"""Telegram webhook (merged from Agent-A-ThanhTung): the secret check and account status.

A linked chat is another way into a user's agents, so it obeys the same rule as the web: only
an `active` account reaches them, and disabling a user unlinks the chat.
"""

from __future__ import annotations

import contextlib
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select

from backend.db import tables as t
from backend.tests.api.test_threads_api import FakeHarness, setup_team

SECRET = "test-webhook-secret"
CHAT = 424242


class TelegramHarness(FakeHarness):
    def __init__(self, settings, conn):
        super().__init__(settings)
        self._conn = conn

    @contextlib.asynccontextmanager
    async def db(self):
        async with self._conn.begin_nested():
            yield self._conn


class StubClient:
    def __init__(self):
        self.sent = []

    async def send_message(self, chat_id, text, **kwargs):
        self.sent.append((chat_id, text))


@pytest.fixture
def app(make_app, tmp_path, conn):
    app = make_app(
        FOLDERS_DIR=str(tmp_path / "folders"),
        ATTACHMENTS_DIR=str(tmp_path / "attachments"),
        TELEGRAM_WEBHOOK_SECRET=SECRET,
    )
    app.state.harness = TelegramHarness(app.state.settings, conn)
    app.state.telegram_client = StubClient()
    app.state.telegram_bridge = None
    return app


def _update(text):
    return {"update_id": 1, "message": {"chat": {"id": CHAT}, "text": text}}


async def _post(client, body, secret=SECRET):
    headers = {} if secret is None else {"X-Telegram-Bot-Api-Secret-Token": secret}
    return await client.post("/telegram/webhook", json=body, headers=headers)


async def _messages_in(conn, thread_id):
    return await conn.scalar(
        select(func.count()).select_from(t.messages).where(t.messages.c.thread_id == thread_id)
    )


async def test_wrong_or_missing_secret_is_refused(client):
    assert (await _post(client, _update("hi"), secret="nope")).status_code == 403
    assert (await _post(client, _update("hi"), secret=None)).status_code == 403
    assert (await _post(client, _update("hi"), secret=SECRET[:-1])).status_code == 403


async def test_an_active_linked_user_reaches_the_lead(app, client, accounts, rows, conn):
    user, _agents, threads = await setup_team(accounts, rows, conn)
    await rows.insert(t.telegram_links, user_id=user, chat_id=CHAT)
    r = await _post(client, _update("Xin chào từ Telegram"))
    assert r.status_code == 200 and r.json() == {"ok": True}
    msg = (
        await conn.execute(select(t.messages).where(t.messages.c.thread_id == threads["lead"]))
    ).one()
    assert (msg.sender_type, msg.sender_id, msg.content["text"]) == (
        "user",
        user,
        "Xin chào từ Telegram",
    )
    # standard post_message(): the lead gets a delivery, classified by jev like web chat
    assert app.state.harness.jev.scheduled


@pytest.mark.parametrize("status", ["disabled", "provisioning", "failed"])
async def test_a_non_active_linked_user_is_denied(app, client, accounts, rows, conn, status):
    user, _agents, threads = await setup_team(accounts, rows, conn)
    await rows.insert(t.telegram_links, user_id=user, chat_id=CHAT)
    await accounts.set_status(user, status)
    r = await _post(client, _update("vẫn gửi được không?"))
    assert r.status_code == 200
    assert await _messages_in(conn, threads["lead"]) == 0
    assert not app.state.harness.jev.scheduled
    [(chat, text)] = app.state.telegram_client.sent
    assert chat == CHAT and "không hoạt động" in text


async def test_disabling_a_user_unlinks_telegram(accounts, rows, conn):
    from backend import accounts as account_ops

    user, _agents, _threads = await setup_team(accounts, rows, conn)
    await rows.insert(t.telegram_links, user_id=user, chat_id=CHAT)
    await rows.insert(
        t.telegram_link_codes,
        code="abc",
        user_id=user,
        expires_at=datetime.now(UTC) + timedelta(minutes=5),
    )
    await account_ops.set_disabled(conn, await account_ops.get_user(conn, user), True)
    links = await conn.scalar(select(func.count()).select_from(t.telegram_links))
    codes = await conn.scalar(select(func.count()).select_from(t.telegram_link_codes))
    assert (links, codes) == (0, 0)


async def test_a_link_code_cannot_link_a_disabled_user(app, client, accounts, rows, conn):
    user, _agents, _threads = await setup_team(accounts, rows, conn)
    await rows.insert(
        t.telegram_link_codes,
        code="code1",
        user_id=user,
        expires_at=datetime.now(UTC) + timedelta(minutes=5),
    )
    await accounts.set_status(user, "disabled")
    assert (await _post(client, _update("/start code1"))).status_code == 200
    assert await conn.scalar(select(func.count()).select_from(t.telegram_links)) == 0
