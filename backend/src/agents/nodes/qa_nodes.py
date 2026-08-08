"""Các node của nhánh Q&A: qa_router → qa_structured | qa_vector (ADR-002).

Hai nhánh tách nhau vì bản chất câu hỏi khác nhau:

- **Định lượng** ("null% của cột email là bao nhiêu?") cần con số chính xác →
  tra trực tiếp DB qua tool, LLM chỉ diễn đạt lại. Không bao giờ để LLM tự tính.
- **Định tính** ("dataset này có vấn đề gì?") cần ngữ cảnh rộng → hybrid search
  trên báo cáo đã index (ADR-007).

Câu hỏi mơ hồ (eval B-01 "Cột đó có vấn đề không?") bị router đẩy sang
`clarify` để hỏi lại, không đoán.
"""

from __future__ import annotations

import json
import re
from typing import Any

from src.agents.prompts import (
    BASE_RULES,
    CLARIFY_PROMPT,
    QA_ROUTER_PROMPT,
    QA_STRUCTURED_PROMPT,
    QA_VECTOR_PROMPT,
)
from src.agents.state import ProfilingState
from src.agents.tools.registry import STRUCTURED_TOOLS, run_tool
from src.config import get_settings
from src.services.guardrails import (
    assess_question,
    audit_question_fields,
    enforce_output_guardrails,
)
from src.services.llm import LLMNotConfiguredError, get_llm
from src.services.repository import get_repository
from src.services.retrieval import get_index
from src.services.security import get_audit

# Đại từ/tham chiếu không rõ ràng: "cột đó", "nó", "cái này"... Nếu câu hỏi
# chứa các từ này mà KHÔNG nêu tên cột cụ thể nào thì phải hỏi lại.
_VAGUE_REFERENCES = re.compile(
    r"\b(cột đó|cột này|cột kia|nó|cái đó|cái này|chỗ đó|bảng đó|that column|it)\b",
    re.IGNORECASE,
)

_QUANTITATIVE_HINTS = (
    "bao nhiêu",
    "mấy",
    "tỷ lệ",
    "tỉ lệ",
    "phần trăm",
    "trung bình",
    "median",
    "trung vị",
    "độ lệch chuẩn",
    "min",
    "max",
    "lớn nhất",
    "nhỏ nhất",
    "tổng",
    "đếm",
    "count",
    "null",
    "cardinality",
    "outlier",
    "tương quan",
    "correlation",
    "p-value",
    "p value",
    "unique",
)

_SOCIAL_GREETING = re.compile(
    r"^\s*(?:hi|hello|hey|xin chào|chào|hế lô|good morning|good afternoon)\b|"
    r"\b(?:tôi|mình|em)\s+tên\s+là\s+[^.!?]+",
    re.IGNORECASE,
)


def _profile_fallback_summary(run_id: str | None) -> str:
    """Tạo tóm tắt deterministic, ngắn gọn khi LLM không sẵn sàng."""
    if not run_id:
        return "Không có profile cụ thể để tạo tóm tắt. Hãy chọn hoặc chạy profiling cho dataset trước."

    profile = get_repository().full_profile(run_id, mask_pii=True)
    if not profile:
        return "Không tìm thấy profile để tạo tóm tắt."

    run = profile["run"]
    dataset = profile.get("dataset") or {}
    stats = profile.get("column_stats") or []
    warnings = [
        warning
        for warning in (run.get("risk_warnings") or [])
        if not warning.startswith("Không sinh được báo cáo bằng LLM:")
    ]
    lines = [
        "## Tóm tắt chất lượng dữ liệu",
        f"**{dataset.get('name') or 'Dataset'}** có **{run.get('row_count') or 0:,} dòng** và **{len(stats)} cột**.",
        "",
        "### Thống kê theo cột",
        "| Cột | Kiểu | Thiếu | Cardinality |",
        "| --- | --- | ---: | ---: |",
    ]
    for stat in stats:
        lines.append(
            "| {name} | {dtype} | {null_pct:.2f}% | {cardinality:,} |".format(
                name=stat.get("column_name", "—"),
                dtype=stat.get("dtype") or "—",
                null_pct=float(stat.get("null_pct") or 0),
                cardinality=int(stat.get("cardinality") or 0),
            )
        )

    lines.extend(["", "### Cần chú ý"])
    lines.extend(f"- {warning}" for warning in warnings) if warnings else lines.append(
        "- Chưa có cảnh báo chất lượng dữ liệu nổi bật."
    )
    lines.extend([
        "",
        "_Tóm tắt này lấy trực tiếp từ compute engine; diễn giải bằng LLM sẽ được dùng lại khi kết nối dịch vụ khả dụng._",
    ])
    return "\n".join(lines)


