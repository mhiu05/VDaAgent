"""User notifications and preferences (doc 15 "User notifications", "Preferences"; doc 19).

Shapes are the frontend `Notification` and `Preferences` contracts. `access` is computed when the
inbox is read: `available` if the target still exists for the user, otherwise `missing`.
"""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from backend.api.deps import Conn, UserRole
from backend.api.errors import ApiError
from backend.db import tables as t
from backend.db.session import on_commit
from backend.notifications import notification_view
from backend.reports.schema import valid_timezone

router = APIRouter(tags=["inbox"])
DEFAULT_TZ = "Asia/Ho_Chi_Minh"


async def _access(conn, user_id, target: dict) -> str:
    kind = target.get("kind")
    if kind == "report":
        found = await conn.scalar(
            select(t.reports.c.id).where(
                t.reports.c.user_id == user_id, t.reports.c.code == target.get("reportId")
            )
        )
        return "available" if found else "missing"
    if kind == "chat":
        try:
            tid = uuid.UUID(str(target.get("conversationId")))
        except ValueError:
            return "missing"
        found = await conn.scalar(
            select(t.threads.c.id).where(t.threads.c.user_id == user_id, t.threads.c.id == tid)
        )
        return "available" if found else "missing"
    return "available"


async def _views(conn, user_id, query) -> list[dict]:
    rows = (await conn.execute(query)).all()
    return [notification_view(r, await _access(conn, user_id, r.target)) for r in rows]


@router.get("/notifications")
async def list_notifications(conn: Conn, user: UserRole, limit: int = 100) -> list[dict]:
    n = t.user_notifications
    limit = max(1, min(limit, 500))
    return await _views(
        conn,
        user.id,
        select(n)
        .where(n.c.user_id == user.id)
        .order_by(n.c.occurred_at.desc(), n.c.id.desc())
        .limit(limit),
    )


class ReadBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ids: list[str] | None = Field(default=None, max_length=500)


@router.post("/notifications/read")
async def mark_read(body: ReadBody, request: Request, conn: Conn, user: UserRole) -> list[dict]:
    n = t.user_notifications
    stmt = update(n).where(n.c.user_id == user.id, n.c.read_at.is_(None)).values(read_at=func.now())
    if body.ids is not None:
        try:
            ids = [uuid.UUID(i) for i in body.ids]
        except ValueError:
            raise ApiError(400, "invalid_request") from None
        stmt = stmt.where(n.c.id.in_(ids))
        event = {"ids": body.ids}
    else:
        event = {"all": True}
    await conn.execute(stmt)
    harness = request.app.state.harness
    if harness is not None:
        on_commit(conn, lambda: harness.bus.publish(user.id, "notification.read", event))
    return await _views(
        conn,
        user.id,
        select(n)
        .where(n.c.user_id == user.id)
        .order_by(n.c.occurred_at.desc(), n.c.id.desc())
        .limit(100),
    )


class Groups(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    reports: bool
    tasks: bool
    system: bool


class Preferences(BaseModel):
    model_config = ConfigDict(extra="forbid")
    displayName: str = Field(max_length=100)
    locale: Literal["vi", "en"]
    theme: Literal["light", "dark", "system"]
    timezone: str
    motion: Literal["system", "reduce"]
    density: Literal["comfortable", "compact"]
    notifications: Groups
    semanticExplanation: bool


def defaults(display_name: str) -> dict:
    return {
        "displayName": display_name,
        "locale": "vi",
        "theme": "light",
        "timezone": DEFAULT_TZ,
        "motion": "system",
        "density": "comfortable",
        "notifications": {"reports": True, "tasks": True, "system": True},
        "semanticExplanation": False,
    }


@router.get("/me/preferences")
async def get_preferences(conn: Conn, user: UserRole) -> dict:
    stored = await conn.scalar(
        select(t.user_preferences.c.value).where(t.user_preferences.c.user_id == user.id)
    )
    prefs = defaults(user.display_name)
    if isinstance(stored, dict):
        prefs.update({k: v for k, v in stored.items() if k in prefs and k != "displayName"})
    return prefs


@router.put("/me/preferences")
async def put_preferences(body: Preferences, conn: Conn, user: UserRole) -> dict:
    if not 1 <= len(body.displayName.strip()) <= 100:
        raise ApiError(400, "invalid_request", "Tên hiển thị cần 1 đến 100 ký tự.")
    if not valid_timezone(body.timezone):
        raise ApiError(400, "invalid_request", "Múi giờ không hợp lệ.")
    value = body.model_dump()
    display = value.pop("displayName").strip()
    up = t.user_preferences
    await conn.execute(
        pg_insert(up)
        .values(user_id=user.id, value=value)
        .on_conflict_do_update(
            index_elements=[up.c.user_id], set_={"value": value, "updated_at": func.now()}
        )
    )
    await conn.execute(update(t.users).where(t.users.c.id == user.id).values(display_name=display))
    return {"displayName": display, **value}
