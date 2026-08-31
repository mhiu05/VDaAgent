# QA và evidence

## API

`POST /api/v1/qa` trả answer JSON hoàn chỉnh. `POST /api/v1/qa/stream` trả SSE cho cùng pipeline có kiểm soát. Request có question (1–2.000 ký tự), `profile_run_id` tùy chọn, tối đa 20 history message (mỗi message 1–2.000 ký tự), `analysis_execution_id` tùy chọn, workspace-context version tùy chọn và response mode (`default` hoặc `chart_insight`). Sau khi validate, router chỉ chuyển 12 history message cuối vào graph.

## Định tuyến và guardrail

QA graph phân loại request và chọn guardrail, clarification, structured-tool hoặc retrieval route mang tính deterministic. Quantitative question gọi tool đã đăng ký với profile scope được server inject; model nhận tool result để diễn giải, không được issue arbitrary SQL/Python. Qualitative question lấy profile document và chỉ dùng external knowledge khi flag/provider cho phép. Chart insight phải yêu cầu Official execution được trích dẫn.

Prompt injection, yêu cầu credential và raw-PII exfiltration bị block trước model/tool call. Answer được redact và truncate theo guardrail setting. Mặc định audit lưu question hash/length, không lưu nội dung.

## Hợp đồng evidence

Source được phân loại là `profile_report`, `external_knowledge` hoặc `tool`. Response có `evidence_status`:

- `verified` — dựa trên execution/tool đủ điều kiện hoặc source đã xác minh;
- `profile_only` — dựa trên profile fact đã lưu nhưng không có Official execution mới;
- `no_evidence` — clarification, refusal hoặc chưa có evidence đủ.

`is_approximate`, `context_version_id`, `analysis_execution_id` và `profile_run_id` cho biết answer dựa trên dữ liệu nào. Agent runtime cũng lưu redacted trace và canonical evidence record.

## Vị trí source code và kiểm chứng

- Node/router: [`backend/src/agents/nodes/qa_nodes.py`](../../backend/src/agents/nodes/qa_nodes.py).
- Guardrail: [`backend/src/services/guardrails.py`](../../backend/src/services/guardrails.py).
- Retrieval: [`backend/src/services/retrieval.py`](../../backend/src/services/retrieval.py).
- Contract: [`backend/src/models/schemas.py`](../../backend/src/models/schemas.py).
- API/UI: [`backend/src/api/routes.py`](../../backend/src/api/routes.py), [`frontend/src/app/chat/page.tsx`](../../frontend/src/app/chat/page.tsx).
- Test: tìm trong `tests/` với `qa`, `guardrail`, `evidence`, `retrieval` và `stream`.

Xem [Agent system](../architecture/agent-system.md) và [phân tích có giới hạn](../architecture/bounded-execution.md).
