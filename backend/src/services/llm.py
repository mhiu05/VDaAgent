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

    def __init__(self, settings: Settings) -> None:
        key_env = LLM_PROVIDERS[settings.llm_provider]["key_env"]
        super().__init__(
            f"Chưa cấu hình LLM. Điền {key_env} (hoặc LLM_API_KEY) trong file .env "
            f"— provider hiện tại: {settings.llm_provider}."
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


_INTERNAL_TRANSPORT_FIELD = re.compile(
    r"(?:^|[\n,\[{])\s*['\"]?(?:extras|signature)['\"]?\s*:",
    re.IGNORECASE,
)


def sanitize_model_text(value: str) -> str:
    """Remove provider transport metadata accidentally persisted by older flows.

    Gemini may attach a thought signature in an ``extras`` block.  It is not
    user-facing content, must never be written into reports, and can be very
    large.  Truncating at the first transport field also repairs historical
    text that was produced with ``str(response.content)``.
    """
    match = _INTERNAL_TRANSPORT_FIELD.search(value)
    if match:
        value = value[: match.start()]
    return value.strip(" \t\r\n,;[{\"")


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
        return sanitize_model_text(content)
    if isinstance(content, dict):
        text = content.get("text") or content.get("content")
        if isinstance(text, str):
            return sanitize_model_text(text)
        return ""
    if isinstance(content, (list, tuple)):
        parts: list[str] = []
        for block in content:
            text = response_text(block)
            if text.strip():
                parts.append(text.strip())
        return "\n".join(parts)
    return sanitize_model_text(str(content))


def model_response_text(response_or_content: Any) -> str:
    """Extract displayable text from a provider response without serializing metadata."""
    return response_text(response_or_content)


def report_text(response: Any) -> str:
    """Return clean Markdown suitable for the profile summary renderer."""

    text = response_text(response).replace("\r\n", "\n").strip()
    text = "\n".join(
        line for line in text.splitlines() if not is_llm_runtime_warning(line)
    ).strip()
    if text.startswith("```") and text.endswith("```"):
        lines = text.splitlines()
        text = "\n".join(lines[1:-1]).strip()
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
            streaming=streaming,
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


__all__ = [
    "LLMNotConfiguredError",
    "LLM_RUNTIME_NOTICE",
    "get_llm",
    "is_llm_runtime_warning",
    "llm_available",
    "model_response_text",
    "report_text",
    "response_text",
    "safe_llm_warning",
    "sanitize_model_text",
]
