"""Privacy-safe governance tools exposed to the QA agent."""

from __future__ import annotations

import unicodedata
from typing import Any

from langchain_core.tools import tool
from src.agents.tools.common import DEFAULT_LIMIT, active_run, clean, error, ok, page
from src.services.repository import get_repository


def _plain(value: str) -> str:
    value = value.replace("đ", "d").replace("Đ", "D")
    normalized = unicodedata.normalize("NFD", value.casefold())
    return "".join(
        char for char in normalized if unicodedata.category(char) != "Mn"
    ).replace("-", "_")


def _quasi_identifier_role(column_name: str) -> str | None:
    """Classify common indirect identifiers without reading raw values."""

    normalized = _plain(column_name)
    markers = (
        "postal",
        "zip_code",
        "buu_chinh",
        "birth_year",
        "year_of_birth",
        "nam_sinh",
        "date_of_birth",
        "ngay_sinh",
    )
    return "quasi_identifier" if any(marker in normalized for marker in markers) else None


def _semantic_role(
    proposal: dict[str, Any], pii_type: str | None = None
) -> str:
    """Expose a privacy-safe business role alongside the statistical type."""

    direct_roles = {
        "email": "email",
        "full_name": "name",
        "phone": "phone",
        "phone_number": "phone",
    }
    if pii_type and pii_type.casefold() in direct_roles:
        return direct_roles[pii_type.casefold()]
    column_name = str(proposal.get("column_name") or "")
    quasi_role = _quasi_identifier_role(column_name)
    if quasi_role:
        return quasi_role
    proposed = str(
        proposal.get("final_type") or proposal.get("proposed_type") or "unknown"
    )
    if proposed.casefold() == "id":
        # Aggregate uniqueness establishes an identifier-like field, but a
        # data dictionary is still required to disambiguate its business role.
        return "identifier (ID); business role ambiguous"
    return proposed


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
    rows = (result.get("data") or {}).get("semantic_type")
    if isinstance(rows, list):
        pii_rows = get_repository().get_proposals(
            str(result.get("profile_run_id") or ""), kind="pii"
        ).get("pii", [])
        pii_by_column = {
            str(item.get("column_name") or "").casefold(): str(
                item.get("final_type") or item.get("pii_type") or ""
            )
            for item in pii_rows
            if isinstance(item, dict)
        }
        for item in rows:
            if not isinstance(item, dict):
                continue
            pii_type = pii_by_column.get(str(item.get("column_name") or "").casefold())
            item["semantic_role"] = _semantic_role(item, pii_type)
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
    rows = (result.get("data") or {}).get("pii")
    quasi_role = _quasi_identifier_role(column_name) if column_name else None
    if isinstance(rows, list) and not rows and quasi_role:
        rows.append(
            {
                "column_name": column_name,
                "pii_type": quasi_role,
                "confidence_score": 0.8,
                "detection_method": "aggregate_metadata_policy",
                "evidence": (
                    "Tên cột khớp nhóm định danh gián tiếp; không đọc hoặc trả về giá trị thô."
                ),
                "status": "derived",
            }
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
