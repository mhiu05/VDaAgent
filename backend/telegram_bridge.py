"""Forwards agent replies to linked Telegram chats (doc 02 bus -> Telegram, see the Telegram
integration plan): one long-lived task per linked user, subscribed to `harness.bus`.
"""

from __future__ import annotations

import asyncio
import contextlib
import html
import logging
import re
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy import select

from backend.db import tables as t
from backend.harness.items import resolve_thread
from backend.telegram_client import TelegramClient, TelegramError

log = logging.getLogger("contoso.telegram")

_CODE_RE = re.compile(r"`([^`\n]+)`")
_BOLD_RE = re.compile(r"\*\*(.+?)\*\*", re.DOTALL)
_HEADER_RE = re.compile(r"^#{1,6}[ \t]+(.*)$", re.MULTILINE)
_LIST_RE = re.compile(r"^(\s*)-[ \t]+", re.MULTILINE)


def _to_telegram_html(text: str) -> str:
    """The agent's Markdown-ish text (`**bold**`, `` `code` ``, `#` headers, `- ` lists) as
    Telegram HTML (`parse_mode=HTML`): bold stays bold, headers and conclusions stand out,
    paragraphs and lists keep their own shape instead of arriving as one flat block.
    """
    out = html.escape(text, quote=False)
    out = _CODE_RE.sub(lambda m: f"<code>{m.group(1)}</code>", out)
    out = _BOLD_RE.sub(lambda m: f"<b>{m.group(1)}</b>", out)
    out = _HEADER_RE.sub(lambda m: f"<b>{m.group(1)}</b>", out)
    out = _LIST_RE.sub(lambda m: f"{m.group(1)}• ", out)
    return out


def _choices_keyboard(message_id: int, choices: list[dict]) -> dict:
    return {
        "inline_keyboard": [
            [{"text": c["label"], "callback_data": f"{message_id}:{c['id']}"}] for c in choices
        ]
    }


def _format_text(view: dict) -> str:
    text = view.get("text") or ""
    refs = view.get("report_refs") or []
    if refs:
        lines = [f"- **{r['title']}** ({r['report_id']}-{r['version_id']})" for r in refs]
        text = (text + "\n\n" if text else "") + "\n".join(lines)
    return _to_telegram_html(text)


class TelegramBridge:
    def __init__(self, harness: Any, client: TelegramClient) -> None:
        self._harness = harness
        self._client = client
        self._tasks: dict[uuid.UUID, asyncio.Task] = {}

    def watch(self, user_id: uuid.UUID, chat_id: int) -> None:
        if user_id in self._tasks:
            return
        self._tasks[user_id] = asyncio.create_task(
            self._run(user_id, chat_id), name=f"telegram-bridge-{user_id}"
        )

    def unwatch(self, user_id: uuid.UUID) -> None:
        task = self._tasks.pop(user_id, None)
        if task is not None:
            task.cancel()

    async def stop(self) -> None:
        tasks = list(self._tasks.values())
        self._tasks.clear()
        for task in tasks:
            task.cancel()
        for task in tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await task

    async def _run(self, user_id: uuid.UUID, chat_id: int) -> None:
        # Only the lead's own `direct` thread with this user (see the Telegram integration
        # plan): the same conversation the web chat shows, not inter-agent task chatter —
        # `send_to_agent` messages publish on the same bus (doc 02) but belong to other
        # threads. Resolved once per watch; a lead reset mid-session needs a re-link.
        thread_id = await self._lead_thread_id(user_id)
        queue = self._harness.bus.subscribe(user_id)
        try:
            while True:
                event = await queue.get()
                if event["type"] != "message.created":
                    continue
                view = event["data"]
                if (view.get("sender") or {}).get("type") != "agent":
                    continue
                if thread_id is None or view.get("thread_id") != str(thread_id):
                    continue
                try:
                    await self._forward(chat_id, view)
                except TelegramError as e:
                    log.warning("telegram forward failed for user %s: %s", user_id, e)
        finally:
            self._harness.bus.unsubscribe(user_id, queue)

    async def _lead_thread_id(self, user_id: uuid.UUID) -> uuid.UUID | None:
        a = t.agents
        async with self._harness.db() as conn:
            lead = (
                await conn.execute(
                    select(a.c.slug).where(
                        a.c.user_id == user_id, a.c.is_lead, a.c.state == "active"
                    )
                )
            ).one_or_none()
            if lead is None:
                return None
            return await resolve_thread(conn, user_id, f"direct:{lead.slug}")

    async def _forward(self, chat_id: int, view: dict) -> None:
        text = _format_text(view)
        choices = view.get("choices")
        attachments = view.get("attachments") or []
        if text or not attachments:
            reply_markup = _choices_keyboard(view["id"], choices) if choices else None
            await self._client.send_message(
                chat_id,
                text or "(không có nội dung)",
                reply_markup=reply_markup,
                parse_mode="HTML",
            )
        for att in attachments:
            await self._send_attachment(chat_id, att)

    async def _send_attachment(self, chat_id: int, att: dict) -> None:
        async with self._harness.db() as conn:
            row = (
                await conn.execute(
                    select(t.attachments.c.path, t.attachments.c.mime).where(
                        t.attachments.c.id == att["id"]
                    )
                )
            ).one_or_none()
        if row is None:
            return
        path = Path(row.path)
        try:
            if row.mime.startswith("image/"):
                await self._client.send_photo(chat_id, path)
            else:
                await self._client.send_document(chat_id, path)
        except TelegramError:
            await self._client.send_message(
                chat_id,
                f"Không thể gửi tệp '{att['filename']}' qua Telegram (có thể quá lớn); "
                "mở trên web để xem.",
            )


async def load_links(harness: Any) -> list[tuple[uuid.UUID, int]]:
    async with harness.db() as conn:
        rows = (
            await conn.execute(select(t.telegram_links.c.user_id, t.telegram_links.c.chat_id))
        ).all()
    return [(r.user_id, r.chat_id) for r in rows]
