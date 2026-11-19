"""The authenticated user as the API sees it, with their domain (doc 15 `Me`)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import Select, select

from backend.db import tables as t


def user_query() -> Select:
    """`users` left-joined with `domains`; filter with `.where(...)`."""
    u, d = t.users, t.domains
    return select(
        u.c.id,
        u.c.username,
        u.c.display_name,
        u.c.role,
        u.c.status,
        u.c.status_detail,
        u.c.password_hash,
        u.c.created_at,
        u.c.account_type,
        u.c.domain_id,
        d.c.name.label("domain_name"),
        d.c.status.label("domain_status"),
    ).select_from(u.outerjoin(d, u.c.domain_id == d.c.id))


@dataclass(frozen=True)
class CurrentUser:
    id: uuid.UUID
    username: str
    display_name: str
    role: str
    status: str
    status_detail: str | None
    created_at: datetime
    domain_id: str | None
    domain_name: str | None
    domain_status: str | None
    account_type: str

    @classmethod
    def from_row(cls, row: Any) -> CurrentUser:
        return cls(
            id=row.id,
            username=row.username,
            display_name=row.display_name,
            role=row.role,
            status=row.status,
            status_detail=row.status_detail,
            created_at=row.created_at,
            domain_id=row.domain_id,
            domain_name=row.domain_name,
            domain_status=row.domain_status,
            account_type=row.account_type,
        )

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    @property
    def is_human(self) -> bool:
        """A person's account. A `service` account (a group's technical owner) stores
        `role='user'` but is never a request principal (PLAN_GROUPCHAT §8)."""
        return self.account_type == "human"

    @property
    def domain(self) -> dict[str, str] | None:
        if self.domain_id is None:
            return None
        return {"id": self.domain_id, "name": self.domain_name, "status": self.domain_status}

    def me(self) -> dict[str, Any]:
        """`Me = {id, username, display_name, role, status, domain: {id, name, status} | null}`.

        `status` lets the client show provisioning/failed states; `status_detail` stays admin-only
        (it can carry raw exec output)."""
        return {
            "id": str(self.id),
            "username": self.username,
            "display_name": self.display_name,
            "role": self.role,
            "status": self.status,
            "domain": self.domain,
        }

    def admin_view(self) -> dict[str, Any]:
        """`User` in the admin API: `Me` plus status, status_detail and created_at."""
        return self.me() | {
            "status": self.status,
            "status_detail": self.status_detail,
            "created_at": self.created_at.isoformat(),
        }
