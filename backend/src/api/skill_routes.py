"""Discover and safely inspect native agent skills."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from src.agents.skills.registry import (
    SkillScopeError,
    get_skill,
    inspect_tool_bundle,
    list_skills,
)
from src.api.dependencies import RequestContext, require_permission
from src.services.permissions import PROFILE_READ

router = APIRouter(prefix="/agent-skills", tags=["agent-skills"])
_profile_read = Depends(require_permission(PROFILE_READ))


class SkillInspectionRequest(BaseModel):
    profile_run_id: str = Field(min_length=1, max_length=64)


def _public(skill: Any) -> dict[str, Any]:
    return {
        "name": skill.name,
        "version": skill.version,
        "description": skill.description,
        "mode": skill.mode,
        "required_permission": skill.required_permission,
        "tools": list(skill.tool_names),
        "api_operation": skill.api_operation,
    }


@router.get("")
async def list_agent_skills(
    context: RequestContext = _profile_read,
) -> list[dict[str, Any]]:
    """Return the versioned catalog without exposing implementation paths."""
    return [_public(skill) for skill in list_skills()]


@router.get("/{skill_name}")
async def get_agent_skill(
    skill_name: str, context: RequestContext = _profile_read
) -> dict[str, Any]:
    skill = get_skill(skill_name)
    if skill is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy native skill.")
    return _public(skill)


@router.post("/{skill_name}/inspect")
async def inspect_agent_skill(
    skill_name: str,
    payload: SkillInspectionRequest,
    context: RequestContext = _profile_read,
) -> dict[str, object]:
    """Execute a declared read-only tool bundle for a profile in this workspace."""
    try:
        return inspect_tool_bundle(
            skill_name,
            profile_run_id=payload.profile_run_id,
            workspace_id=context.workspace_id,
        )
    except KeyError as exc:
        raise HTTPException(
            status_code=404, detail="Không tìm thấy native skill."
        ) from exc
    except SkillScopeError as exc:
        raise HTTPException(
            status_code=404, detail="Không tìm thấy profile trong workspace."
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


__all__ = ["router"]