def _mentioned_columns(question: str, columns: list[str]) -> list[str]:
    lowered = question.lower()
    return [c for c in columns if c and c.lower() in lowered]


def _social_response(question: str) -> str:
    """Trả lời tự nhiên cho lời chào/giới thiệu, không truy vấn dataset."""
    match = re.search(r"\b(?:tôi|mình|em)\s+tên\s+là\s+([^.!?]+)", question, re.IGNORECASE)
    raw_name = match.group(1).strip() if match else "bạn"
    # Tên được phản chiếu vào Markdown nên chỉ giữ ký tự tên người thông dụng,
    # chặn markup/control text và payload dài.
    name = re.sub(r"[^\wÀ-ỹ' -]", "", raw_name, flags=re.UNICODE).strip()[:80] or "bạn"
    return (
        f"Rất vui được làm quen với {name}! Mình là P-170 Agent, trợ lý profiling dữ liệu.\n\n"
        "Bạn có thể bắt đầu bằng cách upload một dataset. Sau đó:\n"
        "- Chọn Sampling hoặc Full scan để tính metrics.\n"
        "- Review và xác nhận các proposals metadata.\n"
        "- Hỏi mình về chất lượng dữ liệu, PII, outlier, cardinality hoặc candidate key."
    )


def _guard_answer(answer: str) -> str:
    """Defense in depth cho mọi text do model/fallback sinh ra."""
    settings = get_settings()
    guarded = enforce_output_guardrails(answer, settings.guardrails_max_output_chars)
    if guarded.redactions or guarded.truncated:
        get_audit().log(
            "guardrail_output",
            redactions=list(guarded.redactions),
            truncated=guarded.truncated,
        )
    return guarded.text


def qa_router_node(state: ProfilingState) -> dict[str, Any]:
    """Phân loại câu hỏi. Không đủ thông tin để trả lời thì đánh dấu clarify."""
    assessment = assess_question(state.get("question") or "")
    question = assessment.normalized
    if not question:
        return {"question_type": "clarify", "answer": "Bạn muốn hỏi gì về dataset này?"}

    if assessment.blocked:
        get_audit().log(
            "guardrail_block",
            reason=assessment.reason,
            profile_run_id=state.get("profile_run_id"),
            user=state.get("requested_by"),
            **audit_question_fields(
                question,
                include_content=get_settings().guardrails_audit_question_content,
                signals=assessment.signals,
            ),
        )
        return {
            "question": question,
            "question_type": "guardrail",
            "qa_context": {
                "guardrail_reason": assessment.reason,
                "guardrail_signals": list(assessment.signals),
            },
            "answer": assessment.response or "Yêu cầu này bị guardrail chặn.",
            "answer_sources": [],
        }

    if _SOCIAL_GREETING.search(question):
        return {
            "question": question,
            "question_type": "qualitative",
            "qa_context": {"social_greeting": True},
            "answer": _social_response(question),
            "answer_sources": [],
        }

    columns = state.get("column_names") or []
    if not columns and state.get("profile_run_id"):
        stats = get_repository().get_column_stats(state["profile_run_id"])
        columns = list(stats.keys())

    mentioned = _mentioned_columns(question, columns)

    # Tham chiếu mơ hồ + không nêu cột nào -> hỏi lại (eval B-01).
    if _VAGUE_REFERENCES.search(question) and not mentioned:
        return {
            "question_type": "clarify",
            "qa_context": {"columns_available": columns[:50]},
        }

    lowered = question.lower()
    heuristic = "quantitative" if any(h in lowered for h in _QUANTITATIVE_HINTS) else None

    question_type = heuristic
    if question_type is None:
        try:
            llm = get_llm()
            response = llm.invoke(
                [
                    {"role": "system", "content": QA_ROUTER_PROMPT},
                    {"role": "user", "content": question},
                ]
            )
            label = str(response.content).strip().lower()
            question_type = label if label in {"quantitative", "qualitative", "clarify"} else "qualitative"
        except (LLMNotConfiguredError, Exception):  # noqa: BLE001
            # Không có LLM: mặc định định tính (hybrid search vẫn chạy offline).
            question_type = "qualitative"

    return {
        "question": question,
        "question_type": question_type,
        "qa_context": {"mentioned_columns": mentioned, "columns_available": columns[:50]},
        "tool_calls": state.get("tool_calls", 0) + 1,
    }


def classify_question_type(state: ProfilingState) -> str:
    """Conditional edge của qa_router."""
    qtype = state.get("question_type")
    if qtype == "clarify":
        return "clarify"
    if qtype == "quantitative":
        return "quantitative"
    if qtype == "guardrail":
        return "guardrail"
    return "qualitative"


