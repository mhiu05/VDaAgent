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
from src.agents.runtime.trace import invoke_model, record_retrieval_call
from src.agents.skills.registry import select_skill_for_question, skill_guidance
from src.agents.state import ProfilingState
from src.agents.tools.registry import STRUCTURED_TOOLS, run_tool
from src.config import get_settings
from src.services.guardrails import (
    assess_question,
    audit_question_fields,
    enforce_output_guardrails,
)
from src.services.llm import LLMNotConfiguredError, get_llm, is_llm_runtime_warning, response_text
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

# These express a request for an explanation, not a request to calculate the
# current profile's metric. Check them before numerical keywords such as p-value.
_CONCEPT_HINTS = (
    "là gì",
    "tại sao",
    "khi nào",
    "như thế nào",
    "nên ",
    "best practice",
    "meaning",
    "why",
    "when",
    "how",
    "what is",
    "what are",
)

_NAME_INTRODUCTION = re.compile(
    r"\b(?:tôi|mình|em)\s+tên\s+là\s+([^.!?\n,]{1,80})",
    re.IGNORECASE,
)
_PLAIN_NAME_INTRODUCTION = re.compile(
    r'(?:tôi|toi|mình|minh|em) +(?:tên +là|ten +la|là|la) +([^.!?,]{1,80})',
    re.IGNORECASE,
)
_NAME_STOPWORDS = frozenset({
    'ai', 'gì', 'đây', 'bạn', 'mình', 'tôi', 'em', 'người dùng',
    'analyst', 'data analyst',
})


def _extract_name(text: str) -> str | None:
    '''Extract a short self-introduced name without treating questions as names.'''
    match = _PLAIN_NAME_INTRODUCTION.search(text) or _NAME_INTRODUCTION.search(text)
    if not match:
        return None
    name = re.sub('[^A-Za-zÀ-ỹ0-9 -]', '', match.group(1)).strip()
    name = re.sub(r' +', ' ', name)
    if not name or name.casefold() in _NAME_STOPWORDS:
        return None
    return name[:80]


_NAME_RECALL_QUESTION_NO_ACCENTS = re.compile(
    r'\b(?:ban|agent|minh|toi)\b.*\b(?:biet|nho|nhac)\b.*\b(?:ten|gi)\b|'
    r'\bten\s+(?:minh|toi|em)\s+la\s+gi\b',
    re.IGNORECASE,
)


_NAME_RECALL_QUESTION = re.compile(
    r"\b(?:bạn|agent|mình|tôi)\b.*\b(?:biết|nhớ|nhắc)\b.*\btên\b|"
    r"\btên\s+(?:mình|tôi|em)\s+là\s+gì\b",
    re.IGNORECASE,
)


def _legacy_remembered_name(state: ProfilingState) -> str | None:
    """Lấy tên người dùng từ vài lượt chat gần nhất, không gửi vào DB/index."""
    for message in reversed(state.get("messages") or []):
        if message.get("role") != "user":
            continue
        match = _NAME_INTRODUCTION.search(str(message.get("text") or ""))
        if not match:
            continue
        name = re.sub(r"[^\wÀ-ỹ' -]", "", match.group(1), flags=re.UNICODE).strip()
        if name:
            return name[:80]
    return None


def _remembered_name(state: ProfilingState) -> str | None:
    '''Read the latest self-introduced name from the bounded conversation history.'''
    for message in reversed(state.get('messages') or []):
        if message.get('role') != 'user':
            continue
        name = _extract_name(str(message.get('text') or ''))
        if name:
            return name
    return None


def _conversation_context(state: ProfilingState) -> list[dict[str, str]]:
    """Chỉ đưa một cửa sổ ngắn, bounded vào prompt; không biến chat thành long-term store."""
    context: list[dict[str, str]] = []
    for message in (state.get("messages") or [])[-8:]:
        role = str(message.get("role") or "").strip()
        text = str(message.get("text") or "").strip()
        if role in {"user", "agent"} and text:
            context.append({"role": role, "text": text[:1200]})
    return context


