"""Creating, resetting and deleting an agent (doc 04).

These functions don't take the agent's job lock: the builder job worker (S9) runs them under
it. Starting and stopping runners is the supervisor's (S5b); the caller does that after the
transaction commits.
"""

from __future__ import annotations

import re
import shutil
import time
import uuid
from collections.abc import Sequence
from pathlib import Path
from typing import Any, Protocol

from sqlalchemy import and_, delete, exists, func, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from backend import ids
from backend.agents import gitops
from backend.db import tables as t
from backend.domains import materialize
from backend.domains.loader import credential_set_names, load_domain
from backend.execd_client import ExecResult
from backend.harness.epochs import open_epoch
from backend.settings import Settings

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,31}$")
SYSTEM_EXEC_TIMEOUT_S = 600  # doc 11 "Limits": system execs
PACKAGE_COMMANDS = (("uv", "add"), ("uv", "sync"))


class Execd(Protocol):
    async def exec(self, **kwargs: Any) -> ExecResult: ...


class AgentError(Exception):
    def __init__(self, status: int, code: str, message: str = "") -> None:
        super().__init__(f"{code}: {message}" if message else code)
        self.status = status
        self.code = code
        self.message = message


def folder_path(settings: Settings, user_id: uuid.UUID, slug: str) -> Path:
    return Path(settings.FOLDERS_DIR) / str(user_id) / slug


def folder_of(settings: Settings, agent: Any) -> Path:
    return folder_path(settings, agent.user_id, agent.slug)


def trash(settings: Settings, folder: Path, user_id: uuid.UUID, slug: str) -> Path:
    """Move a half-made or stale folder to `/data/folders/.trash/<user_id>-<slug>-<ts>/`."""
    root = Path(settings.FOLDERS_DIR) / ".trash"
    root.mkdir(parents=True, exist_ok=True)
    dest = root / f"{user_id}-{slug}-{int(time.time() * 1000)}"
    shutil.move(str(folder), dest)
    return dest


async def template_prompt(
    conn: AsyncConnection, settings: Settings, domain_id: str | None, *, origin: str, slug: str
) -> str | None:
    """The prompt a lead or starter agent is created with, as the domain says now: the domain's
    lead-starter prompt (else `platform/lead/prompt.md`) for the lead, the starter's prompt for
    a starter. None for custom agents and starters the domain no longer has."""
    domain = await load_domain(conn, domain_id) if domain_id else None
    if origin == "lead":
        if domain is not None and domain.lead_prompt is not None:
            return domain.lead_prompt
        path = Path(settings.PLATFORM_DIR) / "lead" / "prompt.md"
        return path.read_text(encoding="utf-8") if path.is_file() else ""
    if origin == "starter" and domain is not None:
        starter = next((s for s in domain.starters if s.slug == slug), None)
        return starter.prompt if starter is not None else None
    return None


def exec_timeout(settings: Settings, argv: list[str]) -> int:
    """Package installs wait on PyPI (the uv cache may be cold); every other system exec keeps
    the tighter doc 11 limit."""
    if tuple(argv[:2]) in PACKAGE_COMMANDS:
        return settings.AGENT_PACKAGE_INSTALL_TIMEOUT_S
    return SYSTEM_EXEC_TIMEOUT_S


async def system_exec(
    execd: Execd,
    folder: Path,
    argv: list[str],
    *,
    author: str = gitops.HARNESS,
    timeout_s: int = SYSTEM_EXEC_TIMEOUT_S,
) -> ExecResult:
    result = await execd.exec(
        folder=str(folder),
        exec_id=ids.exec_id(),
        argv=argv,
        timeout_s=timeout_s,
        author=author,
    )
    if result.exit_code != 0:
        tail = (result.stderr or result.stdout or "")[-2000:]
        raise AgentError(500, "exec_failed", f"{' '.join(argv)} exited {result.exit_code}: {tail}")
    return result


async def involved_in_running_task(conn: AsyncConnection, agent_id: uuid.UUID) -> bool:
    ti, g = t.task_involvement, t.global_tasks
    return bool(
        await conn.scalar(
            select(
                exists().where(
                    and_(ti.c.agent_id == agent_id, ti.c.task_id == g.c.id, g.c.status == "running")
                )
            )
        )
    )