def qa_guardrail_node(state: ProfilingState) -> dict[str, Any]:
    """Trả policy response deterministic; tuyệt đối không gọi model hay data source."""
    return {
        "answer": state.get("answer") or "Yêu cầu này không nằm trong phạm vi được phép.",
        "answer_sources": [],
        "question_type": "guardrail",
    }


def clarify_node(state: ProfilingState) -> dict[str, Any]:
    """Hỏi lại khi câu hỏi mơ hồ — thà hỏi còn hơn đoán (eval nhóm B)."""
    question = state.get("question") or ""
    columns = (state.get("qa_context") or {}).get("columns_available") or []

    try:
        llm = get_llm()
        response = llm.invoke(
            [
                {"role": "system", "content": BASE_RULES},
                {
                    "role": "user",
                    "content": CLARIFY_PROMPT.format(
                        question=question,
                        columns=", ".join(columns[:30]) or "(chưa profiling)",
                    ),
                },
            ]
        )
        answer = _guard_answer(str(response.content))
    except (LLMNotConfiguredError, Exception):  # noqa: BLE001
        preview = ", ".join(columns[:10]) or "(chưa có cột nào được profiling)"
        answer = (
            "Câu hỏi chưa rõ mình cần xem cột nào. Bạn cho mình biết tên cột cụ thể nhé.\n"
            f"Các cột hiện có: {preview}"
        )

    return {"answer": _guard_answer(answer), "answer_sources": [], "question_type": "clarify"}


# --------------------------------------------------------------------------- #
# Nhánh định lượng
# --------------------------------------------------------------------------- #
def qa_structured_node(state: ProfilingState) -> dict[str, Any]:
    """Trả lời câu hỏi số bằng cách gọi tool tra DB, LLM chỉ diễn đạt lại.

    Hai trần độc lập: số vòng model và tổng số tool call trong request. Mọi tool
    luôn chạy trong profile_run_id do server inject, model không đổi được scope.
    """
    settings = get_settings()
    run_id = state.get("profile_run_id")
    question = state.get("question") or ""

    if not run_id:
        return {
            "answer": "Chưa có lần profiling nào để tra số. Bạn chạy profiling trước nhé.",
            "answer_sources": [],
        }

    try:
        base_llm = get_llm()
        llm = base_llm.bind_tools(STRUCTURED_TOOLS)
    except LLMNotConfiguredError as exc:
        # Fallback vẫn đi qua dispatcher để giữ nguyên PII masking và run scope.
        mentioned = (state.get("qa_context") or {}).get("mentioned_columns") or []
        if mentioned:
            facts: Any = {
                column: run_tool("get_stat", {"column_name": column}, profile_run_id=run_id)
                for column in mentioned
            }
            source_type = "get_stat"
        else:
            facts = run_tool("list_columns", {}, profile_run_id=run_id)
            source_type = "list_columns"
        return {
            "answer": _guard_answer(
                f"{exc}\n\nSố liệu thô từ profiling:\n"
                f"```json\n{json.dumps(facts, ensure_ascii=False, indent=2, default=str)}\n```"
            ),
            "answer_sources": [
                {"type": "tool", "tool": source_type, "profile_run_id": run_id}
            ],
            "tool_calls": state.get("tool_calls", 0) + 1,
        }

    messages: list[Any] = [
        {"role": "system", "content": BASE_RULES + "\n\n" + QA_STRUCTURED_PROMPT},
        {"role": "user", "content": question},
    ]
    sources: list[dict[str, Any]] = []
    calls_used = 0
    evidence_available = False
    response: Any = None
    max_calls = settings.guardrails_max_tool_calls_per_request

    for _ in range(max(1, settings.llm_max_tool_rounds)):
        response = llm.invoke(messages)
        messages.append(response)

        tool_calls = getattr(response, "tool_calls", None) or []
        if not tool_calls:
            break

        budget_exhausted = False
        for call in tool_calls:
            name = call.get("name", "")
            args = call.get("args", {}) or {}
            if calls_used >= max_calls:
                result = {
                    "error": "Đã đạt giới hạn tool call của request; tool không được thực thi."
                }
                budget_exhausted = True
            elif name == "calculate" and not evidence_available:
                # Calculator chỉ được dùng sau khi đã có số từ metadata tool.
                calls_used += 1
                result = {
                    "error": "Calculator cần evidence từ metadata tool trong cùng lượt trước."
                }
            else:
                calls_used += 1
                result = run_tool(name, args, profile_run_id=run_id)
                if name != "calculate" and not (isinstance(result, dict) and result.get("error")):
                    evidence_available = True

            sources.append(
                {
                    "type": "tool",
                    "tool": name,
                    "args": args,
                    "status": "error" if isinstance(result, dict) and result.get("error") else "ok",
                }
            )
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call.get("id", ""),
                    "content": json.dumps(result, ensure_ascii=False, default=str),
                }
            )
        if budget_exhausted:
            messages.append(
                {
                    "role": "user",
                    "content": (
                        "Tool budget đã hết. Trả lời chỉ từ tool results hiện có; "
                        "nêu rõ phần nào chưa xác định và không gọi thêm tool."
                    ),
                }
            )
            response = base_llm.invoke(messages)
            break
    else:
        messages.append(
            {
                "role": "user",
                "content": (
                    "Đã hết số lượt gọi tool cho phép. Trả lời dựa trên dữ liệu đã có, "
                    "nêu rõ phần nào chưa tra được."
                ),
            }
        )
        response = base_llm.invoke(messages)

    get_audit().log(
        "qa_structured",
        profile_run_id=run_id,
        tools_used=[s.get("tool") for s in sources],
        tool_calls=calls_used,
        **audit_question_fields(
            question,
            include_content=settings.guardrails_audit_question_content,
        ),
    )
    return {
        "answer": _guard_answer(str(getattr(response, "content", ""))),
        "answer_sources": sources,
        "tool_calls": state.get("tool_calls", 0) + calls_used,
    }


