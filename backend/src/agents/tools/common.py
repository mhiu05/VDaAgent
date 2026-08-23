"""Shared helpers for the domain-specific read-only agent tools."""

from __future__ import annotations

import difflib
from typing import Any

from src.agents.tools.context import current_run_id
from src.agents.tools.schemas import DEFAULT_LIMIT, MAX_LIMIT
from src.services.repository import get_repository

_PRIVATE = {
    "id",
    "profile_run_id",
    "dataset_id",
    "source_ref",
    "executed_query",
    "confirmed_by",
    "requested_by",
    "confirmed_at",
}


def clean(value: Any) -> Any:
    """Remove internal identities and recursively make DB payloads safe."""
    if isinstance(value, dict):
        return {
            str(key): clean(item)
            for key, item in value.items()
            if key not in _PRIVATE and not str(key).startswith("_")
        }
    if isinstance(value, list):
        return [clean(item) for item in value]
    return value


def active_run(tool_name: str) -> tuple[str, dict[str, Any] | None]:
    """Return the dispatcher-injected run and its repository record."""
    run_id = current_run_id()
    return run_id, get_repository().get_profile_run(run_id)


def get_column_suggestions(stats: dict[str, dict[str, Any]], name: str, n: int = 3) -> list[str]:
    """Find close column name matches using substring and fuzzy matching."""
    if not stats or not name:
        return []
    candidates = list(stats.keys())
    target = name.strip().casefold()
    if not target:
        return candidates[:n]

    matched: list[str] = []
    # 1. Substring matches (e.g., 'email' matches 'email_address' or vice versa)
    for c in candidates:
        if target in c.casefold() or c.casefold() in target:
            matched.append(c)

    # 2. Fuzzy matches
    fuzzy = difflib.get_close_matches(target, [c.casefold() for c in candidates], n=n, cutoff=0.3)
    for f in fuzzy:
        for c in candidates:
            if c.casefold() == f and c not in matched:
                matched.append(c)

    return matched[:n]


def error(
    tool_name: str,
    code: str,
    message: str,
    *,
    suggestions: list[str] | None = None,
    self_correction_guidance: str | None = None,
) -> dict[str, Any]:
    """Build the stable machine-readable error envelope."""
    payload: dict[str, Any] = {
        "tool": tool_name,
        "profile_run_id": current_run_id(),
        "data": None,
        "evidence": [],
        "is_approximate": False,
        "limitations": [],
        "error_code": code,
        "error": message,
    }
    if suggestions:
        payload["suggestions"] = suggestions
    if self_correction_guidance:
        payload["self_correction_guidance"] = self_correction_guidance
    return payload


def ok(
    tool_name: str,
    run_id: str,
    run: dict[str, Any],
    data: Any,
    *,
    artifact: str,
    limitations: list[str] | None = None,
    page: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the stable machine-readable success envelope."""
    result: dict[str, Any] = {
        "tool": tool_name,
        "profile_run_id": run_id,
        "data": clean(data),
        "evidence": [{"artifact": artifact, "run_version": run.get("version")}],
        "is_approximate": bool(run.get("is_approximate")),
        "limitations": limitations or [],
    }
    if page is not None:
        result["page"] = page
    return result


def page(items: list[Any], limit: int, cursor: int) -> tuple[list[Any], dict[str, Any]]:
    """Apply bounded cursor pagination to a list of aggregate results."""
    bounded_limit = max(1, min(int(limit), MAX_LIMIT))
    bounded_cursor = max(0, int(cursor))
    selected = items[bounded_cursor : bounded_cursor + bounded_limit]
    next_cursor = (
        bounded_cursor + bounded_limit
        if bounded_cursor + bounded_limit < len(items)
        else None
    )
    return selected, {
        "limit": bounded_limit,
        "cursor": bounded_cursor,
        "next_cursor": next_cursor,
        "total": len(items),
    }


def resolve_column(
    stats: dict[str, dict[str, Any]], name: str
) -> tuple[str, dict[str, Any]] | None:
    """Resolve a column name case-insensitively."""
    target = name.casefold()
    for canonical, stat in stats.items():
        if canonical.casefold() == target:
            return canonical, stat
    return None


def column_stats(run_id: str) -> dict[str, dict[str, Any]]:
    return get_repository().get_column_stats(run_id)


__all__ = [
    "DEFAULT_LIMIT",
    "MAX_LIMIT",
    "active_run",
    "column_stats",
    "error",
    "get_column_suggestions",
    "ok",
    "page",
    "resolve_column",
]
