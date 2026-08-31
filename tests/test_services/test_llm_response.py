from src.services.llm import (
    LLM_RUNTIME_NOTICE,
    normalize_profile_action_numbering,
    report_text,
    response_text,
    safe_llm_warning,
)


def test_response_text_discards_provider_metadata_blocks() -> None:
    response = [
        {"type": "text", "text": "# Báo cáo\n\nNội dung", "extras": {"signature": "secret"}},
        {"type": "text", "text": "Tiếp theo"},
    ]

    assert response_text(response) == "# Báo cáo\n\nNội dung\nTiếp theo"


def test_report_text_normalizes_legacy_stringified_response() -> None:
    legacy = repr(
        [
            {
                "type": "text",
                "text": "### Phạm vi\n\n---\n\nDataset: `sales`",
                "extras": {"signature": "secret"},
            }
        ]
    )

    assert report_text(legacy) == "### Phạm vi\n\nDataset: `sales`"


def test_report_text_removes_legacy_provider_error() -> None:
    legacy = (
        "⚠️ Không sinh được báo cáo bằng LLM: Error code: 401 - Incorrect API key\n\n"
        "## Tóm tắt từ Agent\n\n- Số liệu deterministic vẫn hợp lệ."
    )

    clean = report_text(legacy)

    assert "Incorrect API key" not in clean
    assert "Không sinh được báo cáo bằng LLM" not in clean
    assert clean == "## Tóm tắt từ Agent\n\n- Số liệu deterministic vẫn hợp lệ."
    assert safe_llm_warning(legacy) == LLM_RUNTIME_NOTICE


def test_profile_action_items_use_section_subnumbering() -> None:
    report = (
        "## 5. \u01afu ti\u00ean h\u00e0nh \u0111\u1ed9ng\n"
        "1. **First**\n"
        "2) **Second**\n"
        "5.3. **Already numbered**\n"
        "\n## 6. Next\n"
    )

    assert normalize_profile_action_numbering(report) == (
        "## 5. \u01afu ti\u00ean h\u00e0nh \u0111\u1ed9ng\n"
        "5.1. **First**\n"
        "5.2. **Second**\n"
        "5.3. **Already numbered**\n"
        "\n## 6. Next\n"
    )
