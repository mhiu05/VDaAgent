"""Builder routes (doc 15 "Agents and builder", doc 05).

Jobs (`202 {job_id}`): create, reset, skill install/remove, package add/remove, preset apply.
Synchronous, under the agent's job lock: prompt, routines, credential sets.
"""

from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Annotated

import httpx
from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import exists, func, select

from backend.agents import builder, folders, jobs
from backend.api.agents import Avatar, active_agent
from backend.api.catalog import domain_credential_sets, visible_skill
from backend.api.deps import Conn, UserRole
from backend.api.errors import ApiError
from backend.db import tables as t
from backend.domains.loader import load_domain

router = APIRouter(tags=["builder"])
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
GITHUB_TRANSPORT: httpx.AsyncBaseTransport | None = None  # tests replace it
Slug = Annotated[str, StringConstraints(max_length=64)]


class CreateAgent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slug: Slug
    display_name: Annotated[str, StringConstraints(min_length=1, max_length=100)]
    avatar: Avatar
    description: Annotated[str, StringConstraints(max_length=500)] = ""
    starter: str | None = None
    presets: list[str] = Field(default_factory=list, max_length=20)
    credentials: list[str] = Field(default_factory=list, max_length=20)


class PromptIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(max_length=100_000)


class SkillIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    catalog_id: str | None = None
    url: str | None = None


class PackageIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    preset_id: str | None = None
    package: str | None = Field(default=None, max_length=300)


class RoutineIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prompt: str = Field(max_length=20_000)
    cron: str = Field(max_length=200)
    enabled: bool = True


class CredentialsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sets: list[str] = Field(max_length=20)


def harness(request: Request):
    h = request.app.state.harness
    if h is None:
        raise ApiError(503, "unavailable", "Hệ thống agent chưa sẵn sàng.")
    return h


def _folder(request: Request, agent) -> Path:
    return folders.folder_of(request.app.state.settings, agent)


async def _job(request: Request, conn, user, agent, kind: str, req: dict) -> dict:
    job_id = await jobs.enqueue(
        harness(request),
        conn,
        user_id=user.id,
        kind=kind,
        request=req,
        agent_id=agent.id if agent else None,
    )
    return {"job_id": str(job_id)}


# --- create / reset -----------------------------------------------------------------------


@router.post("/agents", status_code=202)
async def create_agent(body: CreateAgent, request: Request, conn: Conn, user: UserRole) -> dict:
    s = request.app.state.settings
    if not folders.SLUG_RE.fullmatch(body.slug):
        raise ApiError(400, "invalid_slug")
    a = t.agents
    if await conn.scalar(select(exists().where(a.c.user_id == user.id, a.c.slug == body.slug))):
        raise ApiError(409, "slug_taken")
    active = await conn.scalar(
        select(func.count()).select_from(a).where(a.c.user_id == user.id, a.c.state == "active")
    )
    if active >= s.MAX_AGENTS_PER_USER:
        raise ApiError(409, "agent_limit")
    if await jobs.active_job(conn, user.id, "agent_create", "slug", body.slug):
        raise ApiError(409, "job_running")
    if body.starter is not None:
        domain = await load_domain(conn, user.domain_id or "")
        if body.starter not in {x.slug for x in domain.starters}:
            raise ApiError(400, "invalid_request", f"Không có mẫu {body.starter}.")
    await jobs.preset_packages(conn, body.presets, user.domain_id)
    available = [x["set"] for x in await domain_credential_sets(conn, user.domain_id)]
    unknown = [c for c in body.credentials if c not in available]
    if unknown:
        raise ApiError(400, "unknown_credential_set", ", ".join(unknown))
    req = body.model_dump()
    req["avatar"] = body.avatar.model_dump()
    return await _job(request, conn, user, None, "agent_create", req)


