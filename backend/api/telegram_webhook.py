"""`POST /telegram/webhook`: inbound updates from the Telegram Bot API (see the Telegram
integration plan). Verified by the `X-Telegram-Bot-Api-Secret-Token` header, never by session
cookie -- Telegram never sends one. Mounted directly on the app, outside `/api`.
"""

from __future__ import annotations

import hmac
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request
from sqlalchemy import delete, select

from backend import ids
from backend.db import tables as t
from backend.harness.items import resolve_thread
from backend.messaging import attachments
from backend.messaging.messages import post_message
from backend.telegram_client import TelegramClient, TelegramError

router = APIRouter(prefix="/telegram", tags=["telegram-webhook"])
log = logging.getLogger("contoso.telegram")


async def _lead_agent(conn: Any, user_id: uuid.UUID) -> Any:
    a = t.agents
    return (
        await conn.execute(
            select(a).where(a.c.user_id == user_id, a.c.is_lead, a.c.state == "active")
        )
    ).one_or_none()


async def _resolve_user(conn: Any, chat_id: int) -> uuid.UUID | None:
    """The linked user, only while their account is `active`: a provisioning, failed or
    disabled account must not reach its agents through Telegram (the web blocks them too)."""
    u, links = t.users, t.telegram_links
    return await conn.scalar(
        select(links.c.user_id)
        .select_from(links.join(u, u.c.id == links.c.user_id))
        .where(links.c.chat_id == chat_id, u.c.status == "active")
    )


async def _lead_thread(conn: Any, user_id: uuid.UUID, lead: Any) -> uuid.UUID | None:
    """The user's own `direct` thread with the lead agent (doc 04 "`direct:<slug>`"): the
    same thread the web chat uses, not the admin-only `agent` thread.
    """
    return await resolve_thread(conn, user_id, f"direct:{lead.slug}")


async def _link(conn: Any, client: TelegramClient, chat_id: int, code: str) -> uuid.UUID | None:
    if not code:
        await client.send_message(chat_id, "Thiếu mã liên kết. Vào Settings trên web để lấy mã.")
        return None
    codes = t.telegram_link_codes
    row = (await conn.execute(select(codes).where(codes.c.code == code))).one_or_none()
    status = (
        await conn.scalar(select(t.users.c.status).where(t.users.c.id == row.user_id))
        if row is not None
        else None
    )
    if row is None or row.expires_at < datetime.now(UTC) or status != "active":
        await client.send_message(
            chat_id,
            "Mã liên kết không hợp lệ hoặc đã hết hạn. Vào Settings trên web để lấy mã mới.",
        )
        return None
    await conn.execute(delete(t.telegram_link_codes).where(t.telegram_link_codes.c.code == code))
    await conn.execute(
        delete(t.telegram_links).where(
            (t.telegram_links.c.user_id == row.user_id) | (t.telegram_links.c.chat_id == chat_id)
        )
    )
    await conn.execute(t.telegram_links.insert().values(user_id=row.user_id, chat_id=chat_id))
    await client.send_message(
        chat_id, "Liên kết thành công! Bạn có thể chat với agent của mình ngay tại đây."
    )
    return row.user_id


