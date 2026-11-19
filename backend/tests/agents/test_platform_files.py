"""The platform files every agent starts from (doc 04 "Platform skeleton", doc 06)."""

from __future__ import annotations

import tomllib

from backend.tests.agents.conftest import REPO

SKELETON = REPO / "platform" / "agent-skeleton"


def test_skeleton_has_the_documented_files():
    files = sorted(str(p.relative_to(SKELETON)) for p in SKELETON.rglob("*") if p.is_file())
    assert files == [
        ".gitignore",
        "files/.keep",
        "helpers/.keep",
        "memory/index.md",
        "prompts/context.md",
        "prompts/system.md",
        "pyproject.toml",
        "routines/.keep",
        "skills/.keep",
    ]
    assert (SKELETON / "prompts/context.md").read_text() == "# Context\n"
    assert (SKELETON / "memory/index.md").read_text() == "# Memory\n\n(no notes yet)\n"
    assert (SKELETON / "prompts/system.md").read_text() == ""


def test_skeleton_ignores_venv_outputs_and_credentials():
    ignored = (SKELETON / ".gitignore").read_text().split()
    assert {".venv/", ".contoso/outputs/", ".env.d/"} <= set(ignored)


def test_skeleton_pyproject():
    project = tomllib.loads((SKELETON / "pyproject.toml").read_text())["project"]
    assert project["name"] == "agent"
    assert project["requires-python"] == ">=3.12"
    assert project["dependencies"] == []


def test_rules_cover_the_documented_topics():
    rules = (REPO / "platform" / "rules.md").read_text()
    for needle in (
        "send_to_user",
        "send_to_agent",
        "final=True",
        ".env.d",
        "memory/preferences.md",
        "helpers/",
        "prompts/context.md",
        "routines",
    ):
        assert needle in rules
    # the lead section is last, so it can be cut for other agents
    assert rules.index("## Lead duties") > rules.index("## Hard rules")
    assert "end_task" in rules.split("## Lead duties")[1]


def test_rules_forbid_waiting_for_replies_inside_a_turn():
    """Messages are delivered as the next turn's input, never into the running one (runner
    `run_until_idle`), so every agent must end its turn instead of sleeping or polling."""
    rules = (REPO / "platform" / "rules.md").read_text()
    common, lead = rules.split("## Lead duties")
    assert "Messages reach you only at the start of a turn" in common
    assert "never `sleep`, loop, or re-check" in common
    assert "After you delegate, end your turn without `end_task`" in lead


def test_lead_prompt_exists():
    assert (REPO / "platform" / "lead" / "prompt.md").read_text().strip()