async def create_agent(
    conn: AsyncConnection,
    *,
    settings: Settings,
    execd: Execd,
    user_id: uuid.UUID,
    domain_id: str | None,
    slug: str,
    display_name: str,
    avatar: dict,
    description: str = "",
    origin: str,
    prompt: str = "",
    is_lead: bool = False,
    presets: Sequence[Sequence[str]] = (),
    credential_sets: Sequence[str] = (),
    author: str = gitops.HARNESS,
) -> Any:
    """Steps 1-7 of doc 04 "Creating an agent". Returns the new `agents` row."""
    # 1. slug, uniqueness (deleted agents included), limit
    if not SLUG_RE.fullmatch(slug):
        raise AgentError(400, "invalid_slug")
    a = t.agents
    if await conn.scalar(select(exists().where(a.c.user_id == user_id, a.c.slug == slug))):
        raise AgentError(409, "slug_taken")
    active = await conn.scalar(
        select(func.count()).select_from(a).where(a.c.user_id == user_id, a.c.state == "active")
    )
    if active >= settings.MAX_AGENTS_PER_USER:
        raise AgentError(409, "agent_limit")
    available_sets = await credential_set_names(conn, domain_id) if domain_id else []
    for name in credential_sets:
        if name not in available_sets:
            raise AgentError(400, "unknown_credential_set", name)

    folder = folder_path(settings, user_id, slug)
    if folder.exists():  # left over from a crash before the row was inserted
        trash(settings, folder, user_id, slug)
    folder.parent.mkdir(parents=True, exist_ok=True)
    try:
        # 2-3. skeleton + prompt
        shutil.copytree(Path(settings.PLATFORM_DIR) / "agent-skeleton", folder, symlinks=True)
        (folder / "prompts" / "system.md").write_text(prompt, encoding="utf-8")
        # 4. credential values, decrypted and written straight into the agent's folder
        if credential_sets:
            for name in credential_sets:
                await materialize.materialize(
                    conn, settings, domain_id or "", name, folder / ".env.d"
                )
        # 5. first commit
        await gitops.init(folder)
        await gitops.commit_all(folder, author, f"create {slug}")
        # 6. packages, one snapshot per run
        install = exec_timeout(settings, ["uv", "add"])
        await system_exec(execd, folder, ["uv", "sync"], author=author, timeout_s=install)
        for packages in presets:
            if packages:
                await system_exec(
                    execd, folder, ["uv", "add", *packages], author=author, timeout_s=install
                )
        baseline = await gitops.head(folder)
        # 7. row, epoch 0, direct thread
        row = (
            await conn.execute(
                a.insert()
                .values(
                    user_id=user_id,
                    slug=slug,
                    display_name=display_name,
                    description=description,
                    avatar=avatar,
                    origin=origin,
                    is_lead=is_lead,
                    state="active",
                    status="idle",
                    baseline_commit=baseline,
                )
                .returning(*a.c)
            )
        ).one()
        await open_epoch(
            conn,
            agent_id=row.id,
            user_id=user_id,
            folder=folder,
            is_lead=is_lead,
            platform_dir=Path(settings.PLATFORM_DIR),
            domains_dir=Path(settings.DOMAINS_DIR),
            reason="initial",
            start_seq=0,
        )
        thread_id = await conn.scalar(
            t.threads.insert()
            .values(user_id=user_id, kind="direct", member_key=slug)
            .returning(t.threads.c.id)
        )
        await conn.execute(
            t.thread_members.insert(),
            [
                {"thread_id": thread_id, "member_type": "user", "member_id": user_id},
                {"thread_id": thread_id, "member_type": "agent", "member_id": row.id},
            ],
        )
        return row
    except BaseException as e:
        if folder.exists():
            trash(settings, folder, user_id, slug)
        if isinstance(e, AgentError) and e.code == "exec_failed":
            raise AgentError(500, "create_failed", e.message) from e
        if isinstance(e, gitops.GitError):
            raise AgentError(500, "create_failed", str(e)) from e
        raise


async def reset_agent(
    conn: AsyncConnection, *, settings: Settings, execd: Execd, agent: Any
) -> None:
    """Steps 2-5 of doc 04 "Reset". Step 6 (rebuilding `routine_state`) is the caller's."""
    if await involved_in_running_task(conn, agent.id):
        raise AgentError(409, "agent_busy_in_task")
    folder = folder_of(settings, agent)
    await gitops.restore_to(folder, agent.baseline_commit)
    # lead and starter agents take the domain's current template, so a fixed starter prompt
    # reaches agents created before the fix; custom agents keep the prompt they were made with
    domain_id = await conn.scalar(select(t.users.c.domain_id).where(t.users.c.id == agent.user_id))
    prompt = await template_prompt(conn, settings, domain_id, origin=agent.origin, slug=agent.slug)
    if prompt is not None:
        (folder / "prompts" / "system.md").write_text(prompt, encoding="utf-8")
    await gitops.commit_all(folder, gitops.HARNESS, "reset")
    sync = ["uv", "sync"]
    await system_exec(execd, folder, sync, timeout_s=exec_timeout(settings, sync))
    await open_epoch(
        conn,
        agent_id=agent.id,
        user_id=agent.user_id,
        folder=folder,
        is_lead=agent.is_lead,
        platform_dir=Path(settings.PLATFORM_DIR),
        domains_dir=Path(settings.DOMAINS_DIR),
        reason="reset",
        summary="",
    )


async def delete_agent(conn: AsyncConnection, *, settings: Settings, agent: Any) -> None:
    """Doc 04 "Delete": the folder stays on disk for the admin trace view."""
    if agent.is_lead:
        raise AgentError(409, "lead_protected")
    if await involved_in_running_task(conn, agent.id):
        raise AgentError(409, "agent_busy_in_task")
    await conn.execute(update(t.agents).where(t.agents.c.id == agent.id).values(state="deleted"))
    th, tm = t.threads, t.thread_members
    await conn.execute(
        update(th)
        .where(th.c.user_id == agent.user_id, th.c.kind == "direct", th.c.member_key == agent.slug)
        .values(read_only=True)
    )
    group_ids = select(th.c.id).where(th.c.user_id == agent.user_id, th.c.kind == "group")
    await conn.execute(
        delete(tm).where(
            tm.c.member_type == "agent", tm.c.member_id == agent.id, tm.c.thread_id.in_(group_ids)
        )
    )
