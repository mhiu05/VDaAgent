"""Human group lifecycle and membership routes."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Request, Response
from pydantic import BaseModel, ConfigDict, StringConstraints
from sqlalchemy import select

from backend import accounts, groups
from backend.api.agents import agent_view
from backend.api.deps import Conn, UserRole
from backend.db import tables as t

router = APIRouter(prefix="/groups", tags=["groups"])
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class CreateGroup(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Name


class AddMember(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: uuid.UUID


class AddAgent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    agent_id: uuid.UUID


@router.post("", status_code=202)
async def create_group(body: CreateGroup, request: Request, conn: Conn, user: UserRole) -> dict:
    group, job_id = await groups.create_group(request.app.state.harness, conn, user, body.name)
    return {"group": group, "job_id": str(job_id)}


@router.get("")
async def list_groups(conn: Conn, user: UserRole) -> list[dict]:
    return await groups.list_groups(conn, user.id)


@router.get("/member-candidates")
async def member_candidates(conn: Conn, user: UserRole, q: str = Query(default="")) -> list[dict]:
    return await groups.member_candidates(conn, q)


@router.get("/{group_id}")
async def group_detail(group_id: uuid.UUID, conn: Conn, user: UserRole) -> dict:
    return await groups.group_detail(conn, group_id, user.id)


@router.get("/{group_id}/agents")
async def group_agents(group_id: uuid.UUID, conn: Conn, user: UserRole) -> list[dict]:
    group = await groups.require_member(conn, group_id, user.id)
    rows = (
        await conn.execute(
            select(t.agents)
            .where(t.agents.c.user_id == group.technical_owner_id, t.agents.c.state == "active")
            .order_by(t.agents.c.is_lead.desc(), t.agents.c.created_at, t.agents.c.slug)
        )
    ).all()
    return [agent_view(row) for row in rows]


@router.post("/{group_id}/agents", status_code=202)
async def add_agent(
    group_id: uuid.UUID, body: AddAgent, request: Request, conn: Conn, user: UserRole
) -> dict:
    """Copy one of the caller's personal agents into the group's own team."""
    app = request.app.state
    job_id = await groups.add_agent(app.harness, conn, app.settings, group_id, user, body.agent_id)
    return {"job_id": str(job_id)}


@router.get("/{group_id}/provisioning")
async def provisioning_status(group_id: uuid.UUID, conn: Conn, user: UserRole) -> dict:
    return await groups.provisioning_status(conn, group_id, user.id)


@router.post("/{group_id}/provisioning/retry", status_code=202)
async def retry_provisioning(
    group_id: uuid.UUID, request: Request, conn: Conn, user: UserRole
) -> dict:
    group = await groups.require_member(conn, group_id, user.id)
    owner = (
        await conn.execute(t.users.select().where(t.users.c.id == group.technical_owner_id))
    ).one()
    job_id = await accounts.requeue_provisioning(
        request.app.state.harness, conn, owner.id, owner.domain_id
    )
    return {"job_id": str(job_id)}


@router.post("/{group_id}/members", status_code=201)
async def add_member(
    group_id: uuid.UUID, body: AddMember, request: Request, conn: Conn, user: UserRole
) -> dict:
    group = await groups.add_member(
        request.app.state.harness, conn, group_id, user.id, body.user_id
    )
    return {"members": group["members"]}


@router.delete("/{group_id}/members/{user_id}", status_code=204)
async def remove_member(
    group_id: uuid.UUID, user_id: uuid.UUID, request: Request, conn: Conn, user: UserRole
) -> Response:
    await groups.remove_member(request.app.state.harness, conn, group_id, user.id, user_id)
    return Response(status_code=204)