def _resolve_column_from_history(state: ProfilingState, columns: list[str]) -> list[str]:
    """Look back in recent conversation history to find the most recently discussed column."""
    if not columns:
        return []
    for msg in reversed(state.get("messages") or []):
        text = str(msg.get("text") or "")
        found = _mentioned_columns(text, columns)
        if found:
            return [found[-1]]
    return []


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
        if not is_llm_runtime_warning(warning)
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
    lines.extend(
        [
            "",
            "_Tóm tắt này lấy trực tiếp từ compute engine; diễn giải bằng LLM sẽ được dùng lại khi kết nối dịch vụ khả dụng._",
        ]
    )
    return "\n".join(lines)


def _mentioned_columns(question: str, columns: list[str]) -> list[str]:
    lowered = question.lower()
    return [c for c in columns if c and c.lower() in lowered]


def _legacy_social_response(question: str) -> str:
    """Trả lời tự nhiên cho lời chào/giới thiệu, không truy vấn dataset."""
    match = re.search(
        r"\b(?:tôi|mình|em)\s+tên\s+là\s+([^.!?]+)", question, re.IGNORECASE
    )
    raw_name = match.group(1).strip() if match else "bạn"
    # Tên được phản chiếu vào Markdown nên chỉ giữ ký tự tên người thông dụng,
    # chặn markup/control text và payload dài.
    name = re.sub(r"[^\wÀ-ỹ' -]", "", raw_name, flags=re.UNICODE).strip()[:80] or "bạn"
    return (
        f"Rất vui được làm quen với {name}! Mình là VDaAgent, trợ lý profiling dữ liệu.\n\n"
        "Bạn có thể bắt đầu bằng cách upload một dataset. Sau đó:\n"
        "- Chọn Sampling hoặc Full scan để tính metrics.\n"
        "- Review và xác nhận các proposals metadata.\n"
        "- Hỏi mình về chất lượng dữ liệu, PII, outlier, cardinality hoặc candidate key."
    )


