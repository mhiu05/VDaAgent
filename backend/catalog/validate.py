"""Seed validation for the catalogs (doc 05 "Catalog", "Libraries").

Skills: a unique `id`, a unique `name` within the global rows plus one domain's rows,
`install_cmd` an argv starting `python -m contoso.skills` with a pinned `--ref` of 40 hex
characters. Presets: a unique `id` and a non-empty list of package strings.

Domain validation (doc 12 rule 5) uses these on `domains/<id>/seeds/*`; an error makes that
domain unavailable. The global seeds (`platform/seeds/*`) and "failure disables the
marketplace" are wired in S9 with the catalog upsert.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Any

SHA_RE = re.compile(r"^[0-9a-f]{40}$")
INSTALL_PREFIX = ["python", "-m", "contoso.skills"]


def _str(value: Any) -> bool:
    return isinstance(value, str) and value.strip() != ""


def _str_list(value: Any) -> bool:
    return isinstance(value, list) and all(_str(v) for v in value)


def validate_skill_rows(
    rows: list[Any], label: str, global_rows: Iterable[dict[str, Any]] = ()
) -> list[str]:
    """Reasons, one per failing row: `<label>: row <n>: <problem>` (1-based)."""
    reasons: list[str] = []
    seen_ids = {r.get("id") for r in global_rows if isinstance(r, dict)}
    seen_names = {r.get("name") for r in global_rows if isinstance(r, dict)}
    for n, row in enumerate(rows, 1):
        problem = _skill_problem(row, seen_ids, seen_names)
        if problem:
            reasons.append(f"{label}: row {n}: {problem}")
        if isinstance(row, dict):
            seen_ids.add(row.get("id"))
            seen_names.add(row.get("name"))
    return reasons


def _skill_problem(row: Any, seen_ids: set, seen_names: set) -> str | None:
    if not isinstance(row, dict) or not _str(row.get("id")):
        return "needs id"
    if not (_str(row.get("name")) and _str(row.get("title_vi")) and "install_cmd" in row):
        return "needs name, title_vi and install_cmd"
    if row["id"] in seen_ids:
        return f"duplicate id {row['id']}"
    if row["name"] in seen_names:
        return f"name {row['name']} is already used"
    cmd = row["install_cmd"]
    if not _str_list(cmd) or cmd[:3] != INSTALL_PREFIX:
        return "install_cmd must start with python -m contoso.skills"
    if "--ref" not in cmd or not SHA_RE.fullmatch(_after(cmd, "--ref")):
        return "--ref must be a 40-character commit sha"
    if "tags" in row and not (isinstance(row["tags"], list) and all(_str(x) for x in row["tags"])):
        return "tags must be a list of strings"
    return None


def _after(cmd: list[str], flag: str) -> str:
    i = cmd.index(flag)
    return cmd[i + 1] if i + 1 < len(cmd) else ""


def validate_preset_rows(rows: list[Any], label: str, global_ids: Iterable[str] = ()) -> list[str]:
    reasons: list[str] = []
    global_ids = set(global_ids)
    seen: set[str] = set()
    for n, row in enumerate(rows, 1):
        problem = None
        if not isinstance(row, dict) or not _str(row.get("id")):
            problem = "needs id"
        elif row["id"] in global_ids:
            problem = f"id {row['id']} is a global preset"
        elif row["id"] in seen:
            problem = f"duplicate id {row['id']}"
        elif not (_str_list(row.get("packages")) and row["packages"]):
            problem = "packages must be a non-empty list of strings"
        if problem:
            reasons.append(f"{label}: row {n}: {problem}")
        if isinstance(row, dict) and _str(row.get("id")):
            seen.add(row["id"])
    return reasons