# --------------------------------------------------------------------------- #
# Nhánh định tính
# --------------------------------------------------------------------------- #
def qa_vector_node(state: ProfilingState) -> dict[str, Any]:
    """Trả lời câu hỏi mở bằng hybrid retrieval trên báo cáo đã index (ADR-007)."""
    settings = get_settings()
    question = state.get("question") or ""
    run_id = state.get("profile_run_id")

    if (state.get("qa_context") or {}).get("social_greeting"):
        return {
            "answer": _guard_answer(state.get("answer") or _social_response(question)),
            "answer_sources": [],
        }

    index = get_index()
    where = {"profile_run_id": run_id} if run_id else None
    hits = index.search(
        question,
        top_k=settings.retrieval_top_k,
        candidate_k=settings.retrieval_candidate_k,
        where=where,
    )

    # Defense in depth: khi caller chọn run, không bao giờ fallback hoặc nhận
    # evidence của run khác dù index/backend retrieval có lỗi filter.
    if run_id:
        hits = [
            hit for hit in hits if (hit.metadata or {}).get("profile_run_id") == run_id
        ]

    if not hits:
        return {
            "answer": (
                "Dữ liệu profiling không có thông tin để trả lời câu hỏi này. "
                "Bạn chạy profiling cho dataset trước, hoặc hỏi cụ thể về một cột."
            ),
            "answer_sources": [],
        }

    evidence: list[dict[str, Any]] = []
    bounded_hits = []
    remaining = settings.guardrails_max_context_chars
    for index_number, hit in enumerate(hits, start=1):
        if remaining <= 0:
            break
        text = hit.text[:remaining]
        if not text:
            break
        evidence.append(
            {
                "source_id": f"S{index_number}",
                "retrieval_channel": hit.source,
                "text": text,
            }
        )
        bounded_hits.append(hit)
        remaining -= len(text)

    sources = [
        {
            "type": "profile_report",
            "source_id": f"S{i + 1}",
            "doc_id": h.doc_id,
            "source": h.source,
            "score": round(h.score, 6),
            "profile_run_id": (h.metadata or {}).get("profile_run_id"),
            "dataset_name": (h.metadata or {}).get("dataset_name"),
        }
        for i, h in enumerate(bounded_hits)
    ]

    try:
        llm = get_llm()
        response = llm.invoke(
            [
                {"role": "system", "content": BASE_RULES + "\n\n" + QA_VECTOR_PROMPT},
                {
                    "role": "user",
                    "content": json.dumps(
                        {"question": question, "evidence": evidence},
                        ensure_ascii=False,
                        default=str,
                    ),
                },
            ]
        )
        answer = _guard_answer(str(response.content))
    except LLMNotConfiguredError:
        answer = _profile_fallback_summary(run_id)
    except Exception:  # noqa: BLE001
        # Không đưa lỗi transport và report thô dài vào chat; vẫn trả evidence hữu ích.
        answer = _profile_fallback_summary(run_id)

    get_audit().log(
        "qa_vector",
        profile_run_id=run_id,
        hits=len(bounded_hits),
        context_chars=settings.guardrails_max_context_chars - remaining,
        **audit_question_fields(
            question,
            include_content=settings.guardrails_audit_question_content,
        ),
    )
    return {
        "answer": _guard_answer(answer),
        "answer_sources": sources,
        "tool_calls": state.get("tool_calls", 0) + 1,
    }


__all__ = [
    "clarify_node",
    "classify_question_type",
    "qa_guardrail_node",
    "qa_router_node",
    "qa_structured_node",
    "qa_vector_node",
]
