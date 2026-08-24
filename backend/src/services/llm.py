"""Lớp truy cập LLM — multi-provider qua giao thức OpenAI-compatible.

Đổi provider chỉ cần sửa `llm.provider` trong config.yaml + điền key tương ứng
trong .env; không module nào khác phải thay đổi.
"""

from __future__ import annotations

import ast
import re
from functools import lru_cache
from typing import Any

from langchain_core.language_models import BaseChatModel
# pyrefly: ignore [missing-import]
from langchain_google_genai import ChatGoogleGenerativeAI
# pyrefly: ignore [missing-import]
from langchain_openai import ChatOpenAI
from src.config import LLM_PROVIDERS, Settings, get_settings


class LLMNotConfiguredError(RuntimeError):
    """Chưa điền API key — nêu rõ tên biến cần điền để user sửa được ngay."""

    def __init__(self, settings: Settings) -> None:
        key_env = LLM_PROVIDERS[settings.llm_provider]["key_env"]
        super().__init__(
            f"Chưa cấu hình LLM. Điền {key_env} (hoặc LLM_API_KEY) trong file .env "
            f"— provider hiện tại: {settings.llm_provider}."
        )
        self.key_env = key_env


def response_text(response: Any) -> str:
    """Extract only textual parts from LangChain/Gemini model responses.

    Gemini can return ``content`` as a list of blocks containing ``text`` and
    a provider thought signature.  Converting that list with ``str(...)``
    leaks the transport representation into the report UI.  This helper also
    reads legacy persisted Python-list strings so old profile runs render
    correctly without a destructive database migration.
    """

    content = getattr(response, "content", response)
    if isinstance(content, str):
        value = content.strip()
        if value.startswith("[{'type':") or value.startswith('[{"type":'):
            try:
                return response_text(ast.literal_eval(value))
            except (SyntaxError, ValueError):
                # Some legacy rows contain apostrophes in the model text, so
                # their Python repr is not parseable as a whole. Extract only
                # the quoted `text` blocks while honoring escaped quotes.
                parts: list[str] = []
                for match in re.finditer(r"['\"]text['\"]\s*:\s*(['\"])", value):
                    quote = match.group(1)
                    start = match.end() - 1
                    escaped = False
                    for index in range(start + 1, len(value)):
                        char = value[index]
                        if char == quote and not escaped:
                            try:
                                part = ast.literal_eval(value[start : index + 1])
                            except (SyntaxError, ValueError):
                                part = None
                            if isinstance(part, str) and part.strip():
                                parts.append(part)
                            break
                        escaped = char == "\\" and not escaped
                        if char != "\\":
                            escaped = False
                if parts:
                    return "\n".join(parts)
        return content
    if isinstance(content, dict):
        text = content.get("text")
        if isinstance(text, str):
            return text
        return ""
    if isinstance(content, (list, tuple)):
        parts: list[str] = []
        for block in content:
            text = response_text(block)
            if text.strip():
                parts.append(text.strip())
        return "\n".join(parts)
    return str(content)


def report_text(response: Any) -> str:
    """Return clean Markdown suitable for the profile summary renderer."""

    text = response_text(response).replace("\r\n", "\n").strip()
    # Models occasionally wrap an otherwise valid report in a Markdown fence.
    if text.startswith("```") and text.endswith("```"):
        lines = text.splitlines()
        text = "\n".join(lines[1:-1]).strip()
    # Horizontal rules add no structure in the compact summary card and were
    # previously rendered as stray paragraphs between every section.
    lines = [line for line in text.splitlines() if line.strip() != "---"]
    compact: list[str] = []
    blank = False
    for line in lines:
        if not line.strip():
            if blank:
                continue
            blank = True
        else:
            blank = False
        compact.append(line.rstrip())
    return "\n".join(compact).strip()


@lru_cache
def get_llm(streaming: bool = False) -> BaseChatModel:
    """Client LLM dùng chung. Raise `LLMNotConfiguredError` nếu thiếu key."""
    settings = get_settings()
    if not settings.llm_configured:
        raise LLMNotConfiguredError(settings)

    if settings.llm_provider == "gemini":
        # Native Gemini preserves provider-specific thought signatures in tool calls.
        return ChatGoogleGenerativeAI(
            model=settings.llm_model,
            google_api_key=settings.llm_api_key,
            temperature=settings.llm_temperature,
            max_retries=2,
        )

    kwargs: dict[str, Any] = {
        "model": settings.llm_model,
        "temperature": settings.llm_temperature,
        "api_key": settings.llm_api_key or "not-needed",
        "streaming": streaming,
    }
    if settings.llm_base_url:
        kwargs["base_url"] = settings.llm_base_url
    # Chỉ model o-series/gpt-5 hiểu tham số này; provider khác sẽ báo lỗi 400.
    if settings.llm_reasoning_effort:
        kwargs["reasoning_effort"] = settings.llm_reasoning_effort

    return ChatOpenAI(**kwargs)


def llm_available() -> bool:
    """Kiểm tra không raise — dùng cho endpoint /health và /status."""
    return get_settings().llm_configured


__all__ = ["LLMNotConfiguredError", "get_llm", "llm_available", "report_text", "response_text"]
