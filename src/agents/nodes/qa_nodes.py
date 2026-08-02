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
from src.agents.tools.profiling_tools import STRUCTURED_TOOLS, run_tool
from src.config import get_settings
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


def _mentioned_columns(question: str, columns: list[str]) -> list[str]:
    lowered = question.lower()
    return [c for c in columns if c and c.lower() in lowered]


def qa_router_node(state: ProfilingState) -> dict[str, Any]:
    """Phân loại câu hỏi. Không đủ thông tin để trả lời thì đánh dấu clarify."""
    question = (state.get("question") or "").strip()
    if not question:
        return {"question_type": "clarify", "answer": "Bạn muốn hỏi gì về dataset này?"}

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
            question_type = "quantitative" if "quantitative" in label else "qualitative"
        except (LLMNotConfiguredError, Exception):  # noqa: BLE001
            # Không có LLM: mặc định định tính (hybrid search vẫn chạy offline).
            question_type = "qualitative"

    return {
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
    return "qualitative"


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
        answer = str(response.content)
    except (LLMNotConfiguredError, Exception):  # noqa: BLE001
        preview = ", ".join(columns[:10]) or "(chưa có cột nào được profiling)"
        answer = (
            "Câu hỏi chưa rõ mình cần xem cột nào. Bạn cho mình biết tên cột cụ thể nhé.\n"
            f"Các cột hiện có: {preview}"
        )

    return {"answer": answer, "answer_sources": [], "question_type": "clarify"}


# --------------------------------------------------------------------------- #
# Nhánh định lượng
# --------------------------------------------------------------------------- #
def qa_structured_node(state: ProfilingState) -> dict[str, Any]:
    """Trả lời câu hỏi số bằng cách gọi tool tra DB, LLM chỉ diễn đạt lại.

    Vòng lặp tool-calling bị chặn bởi `settings.llm_max_tool_rounds` để không
    quay vô hạn (L3).
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
        llm = get_llm().bind_tools(STRUCTURED_TOOLS)
    except LLMNotConfiguredError as exc:
        # Không có LLM vẫn trả được số thô từ DB.
        stats = get_repository().get_column_stats(run_id)
        mentioned = (state.get("qa_context") or {}).get("mentioned_columns") or []
        picked = {c: stats[c] for c in mentioned if c in stats} or stats
        return {
            "answer": (
                f"{exc}\n\nSố liệu thô từ profiling:\n"
                f"```json\n{json.dumps(picked, ensure_ascii=False, indent=2, default=str)}\n```"
            ),
            "answer_sources": [{"type": "column_stats", "profile_run_id": run_id}],
        }

    messages: list[Any] = [
        {"role": "system", "content": BASE_RULES + "\n\n" + QA_STRUCTURED_PROMPT},
        {"role": "user", "content": question},
    ]
    sources: list[dict[str, Any]] = []

    for _ in range(max(1, settings.llm_max_tool_rounds)):
        response = llm.invoke(messages)
        messages.append(response)

        tool_calls = getattr(response, "tool_calls", None) or []
        if not tool_calls:
            break

        for call in tool_calls:
            name = call.get("name", "")
            args = call.get("args", {}) or {}
            result = run_tool(name, args, profile_run_id=run_id)
            sources.append({"type": "tool", "tool": name, "args": args})
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call.get("id", ""),
                    "content": json.dumps(result, ensure_ascii=False, default=str),
                }
            )
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
        response = llm.invoke(messages)

    get_audit().log(
        "qa_structured",
        profile_run_id=run_id,
        question=question[:200],
        tools_used=[s.get("tool") for s in sources],
    )
    return {
        "answer": str(getattr(response, "content", "")),
        "answer_sources": sources,
        "tool_calls": state.get("tool_calls", 0) + len(sources),
    }


# --------------------------------------------------------------------------- #
# Nhánh định tính
# --------------------------------------------------------------------------- #
def qa_vector_node(state: ProfilingState) -> dict[str, Any]:
    """Trả lời câu hỏi mở bằng hybrid retrieval trên báo cáo đã index (ADR-007)."""
    settings = get_settings()
    question = state.get("question") or ""
    run_id = state.get("profile_run_id")

    index = get_index()
    where = {"profile_run_id": run_id} if run_id else None
    hits = index.search(
        question,
        top_k=settings.retrieval_top_k,
        candidate_k=settings.retrieval_candidate_k,
        where=where,
    )

    # Không tìm được gì trong phạm vi run này thì mở rộng ra toàn bộ index.
    if not hits and where:
        hits = index.search(
            question,
            top_k=settings.retrieval_top_k,
            candidate_k=settings.retrieval_candidate_k,
        )

    if not hits:
        return {
            "answer": (
                "Dữ liệu profiling không có thông tin để trả lời câu hỏi này. "
                "Bạn chạy profiling cho dataset trước, hoặc hỏi cụ thể về một cột."
            ),
            "answer_sources": [],
        }

    context_blocks = [f"[{i + 1}] (nguồn: {h.source})\n{h.text}" for i, h in enumerate(hits)]
    sources = [
        {
            "type": "profile_report",
            "doc_id": h.doc_id,
            "source": h.source,
            "score": round(h.score, 6),
            "profile_run_id": (h.metadata or {}).get("profile_run_id"),
            "dataset_name": (h.metadata or {}).get("dataset_name"),
        }
        for h in hits
    ]

    try:
        llm = get_llm()
        response = llm.invoke(
            [
                {"role": "system", "content": BASE_RULES + "\n\n" + QA_VECTOR_PROMPT},
                {
                    "role": "user",
                    "content": f"Câu hỏi: {question}\n\nNgữ cảnh:\n" + "\n\n".join(context_blocks),
                },
            ]
        )
        answer = str(response.content)
    except LLMNotConfiguredError as exc:
        answer = f"{exc}\n\nĐoạn báo cáo liên quan nhất:\n\n" + "\n\n".join(context_blocks)
    except Exception as exc:  # noqa: BLE001
        answer = f"Lỗi khi gọi LLM: {exc}\n\nĐoạn báo cáo liên quan nhất:\n\n" + context_blocks[0]

    get_audit().log(
        "qa_vector", profile_run_id=run_id, question=question[:200], hits=len(hits)
    )
    return {
        "answer": answer,
        "answer_sources": sources,
        "tool_calls": state.get("tool_calls", 0) + 1,
    }


__all__ = [
    "clarify_node",
    "classify_question_type",
    "qa_router_node",
    "qa_structured_node",
    "qa_vector_node",
]
