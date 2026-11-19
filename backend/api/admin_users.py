"""`/api/admin/users*` (doc 15 "Admin API"; doc 12 "User management").

`User = {id, username, display_name, role, domain: {id, name, status}, status,
status_detail, created_at}`; the list adds `provisioning: {job_status, step, agent, done, total}`
while a user is provisioning (null otherwise). Only `user`-role accounts are listed or changed
here; an admin's id gives 404. `POST /users/{id}/retry` re-queues a failed provisioning.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, StringConstraints, field_validator, model_validator
from sqlalchemy import exists, select

from backend import accounts
from backend.agents import provisioning
from backend.api.deps import Conn, after_commit_runtime, require_admin
from backend.api.errors import ApiError
from backend.db import tables as t
from backend.db.session import on_commit

router = APIRouter(prefix="/admin/users", tags=["admin"], dependencies=[Depends(require_admin)])

Password = Annotated[str, StringConstraints(min_length=1, max_length=256)]


class CreateUser(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str
    password: Password
    domain_id: str
    display_name: Annotated[str, StringConstraints(max_length=100)] = ""

    @field_validator("username")
    @classmethod
    def _username(cls, value: str) -> str:
        value = accounts.normalize_username(value)
        if not accounts.USERNAME_RE.fullmatch(value) or accounts.is_reserved_username(value):
            raise ValueError("invalid username")
        return value

    @model_validator(mode="after")
    def _display_name_is_not_the_password(self) -> CreateUser:
        # The display name is shown to every member of a group: never let a password land there
        # (a browser autofilling the field, or a slip of the keyboard). It is never echoed back.
        if self.display_name.strip() and self.display_name.strip() == self.password.strip():
            raise ValueError("display_name must not be the password")
        return self


class PatchUser(BaseModel):
    # `domain_id` is accepted only to answer 409: changing domain isn't supported (doc 12).
    model_config = ConfigDict(extra="forbid")
    disabled: bool | None = None
    password: Password | None = None
    domain_id: str | None = None


@router.get("")
async def list_users(conn: Conn, request: Request) -> list[dict]:
    users = await accounts.list_users(conn)
    steps = await provisioning.progress(conn, users)
    return [u.admin_view() | {"provisioning": steps.get(u.id)} for u in users]


def _kick_jobs(request: Request, conn) -> None:
    harness = getattr(request.app.state, "harness", None)
    if harness is not None and hasattr(harness, "jobs"):
        on_commit(conn, harness.jobs.kick)


@router.post("", status_code=202)
async def create_user(body: CreateUser, conn: Conn, request: Request) -> dict:
    if not await conn.scalar(select(exists().where(t.domains.c.id == body.domain_id))):
        raise ApiError(400, "invalid_request", "Miền dữ liệu không tồn tại.")
    try:
        user_id, job_id = await accounts.create_user(
            conn, body.username, body.password, body.domain_id, body.display_name
        )
    except accounts.UsernameTaken:
        raise ApiError(409, "username_taken") from None
    user = await accounts.get_user(conn, user_id)
    _kick_jobs(request, conn)
    return {"user": user.admin_view(), "job_id": str(job_id)}


@router.post("/{user_id}/retry", status_code=202)
async def retry_provisioning(user_id: uuid.UUID, conn: Conn, request: Request) -> dict:
    """Doc 12: continue a failed provisioning; agents that exist are skipped."""
    user = await accounts.get_user(conn, user_id)
    if user is None:
        raise ApiError(404, "not_found")
    job_id = await accounts.requeue_provisioning(
        request.app.state.harness, conn, user.id, user.domain_id
    )
    return {"job_id": str(job_id)}


@router.patch("/{user_id}")
async def patch_user(user_id: uuid.UUID, body: PatchUser, conn: Conn, request: Request) -> dict:
    user = await accounts.get_user(conn, user_id)
    if user is None:
        raise ApiError(404, "not_found")
    if body.domain_id is not None and body.domain_id != user.domain_id:
        raise ApiError(409, "domain_change_unsupported")
    if body.password is not None:
        await accounts.reset_password(conn, user, body.password)
    if body.disabled is not None and body.disabled != (user.status == "disabled"):
        await accounts.set_disabled(conn, user, body.disabled)
        # doc 12: disabling stops the user's runners, enabling starts them again
        if body.disabled:
            after_commit_runtime(request, conn, lambda h: h.supervisor.stop_user(user.id))
            bridge = getattr(request.app.state, "telegram_bridge", None)
            if bridge is not None:  # stop forwarding agent replies to the unlinked chat
                on_commit(conn, lambda: bridge.unwatch(user.id))
        elif (await accounts.get_user(conn, user.id)).status == "active":
            after_commit_runtime(request, conn, lambda h: h.supervisor.start_user(user.id))
    return (await accounts.get_user(conn, user_id)).admin_view()
