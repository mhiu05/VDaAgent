"""Rendering the context (doc 06). This part: the system prompt, rendered once per epoch.

```text
<platform_rules>  platform/rules.md (the "Lead duties" section only for the lead)
<role>            prompts/system.md
<context>         prompts/context.md
<memory_index>    memory/index.md
<skills>          "- <name>: <description>  (skills/<dir>/SKILL.md)" per skill
<environment>     folder, Python version, credential key names per set, packages
```

Nothing here reads credential values: key names come from the `.keys` sidecar
`backend.domains.materialize` writes next to each materialized `.env.d/<set>.env`.
"""

from __future__ import annotations

import json
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

LEAD_SECTION = "## Lead duties"


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


def platform_rules(platform_dir: Path, *, is_lead: bool) -> str:
    rules = _read(platform_dir / "rules.md")
    if is_lead or LEAD_SECTION not in rules:
        return rules.strip()
    before, _, after = rules.partition(LEAD_SECTION)
    # drop the lead section up to the next level-2 heading (it is the last one today)
    rest = after.split("\n## ", 1)
    tail = "\n## " + rest[1] if len(rest) == 2 else ""
    return (before + tail).strip()


def frontmatter(text: str) -> dict[str, str]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}
    meta: dict[str, str] = {}
    for line in lines[1:]:
        if line.strip() == "---":
            return meta
        if ":" in line and not line.startswith((" ", "\t", "#")):
            key, value = line.split(":", 1)
            meta[key.strip()] = value.strip().strip("'\"")
    return {}


def skills_lines(folder: Path) -> list[str]:
    root = folder / "skills"
    lines = []
    if root.is_dir():
        for d in sorted(p for p in root.iterdir() if p.is_dir() and not p.name.startswith(".")):
            meta = frontmatter(_read(d / "SKILL.md"))
            if meta.get("name") and meta.get("description"):
                lines.append(f"- {meta['name']}: {meta['description']}  (skills/{d.name}/SKILL.md)")
    return lines


def env_key_names(example: Path) -> list[str]:
    keys = []
    for line in _read(example).splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            keys.append(line.split("=", 1)[0].removeprefix("export ").strip())
    return keys


def credential_sets(folder: Path) -> dict[str, list[str]]:
    """Attached sets → key names, from `.env.d/<set>.env` and its `.env.keys` sidecar (written
    alongside it by `backend.domains.materialize`, never the symlink target it used to be)."""
    env_d = folder / ".env.d"
    sets: dict[str, list[str]] = {}
    if env_d.is_dir():
        for link in sorted(env_d.glob("*.env")):
            name = link.name.removesuffix(".env")
            sidecar = env_d / f"{name}.env.keys"
            keys = [k for k in _read(sidecar).splitlines() if k.strip()]
            sets[name] = keys if keys else env_key_names(link)
    return sets


def python_version(folder: Path) -> str:
    for line in _read(folder / ".venv" / "pyvenv.cfg").splitlines():
        key, _, value = line.partition("=")
        if key.strip() in ("version_info", "version"):
            return ".".join(value.strip().split(".")[:2])
    return "3.12"


def packages(folder: Path) -> list[str]:
    try:
        data = tomllib.loads(_read(folder / "pyproject.toml"))
    except tomllib.TOMLDecodeError:
        return []
    deps = data.get("project", {}).get("dependencies", [])
    return [str(d) for d in deps] if isinstance(deps, list) else []


def environment(folder: Path) -> str:
    sets = credential_sets(folder)
    pkgs = packages(folder)
    lines = [f"folder: {folder}", f"python: Python {python_version(folder)}"]
    if sets:
        lines.append("credentials (environment variables; never print their values):")
        lines += [f"  {name}: {', '.join(keys) or '(no keys)'}" for name, keys in sets.items()]
    else:
        lines.append("credentials: none")
    lines.append(f"packages: {', '.join(pkgs) if pkgs else 'none'}")
    return "\n".join(lines)


def _section(tag: str, body: str) -> str:
    return f"<{tag}>\n{body.strip() or '(none)'}\n</{tag}>"


