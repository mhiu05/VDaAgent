"""`render_system_prompt` (doc 06 "System prompt")."""

from __future__ import annotations

import os
import shutil

from backend.harness.render import render_system_prompt
from backend.tests.agents.conftest import REPO


def make_folder(tmp_path, dirs):
    folder = tmp_path / "folders" / "u" / "data"
    shutil.copytree(REPO / "platform" / "agent-skeleton", folder)
    (folder / "prompts" / "system.md").write_text("Bạn là Data.\n")
    (folder / "prompts" / "context.md").write_text("# Context\nKho: cdw\n")
    (folder / "memory" / "index.md").write_text("# Memory\n- preferences.md: ưu tiên\n")
    sk = folder / "skills" / "xlsx"
    sk.mkdir()
    (sk / "SKILL.md").write_text("---\nname: xlsx\ndescription: Đọc và ghi Excel\n---\nbody\n")
    sk2 = folder / "skills" / "bang-gia"
    sk2.mkdir()
    (sk2 / "SKILL.md").write_text("---\nname: bang-gia\ndescription: Lấy bảng giá\n---\n")
    (folder / "skills" / "broken").mkdir()  # no SKILL.md: not listed
    env_d = folder / ".env.d"
    env_d.mkdir()
    os.symlink(
        dirs["domains"] / "fabrikam" / "credentials" / "warehouse.env", env_d / "warehouse.env"
    )
    (folder / "pyproject.toml").write_text(
        '[project]\nname = "agent"\nversion = "0.1.0"\nrequires-python = ">=3.12"\n'
        'dependencies = ["pandas>=2.2", "pyarrow"]\n'
    )
    return folder


def test_layers_in_order(tmp_path, dirs):
    folder = make_folder(tmp_path, dirs)
    prompt = render_system_prompt(folder, is_lead=False, platform_dir=dirs["platform"])
    tags = [
        "<platform_rules>",
        "<role>",
        "<context>",
        "<memory_index>",
        "<skills>",
        "<environment>",
    ]
    positions = [prompt.index(t) for t in tags]
    assert positions == sorted(positions)
    assert "Bạn là Data." in prompt.split("<role>")[1].split("</role>")[0]
    assert "Kho: cdw" in prompt
    assert "preferences.md: ưu tiên" in prompt


def test_group_context_only_for_service_owner(tmp_path, dirs):
    folder = make_folder(tmp_path, dirs)
    personal = render_system_prompt(folder, is_lead=True, platform_dir=dirs["platform"])
    group = render_system_prompt(
        folder, is_lead=True, platform_dir=dirs["platform"], group_room=True
    )
    assert "<group_context>" not in personal
    assert "<group_context>" in group
    assert "user:<username>" in group
    assert "private chats" in group


def test_lead_duties_only_for_the_lead(tmp_path, dirs):
    folder = make_folder(tmp_path, dirs)
    other = render_system_prompt(folder, is_lead=False, platform_dir=dirs["platform"])
    lead = render_system_prompt(folder, is_lead=True, platform_dir=dirs["platform"])
    assert "## Lead duties" not in other
    assert "## Lead duties" in lead
    assert "## Hard rules" in other


def test_skills_list_one_line_each(tmp_path, dirs):
    folder = make_folder(tmp_path, dirs)
    prompt = render_system_prompt(folder, is_lead=False, platform_dir=dirs["platform"])
    skills = prompt.split("<skills>")[1].split("</skills>")[0].strip().splitlines()
    assert skills == [
        "- bang-gia: Lấy bảng giá  (skills/bang-gia/SKILL.md)",
        "- xlsx: Đọc và ghi Excel  (skills/xlsx/SKILL.md)",
    ]


def test_environment_lists_key_names_never_values(tmp_path, dirs):
    folder = make_folder(tmp_path, dirs)
    prompt = render_system_prompt(folder, is_lead=False, platform_dir=dirs["platform"])
    env = prompt.split("<environment>")[1].split("</environment>")[0]
    assert str(folder) in env
    assert "Python 3.12" in env
    assert "warehouse: WAREHOUSE_DSN, WAREHOUSE_SNAPSHOT_ID" in env
    assert "pandas>=2.2" in env and "pyarrow" in env
    assert "secret" not in prompt


