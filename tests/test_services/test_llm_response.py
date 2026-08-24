from src.services.llm import report_text, response_text


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
