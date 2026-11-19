"""`/api/agents*`: read, patch and delete agents, and the folder viewer (docs 15, 04).

`Agent = {id, slug, display_name, avatar, description, origin, is_lead, status,
status_detail, created_at}`. The team routes are for role `user`; the viewer routes also let
an admin open any agent's folder. Creating and resetting agents are builder jobs (S9).
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Query, Request, Response
from pydantic import BaseModel, ConfigDict, StringConstraints
from sqlalchemy import select, update

from backend.agents import folders, viewer
from backend.api.deps import AnyUser, Conn, UserRole, after_commit_runtime, get_owned
from backend.api.errors import ApiError
from backend.db import tables as t

router = APIRouter(prefix="/agents", tags=["agents"])


def agent_view(row: Any) -> dict:
    return {
        "id": str(row.id),
        "slug": row.slug,
        "display_name": row.display_name,
        "avatar": row.avatar,
        "description": row.description,
        "origin": row.origin,
        "is_lead": row.is_lead,
        "status": row.status,
        "status_detail": row.status_detail,
        "created_at": row.created_at.isoformat(),
    }


class Avatar(BaseModel):
    model_config = ConfigDict(extra="forbid")
    emoji: Annotated[str, StringConstraints(min_length=1, max_length=16)]
    color: Annotated[str, StringConstraints(pattern=r"^#[0-9A-Fa-f]{3,8}$")]


class PatchAgent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: Annotated[str, StringConstraints(min_length=1, max_length=100)] | None = None
    avatar: Avatar | None = None
    description: Annotated[str, StringConstraints(max_length=500)] | None = None


async def active_agent(conn, agent_id: str, user, *, allow_admin: bool = False):
    row = await get_owned(conn, t.agents, agent_id, user, allow_admin=allow_admin)
    if row.state != "active" and not (allow_admin and user.is_admin):
        raise ApiError(404, "not_found")
    return row


def _raise(e: folders.AgentError | viewer.ViewerError):
    raise ApiError(e.status, e.code, getattr(e, "message", None) or None) from e


@router.get("")
async def list_agents(conn: Conn, user: UserRole) -> list[dict]:
    rows = (
        await conn.execute(
            select(t.agents)
            .where(t.agents.c.user_id == user.id, t.agents.c.state == "active")
            .order_by(t.agents.c.is_lead.desc(), t.agents.c.created_at, t.agents.c.slug)
        )
    ).all()
    return [agent_view(r) for r in rows]


@router.get("/{agent_id}")
async def get_agent(agent_id: str, conn: Conn, user: UserRole) -> dict:
    return agent_view(await active_agent(conn, agent_id, user))


@router.patch("/{agent_id}")
async def patch_agent(agent_id: str, body: PatchAgent, conn: Conn, user: UserRole) -> dict:
    row = await active_agent(conn, agent_id, user)
    values = body.model_dump(exclude_none=True)
    if values:
        stmt = update(t.agents).where(t.agents.c.id == row.id).values(**values)
        row = (await conn.execute(stmt.returning(*t.agents.c))).one()
    return agent_view(row)


@router.delete("/{agent_id}", status_code=204)
async def delete_agent(agent_id: str, request: Request, conn: Conn, user: UserRole) -> Response:
    row = await active_agent(conn, agent_id, user)
    try:
        await folders.delete_agent(conn, settings=request.app.state.settings, agent=row)
    except folders.AgentError as e:
        _raise(e)
    after_commit_runtime(request, conn, lambda h: h.supervisor.stop_agent(row.id))
    return Response(status_code=204)


# --- folder viewer --------------------------------------------------------------------------


async def _folder(request: Request, conn, agent_id: str, user):
    row = await active_agent(conn, agent_id, user, allow_admin=True)
    return folders.folder_of(request.app.state.settings, row)


Path_ = Annotated[str, Query(max_length=1024)]
At = Annotated[str | None, Query(max_length=64)]


@router.get("/{agent_id}/tree")
async def tree(
    agent_id: str, request: Request, conn: Conn, user: AnyUser, path: Path_ = "", at: At = None
) -> list[dict]:
    folder = await _folder(request, conn, agent_id, user)
    try:
        return viewer.list_tree(folder, path, at=at)
    except viewer.ViewerError as e:
        _raise(e)


@router.get("/{agent_id}/file")
async def file(
    agent_id: str, request: Request, conn: Conn, user: AnyUser, path: Path_ = "", at: At = None
) -> Response:
    folder = await _folder(request, conn, agent_id, user)
    try:
        f = viewer.read_file(folder, path, at=at)
    except viewer.ViewerError as e:
        _raise(e)
    headers = {"X-Content-Type-Options": "nosniff"}
    if f.attachment:
        headers["Content-Disposition"] = f'attachment; filename="{_ascii(f.filename)}"'
    return Response(f.body, media_type=f.media_type, headers=headers)


@router.get("/{agent_id}/archive")
async def archive(
    agent_id: str, request: Request, conn: Conn, user: AnyUser, path: Path_ = "", at: At = None
) -> Response:
    folder = await _folder(request, conn, agent_id, user)
    try:
        data = viewer.archive(folder, path, at=at)
    except viewer.ViewerError as e:
        _raise(e)
    name = (path.strip("/").replace("/", "-") or folder.name) + ".zip"
    return Response(
        data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{_ascii(name)}"'},
    )


@router.get("/{agent_id}/log")
async def log(
    agent_id: str,
    request: Request,
    conn: Conn,
    user: AnyUser,
    path: Path_ = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
) -> list[dict]:
    folder = await _folder(request, conn, agent_id, user)
    try:
        return viewer.log(folder, path, limit=limit)
    except viewer.ViewerError as e:
        _raise(e)


@router.get("/{agent_id}/diff")
async def diff(
    agent_id: str, request: Request, conn: Conn, user: AnyUser, commit: At = None
) -> Response:
    folder = await _folder(request, conn, agent_id, user)
    try:
        text = viewer.diff(folder, commit)
    except viewer.ViewerError as e:
        _raise(e)
    return Response(text, media_type="text/plain; charset=utf-8")


def _ascii(name: str) -> str:
    return "".join(c if c.isascii() and c not in '"\\' else "_" for c in name)
