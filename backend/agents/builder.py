"""Builder operations on an agent folder (doc 05). The folder is the only source of truth.

Every change is a commit by `user:<username>` (credential links excepted: `.env.d/` is
git-ignored) and sends the agent a notice. Callers hold the agent's job lock.
"""

from __future__ import annotations

import re
import shutil
import tomllib
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml
from packaging.requirements import InvalidRequirement, Requirement
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from backend.agents import gitops
from backend.api.errors import ApiError
from backend.db import tables as t
from backend.harness import routines
from backend.harness.notices import send_notice
from backend.harness.render import frontmatter

SAFE_SKILL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
GITHUB_TREE = re.compile(
    r"^https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)/tree/([^/]+)/(.+?)/?$"
)


def author_of(username: str) -> str:
    return f"user:{username}"


# --- prompt -------------------------------------------------------------------------------


def read_prompt(folder: Path) -> str:
    try:
        return (folder / "prompts" / "system.md").read_text(encoding="utf-8")
    except OSError:
        return ""


async def save_prompt(
    h: Any, conn: AsyncConnection, agent: Any, folder: Path, text: str, username: str
) -> dict:
    """Doc 05 "Prompt edits": write, commit, notice with the diff, compaction pending."""
    path = folder / "prompts" / "system.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    head = await gitops.commit_all(folder, author_of(username), "edit prompt")
    if head is None:
        return {"text": text, "commit": await gitops.head(folder)}
    diff = await gitops.run(
        folder, "diff", "--no-color", "-U2", f"{head}~1", head, "--", "prompts/system.md"
    )
    body = "\n".join(
        line for line in diff.splitlines() if not line.startswith(("diff --git", "index "))
    )
    await send_notice(
        h, conn, agent.id, "builder", f"Người dùng đã cập nhật vai trò của bạn:\n{body}"
    )
    await conn.execute(
        update(t.agents).where(t.agents.c.id == agent.id).values(compaction_pending=True)
    )
    return {"text": text, "commit": head}


# --- skills -------------------------------------------------------------------------------


async def list_skills(conn: AsyncConnection, folder: Path, domain_id: str | None) -> list[dict]:
    s = t.skill_catalog
    catalog = {
        r.name: r.id
        for r in (
            await conn.execute(
                select(s.c.name, s.c.id).where(
                    (s.c.domain_id.is_(None)) | (s.c.domain_id == domain_id)
                )
            )
        ).all()
    }
    out = []
    root = folder / "skills"
    for d in (
        sorted(p for p in root.iterdir() if p.is_dir() and not p.name.startswith("."))
        if root.is_dir()
        else []
    ):
        meta = frontmatter(
            (d / "SKILL.md").read_text(encoding="utf-8", errors="replace")
            if (d / "SKILL.md").is_file()
            else ""
        )
        author = await gitops.run(folder, "log", "-1", "--format=%an", "--", f"skills/{d.name}")
        out.append(
            {
                "name": d.name,
                "description": meta.get("description", ""),
                "catalog_id": catalog.get(d.name),
                "commit_author": author.strip() or None,
            }
        )
    return out


def parse_skill_url(url: str) -> tuple[str, str, str]:
    """`https://github.com/<owner>/<repo>/tree/<ref>/<path>` → (owner/repo, path, ref)."""
    m = GITHUB_TREE.match(url.strip())
    if not m:
        raise ApiError(400, "invalid_request", "Liên kết GitHub không hợp lệ.")
    owner, repo, ref, path = m.groups()
    return f"{owner}/{repo}", path, ref


async def remove_skill(
    h: Any, conn: AsyncConnection, agent: Any, folder: Path, name: str, username: str
) -> str:
    if not SAFE_SKILL.match(name) or not (folder / "skills" / name).is_dir():
        raise ApiError(404, "not_found")
    shutil.rmtree(folder / "skills" / name)
    await gitops.commit_all(folder, author_of(username), f"remove skill {name}")
    await send_notice(h, conn, agent.id, "builder", f"Đã gỡ kỹ năng: {name}")
    return f"removed skills/{name}"


# --- packages -----------------------------------------------------------------------------


def dependencies(folder: Path) -> list[str]:
    try:
        data = tomllib.loads((folder / "pyproject.toml").read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError):
        return []
    deps = data.get("project", {}).get("dependencies", [])
    return [str(d) for d in deps] if isinstance(deps, list) else []


def package_name(spec: str) -> str:
    try:
        return Requirement(spec).name.lower()
    except InvalidRequirement:
        return re.split(r"[<>=!~\[ ;]", spec, maxsplit=1)[0].lower()


def list_packages(folder: Path) -> list[dict]:
    return [{"name": package_name(d), "spec": d} for d in dependencies(folder)]


def check_spec(spec: str) -> str:
    spec = spec.strip()
    try:
        Requirement(spec)
    except InvalidRequirement:
        raise ApiError(400, "invalid_package", f"Không phải PEP 508: {spec}") from None
    if spec.startswith("-") or "\n" in spec:
        raise ApiError(400, "invalid_package", f"Không phải PEP 508: {spec}")
    return spec