@router.post("/agents/{agent_id}/reset", status_code=202)
async def reset_agent(agent_id: str, request: Request, conn: Conn, user: UserRole) -> dict:
    agent = await active_agent(conn, agent_id, user)
    if await folders.involved_in_running_task(conn, agent.id):
        raise ApiError(409, "agent_busy_in_task")
    return await _job(request, conn, user, agent, "agent_reset", {})


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, conn: Conn, user: UserRole) -> dict:
    try:
        jid = uuid.UUID(job_id)
    except ValueError:
        raise ApiError(404, "not_found") from None
    row = (
        await conn.execute(select(t.jobs).where(t.jobs.c.id == jid, t.jobs.c.user_id == user.id))
    ).one_or_none()
    if row is None:
        raise ApiError(404, "not_found")
    return jobs.job_view(row)


# --- prompt -------------------------------------------------------------------------------


@router.get("/agents/{agent_id}/prompt")
async def get_prompt(agent_id: str, request: Request, conn: Conn, user: UserRole) -> dict:
    agent = await active_agent(conn, agent_id, user)
    folder = _folder(request, agent)
    from backend.agents import gitops

    return {"text": builder.read_prompt(folder), "commit": await gitops.head(folder)}


@router.put("/agents/{agent_id}/prompt")
async def put_prompt(
    agent_id: str, body: PromptIn, request: Request, conn: Conn, user: UserRole
) -> dict:
    agent = await active_agent(conn, agent_id, user)
    h = harness(request)
    async with h.job_lock(agent.id):
        return await builder.save_prompt(
            h, conn, agent, _folder(request, agent), body.text, user.username
        )


# --- skills -------------------------------------------------------------------------------


@router.get("/agents/{agent_id}/skills")
async def get_skills(agent_id: str, request: Request, conn: Conn, user: UserRole) -> list[dict]:
    agent = await active_agent(conn, agent_id, user)
    return await builder.list_skills(conn, _folder(request, agent), user.domain_id)


async def _pin(settings, repo: str, ref: str) -> str:
    if SHA_RE.fullmatch(ref):
        return ref
    url = f"{settings.GITHUB_API_URL.rstrip('/')}/repos/{repo}/commits/{ref}"
    headers = {"Accept": "application/vnd.github+json"}
    token = settings.GITHUB_TOKEN.get_secret_value()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        async with httpx.AsyncClient(transport=GITHUB_TRANSPORT, timeout=20) as client:
            r = await client.get(url, headers=headers)
        sha = r.json().get("sha", "") if r.status_code == 200 else ""
    except (httpx.HTTPError, ValueError):
        sha = ""
    if not SHA_RE.fullmatch(sha):
        raise ApiError(400, "invalid_request", f"Không tìm thấy nhánh {ref} của {repo}.")
    return sha


@router.post("/agents/{agent_id}/skills", status_code=202)
async def install_skill(
    agent_id: str, body: SkillIn, request: Request, conn: Conn, user: UserRole
) -> dict:
    agent = await active_agent(conn, agent_id, user)
    if (body.catalog_id is None) == (body.url is None):
        raise ApiError(400, "invalid_request", "Cần đúng một trong catalog_id hoặc url.")
    if body.catalog_id is not None:
        from backend.api.catalog import _require_marketplace

        _require_marketplace()
        row = await visible_skill(conn, user, body.catalog_id)
        argv = [*row.install_cmd, "--name", row.name]
    else:
        repo, path, ref = builder.parse_skill_url(body.url)
        sha = await _pin(request.app.state.settings, repo, ref)
        argv = ["python", "-m", "contoso.skills", "install", repo, path, "--ref", sha]
    return await _job(request, conn, user, agent, "skill_install", {"argv": argv})


@router.delete("/agents/{agent_id}/skills/{name}", status_code=202)
async def remove_skill(
    agent_id: str, name: str, request: Request, conn: Conn, user: UserRole
) -> dict:
    agent = await active_agent(conn, agent_id, user)
    if (
        not builder.SAFE_SKILL.match(name)
        or not (_folder(request, agent) / "skills" / name).is_dir()
    ):
        raise ApiError(404, "not_found")
    return await _job(request, conn, user, agent, "skill_remove", {"name": name})