async def _handle_message(harness: Any, client: TelegramClient, bridge: Any, message: dict) -> None:
    chat_id = message["chat"]["id"]
    text = message.get("text")
    if text and text.startswith("/start"):
        parts = text.split(maxsplit=1)
        code = parts[1].strip() if len(parts) > 1 else ""
        async with harness.db() as conn:
            linked_user_id = await _link(conn, client, chat_id, code)
        if linked_user_id is not None and bridge is not None:
            bridge.watch(linked_user_id, chat_id)
        return

    async with harness.db() as conn:
        user_id = await _resolve_user(conn, chat_id)
    if user_id is None:
        await client.send_message(
            chat_id,
            "Tài khoản chưa liên kết hoặc hiện không hoạt động. "
            "Vào Settings trên web để lấy mã /start.",
        )
        return

    photo = message.get("photo")
    document = message.get("document")
    incoming_files: list[attachments.Incoming] = []
    try:
        if photo:
            # Telegram sorts `photo` ascending by size; the last entry is the largest.
            data = await client.download_file(photo[-1]["file_id"])
            incoming_files = attachments.from_upload([("photo.jpg", data, "image/jpeg")])
        elif document:
            data = await client.download_file(document["file_id"])
            incoming_files = attachments.from_upload(
                [(document.get("file_name") or "file", data, document.get("mime_type"))]
            )
    except TelegramError as e:
        await client.send_message(chat_id, f"Không tải được tệp từ Telegram: {e.message or e.code}")
        return

    content_text = text or message.get("caption") or ""
    if not content_text and not incoming_files:
        return

    async with harness.db() as conn:
        lead = await _lead_agent(conn, user_id)
        if lead is None:
            await client.send_message(chat_id, "Chưa có agent điều phối cho tài khoản này.")
            return
        thread_id = await _lead_thread(conn, user_id, lead)
        if thread_id is None:
            await client.send_message(chat_id, "Chưa có cuộc trò chuyện với agent điều phối.")
            return

        async def store_and_copy(message_id: int, receivers: list) -> None:
            stored = await attachments.store(conn, harness.settings, message_id, incoming_files)
            await attachments.copy_to_inboxes(harness, receivers, message_id, stored)

        await post_message(
            harness,
            conn,
            thread_id=thread_id,
            sender_type="user",
            sender_id=user_id,
            content={"text": content_text},
            trace_id=ids.trace_id(),
            before_deliveries=store_and_copy,
        )


async def _handle_callback(harness: Any, client: TelegramClient, callback: dict) -> None:
    cq_id = callback["id"]
    chat = (callback.get("message") or {}).get("chat") or {}
    chat_id = chat.get("id")
    data = callback.get("data") or ""
    if chat_id is None or ":" not in data:
        await client.answer_callback_query(cq_id)
        return
    message_id_str, choice_id = data.split(":", 1)
    try:
        message_id = int(message_id_str)
    except ValueError:
        await client.answer_callback_query(cq_id)
        return

    async with harness.db() as conn:
        user_id = await _resolve_user(conn, chat_id)
        if user_id is None:
            await client.answer_callback_query(cq_id)
            return
        lead = await _lead_agent(conn, user_id)
        if lead is None:
            await client.answer_callback_query(cq_id)
            return
        thread_id = await _lead_thread(conn, user_id, lead)
        if thread_id is None:
            await client.answer_callback_query(cq_id)
            return
        await post_message(
            harness,
            conn,
            thread_id=thread_id,
            sender_type="user",
            sender_id=user_id,
            content={"text": "", "reply_to": message_id, "choice_id": choice_id},
            trace_id=ids.trace_id(),
        )
    await client.answer_callback_query(cq_id, text="Đã nhận lựa chọn của bạn.")


@router.post("/webhook")
async def webhook(
    request: Request,
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
) -> dict:
    settings = request.app.state.settings
    secret = settings.TELEGRAM_WEBHOOK_SECRET.get_secret_value()
    given = (x_telegram_bot_api_secret_token or "").encode()
    if not secret or not hmac.compare_digest(given, secret.encode()):
        raise HTTPException(403, "invalid secret token")
    harness = request.app.state.harness
    client = getattr(request.app.state, "telegram_client", None)
    bridge = getattr(request.app.state, "telegram_bridge", None)
    if harness is None or client is None:
        return {"ok": True}
    update = await request.json()
    try:
        if "callback_query" in update:
            await _handle_callback(harness, client, update["callback_query"])
        elif "message" in update:
            await _handle_message(harness, client, bridge, update["message"])
    except Exception:
        log.exception("telegram webhook handling failed")
    return {"ok": True}