def package_change(before: list[str], after: list[str]) -> str:
    b = {package_name(d) for d in before}
    a = {package_name(d) for d in after}
    parts = [f"+{n}" for n in (package_name(d) for d in after) if n in a - b]
    parts += [f"-{n}" for n in (package_name(d) for d in before) if n in b - a]
    return ", ".join(dict.fromkeys(parts))


# --- routines -----------------------------------------------------------------------------


def routine_view(r: routines.Routine, row: Any | None) -> dict:
    now = datetime.now(UTC)
    iso = lambda v: v.isoformat() if v else None  # noqa: E731
    return {
        "name": r.name,
        "prompt": r.prompt,
        "cron": r.cron,
        "enabled": r.enabled,
        "next_fires": [d.isoformat() for d in routines.next_fires(r.cron, now)]
        if r.error is None and r.enabled
        else [],
        "last_started_at": iso(row.last_started_at) if row else None,
        "last_ended_at": iso(row.last_ended_at) if row else None,
        "error": r.error,
    }


async def list_routines(conn: AsyncConnection, agent: Any, folder: Path) -> list[dict]:
    rs = t.routine_state
    state = {
        r.name: r for r in (await conn.execute(select(rs).where(rs.c.agent_id == agent.id))).all()
    }
    return [routine_view(r, state.get(r.name)) for r in routines.read_all(folder)]


async def save_routine(
    h: Any,
    conn: AsyncConnection,
    agent: Any,
    folder: Path,
    name: str,
    prompt: str,
    cron: str,
    enabled: bool,
    username: str,
) -> dict:
    if not routines.NAME_RE.fullmatch(name):
        raise ApiError(400, "invalid_request", "Tên lịch phải khớp ^[a-z0-9-]{2,32}$.")
    if not routines.valid_cron(cron):
        raise ApiError(400, "invalid_cron", f"Biểu thức cron không hợp lệ: {cron}")
    if not prompt.strip():
        raise ApiError(400, "invalid_request", "Lịch cần có nội dung.")
    path = folder / "routines" / f"{name}.yaml"
    existed = path.exists()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        yaml.safe_dump(
            {"prompt": prompt, "cron": cron, "enabled": enabled},
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    await gitops.commit_all(folder, author_of(username), f"routine {name}")
    verb = "cập nhật" if existed else "tạo"
    await send_notice(h, conn, agent.id, "builder", f'Lịch "{name}" đã được {verb}: {cron}')
    await routines.sync(h, conn, agent)
    row = (
        await conn.execute(
            select(t.routine_state).where(
                t.routine_state.c.agent_id == agent.id, t.routine_state.c.name == name
            )
        )
    ).one_or_none()
    return routine_view(routines.parse(path), row)


async def delete_routine(
    h: Any, conn: AsyncConnection, agent: Any, folder: Path, name: str, username: str
) -> None:
    path = folder / "routines" / f"{name}.yaml"
    if not routines.NAME_RE.fullmatch(name) or not path.is_file():
        raise ApiError(404, "not_found")
    cron = routines.parse(path).cron
    path.unlink()
    await gitops.commit_all(folder, author_of(username), f"remove routine {name}")
    await send_notice(h, conn, agent.id, "builder", f'Lịch "{name}" đã được xóa: {cron}')
    await routines.sync(h, conn, agent)


# --- credential sets ----------------------------------------------------------------------


def _sidecar_keys(env_d: Path, name: str) -> list[str]:
    sidecar = env_d / f"{name}.env.keys"
    if not sidecar.is_file():
        return []
    return [
        line.strip() for line in sidecar.read_text(encoding="utf-8").splitlines() if line.strip()
    ]


def attached_sets(folder: Path) -> list[dict]:
    """Credential sets materialized into this agent's `.env.d/` — key names from the `.keys`
    sidecar `backend.domains.materialize.write_env_file` writes alongside each `<set>.env`."""
    env_d = folder / ".env.d"
    out = []
    if env_d.is_dir():
        for link in sorted(env_d.glob("*.env")):
            name = link.name.removesuffix(".env")
            out.append({"set": name, "keys": _sidecar_keys(env_d, name)})
    return out


async def save_credentials(
    h: Any,
    conn: AsyncConnection,
    agent: Any,
    folder: Path,
    domain_id: str | None,
    sets: list[str],
    available: list[str],
) -> list[dict]:
    from backend.domains import materialize

    unknown = [s for s in sets if s not in available]
    if unknown:
        raise ApiError(400, "unknown_credential_set", ", ".join(unknown))
    env_d = folder / ".env.d"
    current = (
        {p.name.removesuffix(".env") for p in env_d.glob("*.env")} if env_d.is_dir() else set()
    )
    wanted = set(sets)
    env_d.mkdir(exist_ok=True)
    changes = []
    for name in sorted(wanted - current):
        values = await materialize.materialize(conn, h.settings, domain_id or "", name, env_d)
        changes.append(f"+{name} ({', '.join(values)})")
    for name in sorted(current - wanted):
        changes.append(f"-{name} ({', '.join(_sidecar_keys(env_d, name))})")
        materialize.remove_env_file(env_d, name)
    if changes:
        await send_notice(
            h, conn, agent.id, "builder", "Quyền dữ liệu thay đổi: " + ", ".join(changes)
        )
    return attached_sets(folder)
