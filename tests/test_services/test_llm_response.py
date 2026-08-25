from src.services.llm import LLM_RUNTIME_NOTICE, report_text, response_text, safe_llm_warning


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