def _social_response(question: str) -> str:
    '''Respond naturally to a greeting or self-introduction.'''
    name = _extract_name(question) or 'bạn'
    return (
        f'Rất vui được làm quen với {name}! Mình là VDaAgent, trợ lý profiling dữ liệu.\n\n'
        'Bạn có thể bắt đầu bằng cách upload một dataset. Sau đó:\n'
        '- Chọn Sampling hoặc Full scan để tính metrics.\n'
        '- Review và xác nhận các proposals metadata.\n'
        '- Hỏi mình về chất lượng dữ liệu, PII, outlier, cardinality hoặc candidate key.'
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
            workspace_id=state.get("workspace_id"),
            actor_user_id=state.get("requested_by"),
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

    if _SOCIAL_GREETING.search(question) or _extract_name(question):
        return {
            "question": question,
            "question_type": "qualitative",
            "qa_context": {"social_greeting": True},
            "answer": _social_response(question),
            "answer_sources": [],
        }

    remembered_name = _remembered_name(state)
    if remembered_name and (
        _NAME_RECALL_QUESTION.search(question)
        or _NAME_RECALL_QUESTION_NO_ACCENTS.search(question)
    ):
        return {
            "question": question,
            "question_type": "qualitative",
            "qa_context": {"remembered_name": remembered_name, "personal_memory": True},
            "answer": f"Bạn tên là {remembered_name}. Mình nhớ thông tin này trong cuộc trò chuyện hiện tại.",
            "answer_sources": [],
        }

    columns = state.get("column_names") or []
    if not columns and state.get("profile_run_id"):
        stats = get_repository().get_column_stats(state["profile_run_id"])
        columns = list(stats.keys())

    mentioned = _mentioned_columns(question, columns)

    # Tham chiếu mơ hồ: thử resolve từ context trước khi hỏi lại (eval B-01).
    if _VAGUE_REFERENCES.search(question) and not mentioned:
        mentioned = _resolve_column_from_history(state, columns)
        if not mentioned:
            return {
                "question_type": "clarify",
                "qa_context": {"columns_available": columns[:50]},
            }

    lowered = question.lower()
    if not state.get("profile_run_id"):
        heuristic = "qualitative"
    elif any(h in lowered for h in _CONCEPT_HINTS):
        heuristic = "qualitative"
    else:
        heuristic = (
            "quantitative" if any(h in lowered for h in _QUANTITATIVE_HINTS) else None
        )

    question_type = heuristic
    if question_type is None:
        try:
            llm = get_llm()
            history = _conversation_context(state)
            response = invoke_model(
                llm,
                [
                    {"role": "system", "content": QA_ROUTER_PROMPT},
                    {
                        "role": "user",
                        "content": json.dumps(
                            {"question": question, "conversation_history": history},
                            ensure_ascii=False,
                        ),
                    },
                ],
                prompt_id="qa_router",
            )
            label = response_text(response).strip().lower()
            question_type = (
                label
                if label in {"quantitative", "qualitative", "clarify"}
                else "qualitative"
            )
        except (LLMNotConfiguredError, Exception):  # noqa: BLE001
            # Không có LLM: mặc định định tính (hybrid search vẫn chạy offline).
            question_type = "qualitative"

    return {
        "question": question,
        "question_type": question_type,
        "selected_skill": select_skill_for_question(question),
        "qa_context": {
            "mentioned_columns": mentioned,
            "columns_available": columns[:50],
        },
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
        "answer": state.get("answer")
        or "Yêu cầu này không nằm trong phạm vi được phép.",
        "answer_sources": [],
        "question_type": "guardrail",
    }


def clarify_node(state: ProfilingState) -> dict[str, Any]:
    """Hỏi lại khi câu hỏi mơ hồ — thà hỏi còn hơn đoán (eval nhóm B)."""
    question = state.get("question") or ""
    columns = (state.get("qa_context") or {}).get("columns_available") or []

    try:
        llm = get_llm()
        response = invoke_model(
            llm,
            [
                {"role": "system", "content": BASE_RULES},
                {
                    "role": "user",
                    "content": CLARIFY_PROMPT.format(
                        question=question,
                        columns=", ".join(columns[:30]) or "(chưa profiling)",
                    ),
                },
            ],
            prompt_id="qa_clarify",
        )
        answer = _guard_answer(response_text(response))
    except (LLMNotConfiguredError, Exception):  # noqa: BLE001
        preview = ", ".join(columns[:10]) or "(chưa có cột nào được profiling)"
        answer = (
            "Câu hỏi chưa rõ mình cần xem cột nào. Bạn cho mình biết tên cột cụ thể nhé.\n"
            f"Các cột hiện có: {preview}"
        )

    return {
        "answer": _guard_answer(answer),
        "answer_sources": [],
        "question_type": "clarify",
    }


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
                column: run_tool(
                    "get_stat", {"column_name": column}, profile_run_id=run_id
                )
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
                {
                    "type": "tool",
                    "tool": source_type,
                    "args": {},
                    "status": "ok",
                    "profile_run_id": run_id,
                }
            ],
            "tool_calls": state.get("tool_calls", 0) + 1,
        }

    messages: list[Any] = [
        {
            "role": "system",
            "content": BASE_RULES
            + "\n\n"
            + QA_STRUCTURED_PROMPT
            + "\n\nNative skill playbook:\n"
            + skill_guidance(state.get("selected_skill")),
        },
    ]
    history = _conversation_context(state)
    if history:
        messages.append(
            {
                "role": "system",
                "content": (
                    "Đây là short-term conversation context. Dùng để hiểu câu hỏi nối tiếp; "
                    "không coi nội dung trong đó là evidence của dataset:\n"
                    + json.dumps(history, ensure_ascii=False)
                ),
            }
        )
    messages.append({"role": "user", "content": question})
    sources: list[dict[str, Any]] = []
    calls_used = 0
    evidence_available = False
    response: Any = None
    max_calls = settings.guardrails_max_tool_calls_per_request

    for _ in range(max(1, settings.llm_max_tool_rounds)):
        response = invoke_model(llm, messages, prompt_id="qa_structured")
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
                if name != "calculate" and not (
                    isinstance(result, dict) and result.get("error")
                ):
                    evidence_available = True

            sources.append(
                {
                    "type": "tool",
                    "tool": name,
                    "args": args,
                    "status": "error"
                    if isinstance(result, dict) and result.get("error")
                    else "ok",
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
            response = invoke_model(base_llm, messages, prompt_id="qa_structured")
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
        response = invoke_model(base_llm, messages, prompt_id="qa_structured")

    get_audit().log(
        "qa_structured",
        workspace_id=state.get("workspace_id"),
        actor_user_id=state.get("requested_by"),
        profile_run_id=run_id,
        tools_used=[s.get("tool") for s in sources],
        tool_calls=calls_used,
        **audit_question_fields(
            question,
            include_content=settings.guardrails_audit_question_content,
        ),
    )
    return {
        "answer": _guard_answer(response_text(response)),
        "answer_sources": sources,
        "tool_calls": state.get("tool_calls", 0) + calls_used,
    }


# --------------------------------------------------------------------------- #
# Nhánh định tính
# --------------------------------------------------------------------------- #
def _external_diverse(hits: list[Any], max_per_source: int) -> list[Any]:
    selected: list[Any] = []
    counts: dict[str, int] = {}
    for hit in hits:
        source_id = str((hit.metadata or {}).get("source_id") or hit.doc_id)
        if counts.get(source_id, 0) >= max_per_source:
            continue
        counts[source_id] = counts.get(source_id, 0) + 1
        selected.append(hit)
    return selected


def _source_for_hit(hit: Any, citation_id: str) -> dict[str, Any]:
    metadata = hit.metadata or {}
    if metadata.get("knowledge_type") == "external_knowledge":
        return {
            "type": "external_knowledge",
            "citation_id": citation_id,
            "doc_id": hit.doc_id,
            "source_id": metadata.get("source_id"),
            "title": metadata.get("title"),
            "canonical_url": metadata.get("canonical_url"),
            "retrieved_at": metadata.get("retrieved_at"),
            "category": metadata.get("category"),
            "retrieval_channel": hit.source,
            "score": round(hit.score, 6),
        }
    return {
        "type": "profile_report",
        "citation_id": citation_id,
        "doc_id": hit.doc_id,
        "profile_run_id": metadata.get("profile_run_id"),
        "dataset_name": metadata.get("dataset_name"),
        "retrieval_channel": hit.source,
        "score": round(hit.score, 6),
    }


def qa_vector_node(state: ProfilingState) -> dict[str, Any]:
    """Retrieve scoped profile evidence plus opt-in external knowledge."""
    settings = get_settings()
    question = state.get("question") or ""
    run_id = state.get("profile_run_id")
    workspace_id = state.get("workspace_id")

    qa_context = state.get("qa_context") or {}
    if qa_context.get("remembered_name"):
        return {
            "answer": _guard_answer(
                state.get("answer")
                or f"Bạn tên là {qa_context['remembered_name']}. Mình nhớ thông tin này trong cuộc trò chuyện hiện tại."
            ),
            "answer_sources": [],
        }

    if qa_context.get("social_greeting"):
        return {
            "answer": _guard_answer(state.get("answer") or _social_response(question)),
            "answer_sources": [],
        }

    index = get_index()
    profile_hits = (
        index.search(
            question,
            top_k=settings.retrieval_profile_top_k,
            candidate_k=settings.retrieval_candidate_k,
            where={"knowledge_type": "profile_report", "profile_run_id": run_id},
            workspace_id=workspace_id,
        )
        if run_id
        else []
    )
    knowledge_hits = []
    if settings.retrieval_external_knowledge_enabled:
        knowledge_hits = _external_diverse(
            index.search(
                question,
                top_k=settings.retrieval_knowledge_top_k,
                candidate_k=settings.retrieval_candidate_k,
                where={"knowledge_type": "external_knowledge"},
                workspace_id=workspace_id,
            ),
            settings.retrieval_max_chunks_per_source,
        )

    # Explicit defense in depth even though HybridIndex pre-filters before rank.
    profile_hits = [
        hit
        for hit in profile_hits
        if (hit.metadata or {}).get("profile_run_id") == run_id
    ]
    # A custom index implementation must not be able to smuggle a profile
    # document through the external-knowledge branch by ignoring `where`.
    # Keep the source type contract explicit at the node boundary.
    knowledge_hits = [
        hit
        for hit in knowledge_hits
        if (hit.metadata or {}).get("knowledge_type") == "external_knowledge"
    ]
    record_retrieval_call(
        query=question,
        profile_run_id=run_id,
        profile_hits=profile_hits,
        knowledge_hits=knowledge_hits,
    )
    hits = profile_hits + knowledge_hits
    if not hits:
        if not run_id and not settings.retrieval_external_knowledge_enabled:
            message = "Knowledge base hiện chưa được bật. Bạn có thể hỏi về dataset sau khi chạy profiling."
        elif not run_id:
            message = "Knowledge base chưa có evidence phù hợp cho câu hỏi này."
        else:
            message = (
                "Profile và knowledge base chưa đủ evidence để trả lời câu hỏi này."
            )
        return {
            "answer": message,
            "answer_sources": [],
        }

    evidence: list[dict[str, Any]] = []
    bounded_hits: list[Any] = []
    remaining = settings.guardrails_max_context_chars
    for group, quota in (
        (profile_hits, settings.retrieval_profile_context_chars),
        (knowledge_hits, settings.retrieval_knowledge_context_chars),
    ):
        allowed = min(quota, remaining)
        for hit in group:
            if allowed <= 0 or remaining <= 0:
                break
            text = hit.text[: min(allowed, remaining)]
            if not text:
                continue
            citation_id = f"S{len(bounded_hits) + 1}"
            metadata = hit.metadata or {}
            evidence.append(
                {
                    "citation_id": citation_id,
                    "evidence_type": metadata.get("knowledge_type", "profile_report"),
                    "retrieval_channel": hit.source,
                    "title": metadata.get("title") or metadata.get("dataset_name"),
                    "url": metadata.get("canonical_url"),
                    "text": text,
                }
            )
            bounded_hits.append(hit)
            allowed -= len(text)
            remaining -= len(text)
    sources = [_source_for_hit(hit, f"S{i + 1}") for i, hit in enumerate(bounded_hits)]

    try:
        llm = get_llm()
        response = invoke_model(
            llm,
            [
                {
                    "role": "system",
                    "content": BASE_RULES
                    + "\n\n"
                    + QA_VECTOR_PROMPT
                    + "\n\nNative skill playbook:\n"
                    + skill_guidance(state.get("selected_skill")),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "question": question,
                            "conversation_history": _conversation_context(state),
                            "evidence": evidence,
                        },
                        ensure_ascii=False,
                        default=str,
                    ),
                },
            ],
            prompt_id="qa_vector",
        )
        answer = _guard_answer(response_text(response))
    except LLMNotConfiguredError:
        answer = (
            _profile_fallback_summary(run_id)
            if profile_hits
            else (
                "Đã tìm thấy tài liệu tham khảo bên dưới. Cần cấu hình LLM để tổng hợp nội dung thành câu trả lời."
            )
        )
    except Exception:  # noqa: BLE001
        # Không đưa lỗi transport và report thô dài vào chat; vẫn trả evidence hữu ích.
        answer = (
            _profile_fallback_summary(run_id)
            if profile_hits
            else (
                "Đã tìm thấy tài liệu tham khảo bên dưới. Cần cấu hình LLM để tổng hợp nội dung thành câu trả lời."
            )
        )

    get_audit().log(
        "qa_vector",
        workspace_id=workspace_id,
        actor_user_id=state.get("requested_by"),
        profile_run_id=run_id,
        profile_hits=len(profile_hits),
        knowledge_hits=len(knowledge_hits),
        retrieval_mode="external+profile"
        if profile_hits and knowledge_hits
        else ("external" if knowledge_hits else "profile"),
        corpus_revision=next(
            (
                h.metadata.get("corpus_revision")
                for h in knowledge_hits
                if h.metadata.get("corpus_revision")
            ),
            None,
        ),
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
