"""`/api/telegram/*`: link or unlink the caller's Telegram account (see the Telegram
integration plan). The actual inbound/outbound traffic with Telegram lives in
`backend/api/telegram_webhook.py` and `backend/telegram_bridge.py`.
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Request, Response
from sqlalchemy import delete, select

from backend.api.deps import Conn, UserRole
from backend.api.errors import ApiError
from backend.db import tables as t
from backend.db.session import on_commit

router = APIRouter(prefix="/telegram", tags=["telegram"])
CODE_TTL = timedelta(minutes=10)


@router.post("/link")
async def create_link(request: Request, conn: Conn, user: UserRole) -> dict:
    settings = request.app.state.settings
    bot_username = settings.TELEGRAM_BOT_USERNAME
    if not bot_username:
        raise ApiError(400, "invalid_request", "Chưa cấu hình bot Telegram.")
    code = secrets.token_urlsafe(6)
    expires_at = datetime.now(UTC) + CODE_TTL
    await conn.execute(
        delete(t.telegram_link_codes).where(t.telegram_link_codes.c.user_id == user.id)
    )
    await conn.execute(
        t.telegram_link_codes.insert().values(code=code, user_id=user.id, expires_at=expires_at)
    )
    return {
        "code": code,
        "deep_link": f"https://t.me/{bot_username}?start={code}",
        "expires_at": expires_at.isoformat(),
    }


@router.get("/status")
async def status(conn: Conn, user: UserRole) -> dict:
    linked = await conn.scalar(
        select(t.telegram_links.c.chat_id).where(t.telegram_links.c.user_id == user.id)
    )
    return {"linked": linked is not None}


@router.post("/unlink", status_code=204)
async def unlink(request: Request, conn: Conn, user: UserRole) -> Response:
    await conn.execute(delete(t.telegram_links).where(t.telegram_links.c.user_id == user.id))
    bridge = getattr(request.app.state, "telegram_bridge", None)
    if bridge is not None:
        on_commit(conn, lambda: bridge.unwatch(user.id))
    return Response(status_code=204)