def test_rendering_is_deterministic(tmp_path, dirs):
    folder = make_folder(tmp_path, dirs)
    a = render_system_prompt(folder, is_lead=True, platform_dir=dirs["platform"])
    b = render_system_prompt(folder, is_lead=True, platform_dir=dirs["platform"])
    assert a == b


def test_empty_sections_still_render(tmp_path, dirs):
    folder = tmp_path / "bare"
    shutil.copytree(REPO / "platform" / "agent-skeleton", folder)
    prompt = render_system_prompt(folder, is_lead=False, platform_dir=dirs["platform"])
    assert "<skills>\n(none)\n</skills>" in prompt
    assert "credentials: none" in prompt


def test_semantic_explanation_off_by_default(tmp_path, dirs):
    folder = make_folder(tmp_path, dirs)
    default = render_system_prompt(folder, is_lead=False, platform_dir=dirs["platform"])
    off = render_system_prompt(
        folder, is_lead=False, platform_dir=dirs["platform"], semantic_explanation=False
    )
    assert default == off
    assert "<semantic_explanation>" not in default


def test_semantic_explanation_on_adds_glossary_section(tmp_path, dirs):
    folder = make_folder(tmp_path, dirs)
    prompt = render_system_prompt(
        folder, is_lead=False, platform_dir=dirs["platform"], semantic_explanation=True
    )
    section = prompt.split("<semantic_explanation>")[1].split("</semantic_explanation>")[0]
    assert "Diễn giải ngữ nghĩa" in section
    assert "Peer / peer group" in section
    assert "AVAILABLE / BOOKED / SOLD" in section


def test_semantic_explanation_additions_are_appended(tmp_path, dirs):
    platform_dir = tmp_path / "platform-copy"
    shutil.copytree(dirs["platform"], platform_dir)
    (platform_dir / "seeds" / "semantic-explanation-additions.md").write_text(
        "- **lưu lượng** — một thuật ngữ bổ sung do quản trị viên thêm\n", encoding="utf-8"
    )
    folder = make_folder(tmp_path, dirs)
    prompt = render_system_prompt(
        folder, is_lead=False, platform_dir=platform_dir, semantic_explanation=True
    )
    section = prompt.split("<semantic_explanation>")[1].split("</semantic_explanation>")[0]
    assert "lưu lượng" in section
    assert "một thuật ngữ bổ sung do quản trị viên thêm" in section


def test_data_dictionary_included_when_domain_has_one(tmp_path, dirs):
    folder = make_folder(tmp_path, dirs)
    seeds = dirs["domains"] / "fabrikam" / "seeds"
    seeds.mkdir(parents=True)
    (seeds / "data-dictionary.md").write_text("inventory_status: AVAILABLE/BOOKED/SOLD\n")
    with_dd = render_system_prompt(
        folder,
        is_lead=False,
        platform_dir=dirs["platform"],
        domains_dir=dirs["domains"],
        domain_id="fabrikam",
    )
    assert "<data_dictionary>" in with_dd
    assert "inventory_status: AVAILABLE/BOOKED/SOLD" in with_dd
    without_dd = render_system_prompt(folder, is_lead=False, platform_dir=dirs["platform"])
    assert "<data_dictionary>" not in without_dd


def test_the_glossary_never_asks_agents_to_write_shared_files(tmp_path, dirs):
    """Agents run in a per-folder sandbox (doc 11): a shared, self-written glossary would be a
    cross-tenant prompt channel, so the seed only asks for inline explanations."""
    folder = make_folder(tmp_path, dirs)
    prompt = render_system_prompt(
        folder, is_lead=False, platform_dir=dirs["platform"], semantic_explanation=True
    )
    section = prompt.split("<semantic_explanation>")[1].split("</semantic_explanation>")[0]
    assert "semantic-explanation-additions.md" not in section
    assert "platform/seeds" not in section
    assert "do quản trị viên duy trì" in section


def test_the_shipped_fabrikam_data_dictionary_is_injected(tmp_path, dirs):
    folder = make_folder(tmp_path, dirs)
    prompt = render_system_prompt(
        folder,
        is_lead=False,
        platform_dir=dirs["platform"],
        domains_dir=REPO / "domains",
        domain_id="fabrikam",
    )
    section = prompt.split("<data_dictionary>")[1].split("</data_dictionary>")[0]
    assert "Fabrikam" in section and "Vinhomes" not in section
    assert "gold" in section
