"""Tests for provider-response text extraction without transport metadata."""

from __future__ import annotations

from types import SimpleNamespace

from src.services.llm import model_response_text, sanitize_model_text


def test_model_response_text_keeps_only_text_blocks() -> None:
    response = SimpleNamespace(
        content=[
            {"type": "text", "text": "Kết luận đã kiểm chứng."},
            {"type": "thought", "extras": {"signature": "private-provider-token"}},
        ]
    )

    assert model_response_text(response) == "Kết luận đã kiểm chứng."


def test_sanitize_model_text_repairs_legacy_stringified_extras() -> None:
    text = "Kết luận đã kiểm chứng.\n'extras': {'signature': 'private-provider-token'}"

    assert sanitize_model_text(text) == "Kết luận đã kiểm chứng."
