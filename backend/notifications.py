"""User notifications for account and domain events (docs 12, 19 "User notifications").

Text comes from fixed bilingual templates; nothing user- or agent-written is copied in.
Preference groups are checked when the row is created: `account-created` is always sent,
`system` ones only when the user hasn't turned the `system` group off. The inbox endpoints,
SSE events and retention are S11.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from backend.db import tables as t

TEMPLATES: dict[str, dict[str, Any]] = {
    "account_created": {
        "kind": "account-created",
        "title": {"vi": "Chào mừng đến với VDaAgent", "en": "Welcome to VDaAgent"},
        "summary": {
            "vi": "Quản trị viên đã tạo tài khoản cho bạn. Thiết lập ngôn ngữ, giao diện và "
            "múi giờ trong phần Cài đặt.",
            "en": "An administrator created your account. Choose your language, appearance "
            "and timezone in Settings.",
        },
    },
    "password_reset": {
        "kind": "system",
        "title": {"vi": "Mật khẩu đã được đặt lại", "en": "Your password was reset"},
        "summary": {
            "vi": "Quản trị viên đã đặt lại mật khẩu của bạn. Hãy đăng nhập lại bằng mật khẩu mới.",
            "en": "An administrator reset your password. Sign in again with the new password.",
        },
    },
    "account_disabled": {
        "kind": "system",
        "title": {"vi": "Tài khoản đã bị vô hiệu hóa", "en": "Your account was disabled"},
        "summary": {
            "vi": "Quản trị viên đã vô hiệu hóa tài khoản của bạn. Liên hệ quản trị viên để "
            "được hỗ trợ.",
            "en": "An administrator disabled your account. Contact your administrator for help.",
        },
    },
    "domain_unavailable": {
        "kind": "system",
        "title": {
            "vi": "Miền dữ liệu đang lỗi cấu hình",
            "en": "Your data domain is misconfigured",
        },
        "summary": {
            "vi": "Miền dữ liệu đang lỗi cấu hình, liên hệ quản trị viên.",
            "en": "Your data domain has a configuration error. Contact your administrator.",
        },
    },
}

TEMPLATES.update(
    {
        "report_ready": {
            "kind": "report-ready",
            "title": {"vi": "Báo cáo đã sẵn sàng", "en": "Your report is ready"},
            "summary": {
                "vi": "Báo cáo {report} có phiên bản mới {version}.",
                "en": "Report {report} has a new version, {version}.",
            },
        },
        "report_failed": {
            "kind": "task-failed",
            "title": {"vi": "Không tạo được báo cáo", "en": "A report could not be created"},
            "summary": {
                "vi": "Lần tạo báo cáo {report} đã thất bại.",
                "en": "The latest attempt at report {report} failed.",
            },
        },
        "task_failed": {
            "kind": "task-failed",
            "title": {"vi": "Một việc đã thất bại", "en": "A task failed"},
            "summary": {
                "vi": "Việc T{task} đã dừng mà chưa hoàn thành.",
                "en": "Task T{task} stopped before it was finished.",
            },
        },
        "action_required": {
            "kind": "action-required",
            "title": {"vi": "Agent cần bạn chọn", "en": "An agent needs your choice"},
            "summary": {
                "vi": "Một agent đang chờ bạn chọn trong cuộc trò chuyện.",
                "en": "An agent is waiting for your choice in a conversation.",
            },
        },
    }
)

# Preference group per kind (doc 19); None means "always sent".
GROUP = {
    "account-created": None,
    "system": "system",
    "report-ready": "reports",
    "task-failed": "tasks",
    "action-required": "tasks",
}


async def _group_enabled(conn: AsyncConnection, user_id: uuid.UUID, group: str | None) -> bool:
    if group is None:
        return True
    value = await conn.scalar(
        select(t.user_preferences.c.value).where(t.user_preferences.c.user_id == user_id)
    )
    groups = (value or {}).get("notifications") if isinstance(value, dict) else None
    return not (isinstance(groups, dict) and groups.get(group) is False)


def notification_view(row: Any, access: str = "available") -> dict:
    """The frontend `Notification` contract."""
    return {
        "id": str(row.id),
        "kind": row.kind,
        "title": row.title,
        "summary": row.summary,
        "occurredAt": row.occurred_at.isoformat(),
        "readAt": row.read_at.isoformat() if row.read_at else None,
        "target": row.target,
        "access": access,
    }


async def notify(
    conn: AsyncConnection,
    user_id: uuid.UUID,
    template: str,
    *,
    target: dict | None = None,
    params: dict | None = None,
    bus: Any = None,
) -> uuid.UUID | None:
    """Create notification `template` for `user_id`; None when their preference skips it.

    `params` fill platform ids (report codes, task numbers) into the fixed templates; agent
    text never goes in. With `bus`, `notification.created` is published after commit.
    """
    tpl = TEMPLATES[template]
    kind = tpl["kind"]
    if not await _group_enabled(conn, user_id, GROUP[kind]):
        return None
    nid = uuid.uuid4()
    if target is None:
        target = (
            {"kind": "account"}
            if kind == "account-created"
            else {"kind": "system-detail", "notificationId": str(nid)}
        )
    fill = params or {}
    row = (
        await conn.execute(
            t.user_notifications.insert()
            .values(
                id=nid,
                user_id=user_id,
                kind=kind,
                title={k: v.format(**fill) for k, v in tpl["title"].items()},
                summary={k: v.format(**fill) for k, v in tpl["summary"].items()},
                target=target,
            )
            .returning(*t.user_notifications.c)
        )
    ).one()
    if bus is not None:
        from backend.db.session import on_commit

        view = notification_view(row)
        on_commit(conn, lambda: bus.publish(user_id, "notification.created", view))
    return nid


KEEP = 500


async def prune(conn: AsyncConnection) -> int:
    """Doc 19 "Retention": keep the 500 newest notifications per user (run at boot)."""
    from sqlalchemy import delete, func

    n = t.user_notifications
    ranked = select(
        n.c.id,
        func.row_number()
        .over(partition_by=n.c.user_id, order_by=(n.c.occurred_at.desc(), n.c.id.desc()))
        .label("rank"),
    ).subquery()
    old = select(ranked.c.id).where(ranked.c.rank > KEEP)
    result = await conn.execute(delete(n).where(n.c.id.in_(old)))
    return result.rowcount or 0
