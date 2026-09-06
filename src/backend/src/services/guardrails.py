"""Guardrails deterministic cho input, evidence, output và audit của agent.

Prompt là một lớp hướng dẫn, không phải security boundary. Module này giữ các
quy tắc cần enforce bằng code để chúng vẫn hoạt động khi model trả lời sai:

- chuẩn hoá text và loại control/bidi characters;
- chặn yêu cầu lấy system prompt, secret hoặc giá trị PII thô;
- phát hiện prompt-injection để route/audit không phụ thuộc LLM;
- redact credential và PII phổ biến khỏi output;
- audit câu hỏi bằng hash mặc định, không ghi nguyên văn.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class QuestionAssessment:
    normalized: str
    blocked: bool
    reason: str | None = None
    response: str | None = None
    signals: tuple[str, ...] = ()


@dataclass(frozen=True)
class GuardedOutput:
    text: str
    redactions: tuple[str, ...] = ()
    truncated: bool = False


_DISCLOSURE_ACTION = re.compile(
    r"\b(?:show|reveal|print|repeat|dump|expose|display|give\s+me|tell\s+me|"
    r"export|extract|hiển\s+thị|tiết\s+lộ|in\s+ra|xuất|trích\s+xuất|"
    r"lặp\s+lại|đọc\s+nguyên\s+văn|"
    r"cho\s+(?:tôi|mình)(?:\s+xem)?|cung\s+cấp)\b",
    re.IGNORECASE,
)
_INTERNAL_INSTRUCTION_TARGET = re.compile(
    r"\b(?:system\s+prompt|developer\s+(?:message|prompt)|hidden\s+instructions?|"
    r"internal\s+(?:prompt|instructions?)|prompt\s+hệ\s+thống|chỉ\s+thị\s+ẩn|"
    r"hướng\s+dẫn\s+nội\s+bộ)\b",
    re.IGNORECASE,
)
_SECRET_TARGET = re.compile(
    r"(?:\b(?:api[ _-]?key|access[ _-]?token|bearer[ _-]?token|password|"
    r"credential|client[ _-]?secret|secret)\b|\.env\b)",
    re.IGNORECASE,
)
_RAW_VALUE_TARGET = re.compile(
    r"(?:\b(?:raw|unmasked|full|đầy\s+đủ|nguyên\s+vẹn|toàn\s+bộ|giá\s+trị\s+thật|giá\s+trị\s+gốc|raw\s+values?|"
    r"records?|rows?|bản\s+ghi|dòng\s+dữ\s+liệu)\b.{0,50}"
    r"\b(?:pii|email|e-mail|phone|số\s+điện\s+thoại|cccd|cmnd|"
    r"credit\s+card|thẻ\s+tín\s+dụng)\b|"
    r"\b(?:pii|email|e-mail|phone|số\s+điện\s+thoại|cccd|cmnd|"
    r"credit\s+card|thẻ\s+tín\s+dụng)\b.{0,50}"
    r"\b(?:raw|unmasked|full|đầy\s+đủ|nguyên\s+vẹn|toàn\s+bộ|giá\s+trị\s+thật|giá\s+trị\s+gốc|values?|records?|rows?|"
    r"bản\s+ghi|dòng\s+dữ\s+liệu)\b)",
    re.IGNORECASE,
)
_INJECTION_PATTERNS = (
    re.compile(
        r"\b(?:ignore|disregard|override)\b.{0,40}\b(?:previous|prior|above|system|"
        r"instructions?|rules?|prompt)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:bỏ\s+qua|phớt\s+lờ|ghi\s+đè|vô\s+hiệu)\b.{0,40}"
        r"\b(?:chỉ\s+thị|hướng\s+dẫn|quy\s+tắc|prompt|system)\b",
        re.IGNORECASE,
    ),
    re.compile(r"\b(?:jailbreak|developer\s+mode|do\s+anything\s+now)\b", re.IGNORECASE),
)
_OUT_OF_SCOPE_INVESTMENT_ADVICE = re.compile(
    r"\b(?:nên\s+(?:mua|bán|đầu\s+tư)|should\s+i\s+(?:buy|sell|invest))\b"
    r".{0,80}\b(?:cổ\s+phiếu|chứng\s+khoán|stock|shares?|crypto|tiền\s+mã\s+hóa)\b|"
    r"\b(?:cổ\s+phiếu|chứng\s+khoán|stock|shares?|crypto|tiền\s+mã\s+hóa)\b"
    r".{0,80}\b(?:nào\s+nên\s+(?:mua|bán|đầu\s+tư)|which\s+.*\s+should\s+i\s+(?:buy|sell))\b",
    re.IGNORECASE,
)

_EMAIL = re.compile(r"(?<![\w.+-])[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}(?![\w.-])", re.IGNORECASE)
_PHONE = re.compile(r"(?<!\d)(?:\+?84|0)(?:[ .-]?\d){9,10}(?!\d)")
_BEARER = re.compile(r"\bbearer\s+[A-Z0-9._~+/=-]{12,}", re.IGNORECASE)
_API_KEY = re.compile(r"\b(?:sk|rk|pk|ghp|xox[baprs])[-_][A-Z0-9_-]{12,}\b", re.IGNORECASE)
_SECRET_ASSIGNMENT = re.compile(
    r"\b(?:api[ _-]?key|access[ _-]?token|password|client[ _-]?secret)"
    r"\s*[:=]\s*[\"']?[^\s\"']{8,}",
    re.IGNORECASE,
)
_CARD_CANDIDATE = re.compile(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)")


def normalize_user_text(value: str) -> str:
    """Chuẩn hoá Unicode và bỏ ký tự điều khiển/ẩn dùng để đánh lừa parser/UI."""
    normalized = unicodedata.normalize("NFKC", value or "")
    cleaned = "".join(
        char
        for char in normalized
        if char in {"\n", "\t"} or unicodedata.category(char) not in {"Cc", "Cf"}
    )
    return cleaned.strip()


def assess_question(value: str) -> QuestionAssessment:
    """Đánh giá câu hỏi bằng rule local; không gửi nội dung nhạy cảm sang LLM."""
    question = normalize_user_text(value)
    signals = tuple(
        f"prompt_injection:{index}"
        for index, pattern in enumerate(_INJECTION_PATTERNS, start=1)
        if pattern.search(question)
    )

    if _DISCLOSURE_ACTION.search(question) and _INTERNAL_INSTRUCTION_TARGET.search(question):
        return QuestionAssessment(
            normalized=question,
            blocked=True,
            reason="internal_instructions",
            response=(
                "Mình không thể cung cấp hoặc lặp lại system prompt và chỉ thị nội bộ. "
                "Mình có thể mô tả guardrails ở mức chức năng hoặc trả lời câu hỏi về "
                "profile dữ liệu."
            ),
            signals=signals + ("prompt_exfiltration",),
        )

    if _DISCLOSURE_ACTION.search(question) and _SECRET_TARGET.search(question):
        return QuestionAssessment(
            normalized=question,
            blocked=True,
            reason="credential_exfiltration",
            response=(
                "Mình không thể đọc hoặc tiết lộ API key, token, mật khẩu hay secret. "
                "Bạn có thể kiểm tra trạng thái cấu hình mà không hiển thị giá trị secret."
            ),
            signals=signals + ("credential_exfiltration",),
        )

    if _DISCLOSURE_ACTION.search(question) and _RAW_VALUE_TARGET.search(question):
        return QuestionAssessment(
            normalized=question,
            blocked=True,
            reason="raw_pii_exfiltration",
            response=(
                "Mình không thể hiển thị hoặc xuất giá trị PII thô. Mình vẫn có thể cung "
                "cấp thống kê đã tổng hợp như null%, cardinality, độ dài và mức rủi ro."
            ),
            signals=signals + ("raw_pii_exfiltration",),
        )

    if signals:
        return QuestionAssessment(
            normalized=question,
            blocked=True,
            reason="instruction_override",
            response=(
                "Mình không thể bỏ qua hoặc thay đổi các guardrails của hệ thống. "
                "Hãy đặt câu hỏi trực tiếp về dataset, metrics hoặc metadata cần phân tích."
            ),
            signals=signals,
        )

    if _OUT_OF_SCOPE_INVESTMENT_ADVICE.search(question):
        return QuestionAssessment(
            normalized=question,
            blocked=True,
            reason="out_of_scope_investment_advice",
            response=(
                "Yêu cầu khuyến nghị mua hoặc bán tài sản nằm ngoài phạm vi phân tích "
                "Profile Run của hệ thống. Mình có thể mô tả các thống kê đã profile, "
                "nhưng không đưa ra khuyến nghị đầu tư cá nhân."
            ),
            signals=("out_of_scope_investment_advice",),
        )

    return QuestionAssessment(normalized=question, blocked=False)


def _luhn_valid(candidate: str) -> bool:
    digits = [int(char) for char in candidate if char.isdigit()]
    if not 13 <= len(digits) <= 19 or len(set(digits)) == 1:
        return False
    checksum = 0
    parity = len(digits) % 2
    for index, digit in enumerate(digits):
        if index % 2 == parity:
            digit *= 2
            if digit > 9:
                digit -= 9
        checksum += digit
    return checksum % 10 == 0


def enforce_output_guardrails(value: str, max_chars: int = 12_000) -> GuardedOutput:
    """Redact dữ liệu nhạy cảm phổ biến và chặn output dài bất thường."""
    text = value or ""
    redactions: list[str] = []

    replacements = (
        (_BEARER, "[ĐÃ ẨN TOKEN]", "bearer_token"),
        (_API_KEY, "[ĐÃ ẨN API KEY]", "api_key"),
        (_SECRET_ASSIGNMENT, "[ĐÃ ẨN SECRET]", "secret_assignment"),
        (_EMAIL, "[ĐÃ ẨN EMAIL]", "email"),
        (_PHONE, "[ĐÃ ẨN SỐ ĐIỆN THOẠI]", "phone"),
    )
    for pattern, replacement, label in replacements:
        text, count = pattern.subn(replacement, text)
        if count:
            redactions.extend([label] * count)

    def redact_card(match: re.Match[str]) -> str:
        candidate = match.group(0)
        if not _luhn_valid(candidate):
            return candidate
        redactions.append("payment_card")
        return "[ĐÃ ẨN SỐ THẺ]"

    text = _CARD_CANDIDATE.sub(redact_card, text)
    truncated = len(text) > max_chars
    if truncated:
        text = text[:max_chars].rstrip() + "\n\n[Đã rút gọn vì câu trả lời vượt giới hạn an toàn.]"

    return GuardedOutput(
        text=text,
        redactions=tuple(sorted(set(redactions))),
        truncated=truncated,
    )


def audit_question_fields(
    question: str,
    *,
    include_content: bool = False,
    signals: tuple[str, ...] | list[str] = (),
) -> dict[str, Any]:
    """Metadata audit không chứa nguyên văn câu hỏi trừ khi được bật rõ ràng."""
    normalized = normalize_user_text(question)
    fields: dict[str, Any] = {
        "question_hash": hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16],
        "question_length": len(normalized),
    }
    if signals:
        fields["guardrail_signals"] = sorted(set(signals))
    if include_content:
        fields["question"] = normalized[:200]
    return fields


__all__ = [
    "GuardedOutput",
    "QuestionAssessment",
    "assess_question",
    "audit_question_fields",
    "enforce_output_guardrails",
    "normalize_user_text",
]
