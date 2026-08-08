"""Contract tests for the bounded, read-only agent tool dispatcher."""

from __future__ import annotations

from src.agents.tools.registry import READ_ONLY_QA_TOOLS, run_tool


def test_tool_catalog_is_read_only() -> None:
    names = {item.name for item in READ_ONLY_QA_TOOLS}
    assert "calculate" not in names
    assert {
        "get_profile_overview",
        "get_column_profile",
        "list_quality_issues",
    } <= names


def test_tool_envelope_case_insensitive_and_pagination(profile_run: dict) -> None:
    run_id = profile_run["profile_run_id"]
    result = run_tool("get_column_profile", {"column_name": "SALARY"}, run_id)

    assert result["tool"] == "get_column_profile"
    assert result["profile_run_id"] == run_id
    assert result["data"]["column_name"] == "salary"
    assert result["evidence"]
    assert "id" not in result["data"]

    page = run_tool("list_columns", {"limit": 2, "cursor": 0}, run_id)
    assert len(page["data"]["columns"]) == 2
    assert page["page"]["next_cursor"] == 2


def test_pii_distribution_and_cross_run_are_fail_closed(profile_run: dict) -> None:
    run_id = profile_run["profile_run_id"]
    pii = run_tool("get_distribution", {"column_name": "email"}, run_id)
    assert pii["error_code"] == "forbidden_scope"

    missing = run_tool("get_profile_overview", {}, "does-not-exist")
    assert missing["error_code"] == "not_found"
