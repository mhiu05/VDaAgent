"""Privacy-safe governance tools exposed to the QA agent."""

from __future__ import annotations

from typing import Any

from langchain_core.tools import tool
from src.agents.tools.common import DEFAULT_LIMIT, active_run, clean, error, ok, page
from src.services.repository import get_repository


def _proposals(
    kind: str,
    status: str = "",
    column_name: str = "",
    limit: int = DEFAULT_LIMIT,
    cursor: int = 0,
) -> dict[str, Any]:
    run_id, run = active_run("proposals")
    if not run:
        return error("get_proposals", "not_found", "Active profile run was not found.")
    if kind not in {"candidate_key", "semantic_type", "pii"}:
        return error("get_proposals", "invalid_argument", "Invalid proposal kind.")
    rows = get_repository().get_proposals(run_id, kind=kind, status=status or None)[
        kind
    ]
    if column_name:
        rows = [
            item
            for item in rows
            if str(item.get("column_name", "")).casefold() == column_name.casefold()
            or column_name.casefold()
            in [str(value).casefold() for value in item.get("columns", [])]
        ]
    selected, pagination = page(rows, limit, cursor)
    return ok(
        "get_" + kind + "s",
        run_id,
        run,
        {kind: selected},
        artifact=kind + "_proposals",
        page=pagination,
    )


@tool
def get_candidate_keys(
    status: str = "", limit: int = DEFAULT_LIMIT, cursor: int = 0
) -> dict[str, Any]:
    """List candidate-key proposals and aggregate evidence."""
    result = _proposals("candidate_key", status=status, limit=limit, cursor=cursor)
    result["tool"] = "get_candidate_keys"
    return result


@tool
def get_semantic_types(
    column_name: str = "",
    status: str = "",
    limit: int = DEFAULT_LIMIT,
    cursor: int = 0,
) -> dict[str, Any]:
    """List semantic-type proposals."""
    result = _proposals(
        "semantic_type",
        status=status,
        column_name=column_name,
        limit=limit,
        cursor=cursor,
    )
    result["tool"] = "get_semantic_types"
    return result


@tool
def get_pii_assessment(
    column_name: str = "",
    status: str = "",
    limit: int = DEFAULT_LIMIT,
    cursor: int = 0,
) -> dict[str, Any]:
    """List PII assessment metadata without matched values."""
    result = _proposals(
        "pii",
        status=status,
        column_name=column_name,
        limit=limit,
        cursor=cursor,
    )
    result["tool"] = "get_pii_assessment"
    return result


@tool
def get_proposals(
    kind: str = "all",
    status: str = "",
    column_name: str = "",
    limit: int = DEFAULT_LIMIT,
    cursor: int = 0,
) -> dict[str, Any]:
    """Deprecated general proposal lookup; use governance-specific tools."""
    if kind != "all":
        return _proposals(kind, status, column_name, limit, cursor)
    run_id, run = active_run("get_proposals")
    if not run:
        return error("get_proposals", "not_found", "Active profile run was not found.")
    data = clean(get_repository().get_proposals(run_id, status=status or None))
    return ok(
        "get_proposals",
        run_id,
        run,
        data,
        artifact="proposals",
        limitations=["Deprecated: use a domain-specific governance tool."],
    )


@tool
def get_governance_summary() -> dict[str, Any]:
    """Summarize PII, quasi-identifiers, and candidate keys."""
    run_id, run = active_run("get_governance_summary")
    if not run:
        return error(
            "get_governance_summary", "not_found", "Active profile run was not found."
        )
    proposals = get_repository().get_proposals(run_id)
    return ok(
        "get_governance_summary",
        run_id,
        run,
        {
            "pii_count": len(proposals["pii"]),
            "candidate_key_count": len(proposals["candidate_key"]),
            "semantic_type_count": len(proposals["semantic_type"]),
            "quasi_identifier_count": len(run.get("quasi_identifiers") or []),
        },
        artifact="proposals",
    )


@tool
def get_risk_warnings() -> dict[str, Any]:
    """Return persisted safe risk-warning narratives."""
    run_id, run = active_run("get_risk_warnings")
    if not run:
        return error(
            "get_risk_warnings", "not_found", "Active profile run was not found."
        )
    return ok(
        "get_risk_warnings",
        run_id,
        run,
        {
            "risk_warnings": run.get("risk_warnings") or [],
            "quasi_identifiers": run.get("quasi_identifiers") or [],
        },
        artifact="profile_runs",
    )


GOVERNANCE_TOOLS = [
    get_candidate_keys,
    get_semantic_types,
    get_pii_assessment,
    get_governance_summary,
    get_risk_warnings,
    # V1 compatibility alias.
    get_proposals,
]

__all__ = [
    "GOVERNANCE_TOOLS",
    "get_candidate_keys",
    "get_governance_summary",
    "get_pii_assessment",
    "get_proposals",
    "get_risk_warnings",
    "get_semantic_types",
]