# --- packages -----------------------------------------------------------------------------


@router.get("/agents/{agent_id}/packages")
async def get_packages(agent_id: str, request: Request, conn: Conn, user: UserRole) -> list[dict]:
    agent = await active_agent(conn, agent_id, user)
    return builder.list_packages(_folder(request, agent))


@router.post("/agents/{agent_id}/packages", status_code=202)
async def add_packages(
    agent_id: str, body: PackageIn, request: Request, conn: Conn, user: UserRole
) -> dict:
    agent = await active_agent(conn, agent_id, user)
    if (body.preset_id is None) == (body.package is None):
        raise ApiError(400, "invalid_request", "Cần đúng một trong preset_id hoặc package.")
    if body.preset_id is not None:
        (packages,) = await jobs.preset_packages(conn, [body.preset_id], user.domain_id)
        return await _job(
            request,
            conn,
            user,
            agent,
            "preset_apply",
            {"preset_id": body.preset_id, "argv": ["uv", "add", *packages]},
        )
    spec = builder.check_spec(body.package)
    return await _job(
        request, conn, user, agent, "package_add", {"package": spec, "argv": ["uv", "add", spec]}
    )


@router.delete("/agents/{agent_id}/packages/{name}", status_code=202)
async def remove_package(
    agent_id: str, name: str, request: Request, conn: Conn, user: UserRole
) -> dict:
    agent = await active_agent(conn, agent_id, user)
    names = {p["name"] for p in builder.list_packages(_folder(request, agent))}
    if name.lower() not in names:
        raise ApiError(404, "not_found")
    return await _job(
        request,
        conn,
        user,
        agent,
        "package_remove",
        {"name": name, "argv": ["uv", "remove", name.lower()]},
    )


# --- routines -----------------------------------------------------------------------------


@router.get("/agents/{agent_id}/routines")
async def get_routines(agent_id: str, request: Request, conn: Conn, user: UserRole) -> list[dict]:
    agent = await active_agent(conn, agent_id, user)
    return await builder.list_routines(conn, agent, _folder(request, agent))


@router.put("/agents/{agent_id}/routines/{name}")
async def put_routine(
    agent_id: str, name: str, body: RoutineIn, request: Request, conn: Conn, user: UserRole
) -> dict:
    agent = await active_agent(conn, agent_id, user)
    h = harness(request)
    async with h.job_lock(agent.id):
        return await builder.save_routine(
            h,
            conn,
            agent,
            _folder(request, agent),
            name,
            body.prompt,
            body.cron,
            body.enabled,
            user.username,
        )


@router.delete("/agents/{agent_id}/routines/{name}", status_code=204)
async def delete_routine(
    agent_id: str, name: str, request: Request, conn: Conn, user: UserRole
) -> Response:
    agent = await active_agent(conn, agent_id, user)
    h = harness(request)
    async with h.job_lock(agent.id):
        await builder.delete_routine(h, conn, agent, _folder(request, agent), name, user.username)
    return Response(status_code=204)


# --- credential sets ----------------------------------------------------------------------


@router.get("/agents/{agent_id}/credentials")
async def get_credentials(
    agent_id: str, request: Request, conn: Conn, user: UserRole
) -> list[dict]:
    agent = await active_agent(conn, agent_id, user)
    return builder.attached_sets(_folder(request, agent))


@router.put("/agents/{agent_id}/credentials")
async def put_credentials(
    agent_id: str, body: CredentialsIn, request: Request, conn: Conn, user: UserRole
) -> list[dict]:
    agent = await active_agent(conn, agent_id, user)
    h = harness(request)
    available = [x["set"] for x in await domain_credential_sets(conn, user.domain_id)]
    async with h.job_lock(agent.id):
        return await builder.save_credentials(
            h,
            conn,
            agent,
            _folder(request, agent),
            user.domain_id,
            body.sets,
            available,
        )
