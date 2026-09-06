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

LLM_RUNTIME_NOTICE = (
    "Phần diễn giải bằng LLM chưa khả dụng ở lần chạy này; "
    "báo cáo vẫn sử dụng các metric deterministic đã được kiểm chứng. "
    "Hãy kiểm tra cấu hình provider/API key rồi chạy lại nếu cần diễn giải bằng ngôn ngữ tự nhiên."
)
_LLM_FAILURE_MARKER = "không sinh được báo cáo bằng llm:"


class LLMNotConfiguredError(RuntimeError):
    """Chưa điền API key — nêu rõ tên biến cần điền để user sửa được ngay."""

    def __init__(self, settings: Settings, *, provider: str | None = None) -> None:
        provider = provider or settings.llm_provider
        key_env = LLM_PROVIDERS[provider]["key_env"]
        super().__init__(
            f"Chưa cấu hình LLM. Điền {key_env} (hoặc LLM_API_KEY) trong file .env "
            f"— provider hiện tại: {provider}."
        )
        self.key_env = key_env


def is_llm_runtime_warning(value: Any) -> bool:
    """Identify old and current persisted LLM availability notices."""

    normalized = str(value or "").strip().lower()
    return _LLM_FAILURE_MARKER in normalized or normalized.startswith(
        "phần diễn giải bằng llm chưa khả dụng"
    )


def safe_llm_warning(value: Any) -> str:
    """Never expose provider payloads or API-key diagnostics in reports."""

    return LLM_RUNTIME_NOTICE if is_llm_runtime_warning(value) else str(value or "").strip()


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
    # Old profile runs persisted the provider's whole 401/429 payload above
    # the deterministic fallback report. Remove that transport error on read;
    # keeping it would be noisy and could reveal key fragments in exports.
    text = "\n".join(
        line for line in text.splitlines() if not is_llm_runtime_warning(line)
    ).strip()
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


def normalize_profile_action_numbering(text: str) -> str:
    """Use subsection numbering for the five profile action items.

    Older summaries and some providers emit a plain ``1.``–``5.`` list under
    section 5. Normalize that presentation at read/write boundaries so saved
    reports remain consistent without requiring a data migration.
    """
    trailing_newline = text.endswith("\n")
    lines = text.splitlines()
    in_actions = False
    item_number = 0
    normalized: list[str] = []
    for line in lines:
        if re.match(r"^\s*##\s*5\.\s*Ưu tiên hành động\s*$", line, re.IGNORECASE):
            in_actions = True
            item_number = 0
            normalized.append(line)
            continue
        if in_actions and re.match(r"^\s*##\s+", line):
            in_actions = False
        if in_actions:
            match = re.match(r"^(\s*)(?:\d+\.\d+|\d+)[.)]\s+(.+)$", line)
            if match:
                item_number += 1
                line = f"{match.group(1)}5.{item_number}. {match.group(2)}"
        normalized.append(line)
    result = "\n".join(normalized)
    return result + ("\n" if trailing_newline else "")


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


@lru_cache
def get_profile_summary_llm() -> BaseChatModel:
    """Select the narrative model independently of the main agent provider."""
    settings = get_settings()
    if settings.profile_summary_provider == "default":
        return get_llm()
    if not settings.openai_api_key:
        raise LLMNotConfiguredError(settings, provider="openai")
    return ChatOpenAI(
        model=settings.profile_summary_model,
        api_key=settings.openai_api_key,
        base_url=LLM_PROVIDERS["openai"]["base_url"],
        temperature=settings.llm_temperature,
        timeout=90,
        max_retries=2,
    )


def llm_available() -> bool:
    """Kiểm tra không raise — dùng cho endpoint /health và /status."""
    return get_settings().llm_configured


__all__ = ["LLMNotConfiguredError", "LLM_RUNTIME_NOTICE", "get_llm", "get_profile_summary_llm", "is_llm_runtime_warning", "llm_available", "normalize_profile_action_numbering", "report_text", "response_text", "safe_llm_warning"]
