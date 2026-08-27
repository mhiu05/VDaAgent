"""Typed playbooks and bounded tool bindings for native skills."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from src.agents.tools.registry import run_tool
from src.services.repository import get_repository

SkillMode = Literal["api_workflow", "tool_bundle"]


@dataclass(frozen=True, slots=True)
class NativeSkill:
    name: str
    version: str
    description: str
    mode: SkillMode
    required_permission: str
    tool_names: tuple[str, ...] = ()
    api_operation: str | None = None


_SKILLS = (
    NativeSkill(
        "profile-dataset",
        "1.0.0",
        "Run deterministic profiling for an uploaded dataset.",
        "api_workflow",
        "profile.run",
        api_operation="POST /api/v1/profile",
    ),
    NativeSkill(
        "diagnose-data-quality",
        "1.0.0",
        "Inspect deterministic quality and governance evidence for one profile.",
        "tool_bundle",
        "profile.read",
        (
            "get_profile_readiness",
            "get_profile_overview",
            "list_quality_issues",
            "get_missingness_patterns",
            "get_duplicate_analysis",
            "get_governance_summary",
        ),
    ),
    NativeSkill(
        "compare-profile-drift",
        "1.0.0",
        "Inspect persisted drift evidence for compatible profile runs.",
        "tool_bundle",
        "profile.read",
        ("get_drift_summary", "get_drift_findings", "get_schema_diff"),
    ),
    NativeSkill(
        "answer-business-question",
        "1.0.0",
        "Answer from bounded profile evidence and retrieval.",
        "api_workflow",
        "qa.profile.ask",
        api_operation="POST /api/v1/qa",
    ),
    NativeSkill(
        "generate-report",
        "1.0.0",
        "Create a privacy-safe report from selected verified sections.",
        "api_workflow",
        "report.draft.write",
        api_operation="POST /api/v1/profile/{profile_run_id}/report",
    ),
)
_BY_NAME = {skill.name: skill for skill in _SKILLS}


class SkillScopeError(ValueError):
    """A requested resource is outside the active workspace."""


def list_skills() -> tuple[NativeSkill, ...]:
    return _SKILLS


def get_skill(name: str) -> NativeSkill | None:
    return _BY_NAME.get(name)


def skill_guidance(name: str | None) -> str:
    skill = get_skill(name or "")
    if not skill:
        return ""
    tools = ", ".join(skill.tool_names) or "the declared API workflow"
    return f"Use skill {skill.name} v{skill.version}: {skill.description} Use only {tools}."


def select_skill_for_question(question: str) -> str:
    text = question.casefold()
    if any(word in text for word in ("drift", "thay đổi", "biến động", "so sánh")):
        return "compare-profile-drift"
    if any(
        word in text
        for word in ("chất lượng", "quality", "thiếu", "null", "outlier", "trùng lặp")
    ):
        return "diagnose-data-quality"
    if any(word in text for word in ("báo cáo", "report", "xuất pdf", "export")):
        return "generate-report"
    if any(
        word in text for word in ("profile", "hồ sơ", "quét dữ liệu", "scan dữ liệu")
    ):
        return "profile-dataset"
    return "answer-business-question"


def inspect_tool_bundle(
    skill_name: str, *, profile_run_id: str, workspace_id: str
) -> dict[str, object]:
    skill = get_skill(skill_name)
    if skill is None:
        raise KeyError(skill_name)
    if skill.mode != "tool_bundle":
        raise ValueError(
            f"Skill '{skill_name}' must be invoked through {skill.api_operation}."
        )
    if not get_repository().get_profile_run(profile_run_id, workspace_id=workspace_id):
        raise SkillScopeError("Profile run was not found in the active workspace.")
    args = {
        "list_quality_issues": {"limit": 50},
        "get_missingness_patterns": {"limit": 50},
        "get_drift_findings": {"limit": 50},
    }
    return {
        "skill": skill.name,
        "version": skill.version,
        "profile_run_id": profile_run_id,
        "results": [
            run_tool(tool, args.get(tool, {}), profile_run_id)
            for tool in skill.tool_names
        ],
    }


__all__ = [
    "NativeSkill",
    "SkillScopeError",
    "get_skill",
    "inspect_tool_bundle",
    "list_skills",
    "select_skill_for_question",
    "skill_guidance",
]
