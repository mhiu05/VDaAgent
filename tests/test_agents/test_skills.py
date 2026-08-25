"""Tests for the native skill catalog and its safe tool bindings."""

from __future__ import annotations

from src.agents.skills.registry import list_skills, select_skill_for_question


def test_native_skill_catalog_has_versioned_bounded_workflows() -> None:
    skills = {skill.name: skill for skill in list_skills()}

    assert set(skills) == {
        "profile-dataset",
        "diagnose-data-quality",
        "compare-profile-drift",
        "answer-business-question",
        "generate-report",
        "calendar-assistant",
    }
    assert "get_profile_readiness" in skills["diagnose-data-quality"].tool_names
    assert skills["compare-profile-drift"].tool_names == (
        "get_drift_summary",
        "get_drift_findings",
        "get_schema_diff",
    )
    assert skills["generate-report"].api_operation


def test_skill_selection_is_deterministic() -> None:
    assert (
        select_skill_for_question("Dữ liệu bị thay đổi thế nào so với kỳ trước?")
        == "compare-profile-drift"
    )
    assert (
        select_skill_for_question("Có những lỗi chất lượng và null nào?")
        == "diagnose-data-quality"
    )
    assert select_skill_for_question("Tạo báo cáo PDF") == "generate-report"
