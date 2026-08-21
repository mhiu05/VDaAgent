"""Versioned prompt identifiers used for provenance, without serving raw text."""

from __future__ import annotations

from dataclasses import dataclass

from src.agents import prompts
from src.agents.runtime.versioning import stable_hash


@dataclass(frozen=True, slots=True)
class PromptSpec:
    id: str
    version: str
    template_hash: str
    output_schema_version: str


_TEMPLATES = {
    "chart_planner": prompts.CHART_PLANNER_PROMPT,
    "qa_router": prompts.QA_ROUTER_PROMPT,
    "qa_clarify": prompts.CLARIFY_PROMPT,
    "qa_structured": prompts.QA_STRUCTURED_PROMPT,
    "qa_vector": prompts.QA_VECTOR_PROMPT,
    "profile_summary": prompts.SUMMARIZE_PROMPT,
    "profile_metadata": prompts.SEMANTIC_TYPE_REFINE_PROMPT,
}


def get_prompt_spec(prompt_id: str) -> PromptSpec:
    template = _TEMPLATES.get(prompt_id, "")
    return PromptSpec(
        id=prompt_id,
        version="1",
        template_hash=stable_hash(template),
        output_schema_version="1",
    )


__all__ = ["PromptSpec", "get_prompt_spec"]