def data_dictionary(domains_dir: Path | None, domain_id: str | None) -> str:
    """Domain data dictionary (seeds/data-dictionary.md), if the domain ships one. Always-on:
    not gated by the Semantic Explanation Mode preference (see platform docs decision)."""
    if not domains_dir or not domain_id:
        return ""
    return _read(Path(domains_dir) / domain_id / "seeds" / "data-dictionary.md").strip()


def semantic_explanation_block(platform_dir: Path) -> str:
    """Seed glossary + the admin-curated additions file, concatenated. Agents never write
    either one: they live in the platform directory, outside every agent's sandbox."""
    seed = _read(platform_dir / "seeds" / "semantic-explanation.md").strip()
    additions = _read(platform_dir / "seeds" / "semantic-explanation-additions.md").strip()
    if additions:
        heading = "## Thuật ngữ bổ sung (do quản trị viên duy trì)"
        return f"{seed}\n\n{heading}\n\n{additions}"
    return seed


def render_system_prompt(
    folder: Path,
    *,
    is_lead: bool,
    platform_dir: Path,
    semantic_explanation: bool = False,
    domains_dir: Path | None = None,
    domain_id: str | None = None,
    group_room: bool = False,
) -> str:
    folder, platform_dir = Path(folder), Path(platform_dir)
    parts = [
        _section("platform_rules", platform_rules(platform_dir, is_lead=is_lead)),
        _section("role", _read(folder / "prompts" / "system.md")),
        _section("context", _read(folder / "prompts" / "context.md")),
        _section("memory_index", _read(folder / "memory" / "index.md")),
        _section("skills", "\n".join(skills_lines(folder))),
        _section("environment", environment(folder)),
    ]
    dd = data_dictionary(domains_dir, domain_id)
    if dd:
        parts.append(_section("data_dictionary", dd))
    if semantic_explanation:
        parts.append(_section("semantic_explanation", semantic_explanation_block(platform_dir)))
    if group_room:
        parts.append(_section("group_context", _read(platform_dir / "group.md")))
    return "\n\n".join(parts) + "\n"


# --- events → messages (doc 06 "Rendering") --------------------------------------------------

EPHEMERAL = {"type": "ephemeral"}


@dataclass(frozen=True)
class Event:
    seq: int
    kind: str
    payload: dict[str, Any]


def error_text(code: str, text: str) -> str:
    return f'<error code="{code}">{text}</error>'


def event_message(event: Event) -> dict[str, Any]:
    p = event.payload
    if event.kind == "input":
        return {"role": "user", "content": p["text"]}
    if event.kind == "assistant":
        msg: dict[str, Any] = {"role": "assistant", "content": p.get("text")}
        calls = p.get("tool_calls") or []
        if calls:

            def arguments(call: dict[str, Any]) -> str:
                raw = call.get("arguments")
                if isinstance(raw, str):
                    return raw
                if isinstance(raw, dict):
                    return json.dumps(raw)
                return json.dumps({"code": call.get("code", "")})

            msg["tool_calls"] = [
                {
                    "id": c["id"],
                    "type": "function",
                    "function": {
                        "name": c.get("name") or "python",
                        "arguments": arguments(c),
                    },
                }
                for c in calls
            ]
        return msg
    if event.kind == "tool_result":
        return {"role": "tool", "tool_call_id": p["tool_call_id"], "content": p["text"]}
    if event.kind == "error":
        return {"role": "user", "content": error_text(p.get("code", "error"), p.get("text", ""))}
    raise ValueError(f"unknown event kind {event.kind}")


def _mark(message: dict[str, Any]) -> bool:
    """Put an ephemeral cache breakpoint on a message's text; False if it has none."""
    content = message.get("content")
    if not isinstance(content, str) or content == "":
        return False
    message["content"] = [{"type": "text", "text": content, "cache_control": dict(EPHEMERAL)}]
    return True


def render_messages(
    system_prompt: str, summary: str, events: list[Event], *, model: str
) -> list[dict[str, Any]]:
    """The context of doc 06: system prompt, summary, then every event in seq order.

    Stored texts are used as they are, so an earlier prefix is byte-identical after appends.
    The output is provider-neutral. Provider-specific request transforms belong in the model
    adapter, never in event rendering.
    """
    messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
    if summary:
        messages.append({"role": "user", "content": f"<summary>\n{summary}\n</summary>"})
    messages.extend(event_message(e) for e in sorted(events, key=lambda e: e.seq))
    return messages
