# Kiến trúc hệ thống Agent, QA, retrieval và evidence

## Đồ thị profiling

LangGraph trong [`backend/src/agents/graph.py`](../../backend/src/agents/graph.py) chạy:

```text
ingest → compute_stats → propose_metadata → hitl_review
  ├─ reject/edit → propose_metadata
  ├─ request_test → deep_analysis → hitl_review
  └─ confirm → summarize → (optional QA) → finalize
```

`hitl_review` có thể interrupt graph. Với `config.yaml` hiện tại, chỉ semantic-type proposal thuộc nhóm rủi ro thấp và có thể auto-confirm khi đạt confidence threshold; candidate key và PII vẫn chờ Analyst. Settings chưa enforce allow-list cho `HITL_LOW_RISK_TYPES`, nên cấu hình sai có thể mở auto-confirm cho loại khác. Confirm endpoint resume persisted thread bằng `Command`. Deep analysis và hoạt động model/tool có budget giới hạn.

## Luồng định tuyến QA

`POST /api/v1/qa` và `/qa/stream` nhận question tối đa 2.000 ký tự và tối đa 20 history message, mỗi message tối đa 2.000 ký tự. Router hiện chỉ chuyển 12 message cuối vào graph. Router phân loại quantitative, qualitative, clarification và guardrail. Câu quantitative dùng structured tool đã đăng ký với profile run được server inject; model chỉ diễn giải tool output, không tự phát sinh số. Câu qualitative dùng profile retrieval index và chỉ dùng external knowledge khi flag/provider cho phép. Chart insight phải trích dẫn Official analysis execution.

Prompt injection, yêu cầu credential và raw PII exfiltration bị block trước model/tool call. Answer được redact và truncate theo guardrail setting. Mặc định audit chỉ lưu question hash/length, không lưu nội dung câu hỏi.

## Truy xuất

`retrieval_documents` trong PostgreSQL làm nền cho hybrid sparse/dense index. Embedding có thể local, OpenAI, Voyage hoặc disabled; sparse retrieval vẫn hoạt động khi embedding provider không khả dụng. Profile/report document có workspace scope và, khi phù hợp, profile-run scope; external-knowledge document có thể global với `workspace_id` null. External knowledge phụ thuộc configuration và corpus đã index, không đảm bảo network/provider luôn khả dụng.

## Dấu vết và an toàn của evidence

Runtime schema trong [`backend/src/agents/runtime/schemas.py`](../../backend/src/agents/runtime/schemas.py) tách agent run, step, invocation, evidence và trace event. Trace persistence redact sensitive key, giới hạn depth/string size và không lưu raw prompt, raw model message, raw row, secret hoặc result payload không giới hạn. Trace mode là `off`, `shadow`, `required`; lỗi ở `shadow` không làm request fail, còn `required` thì có.

Canonical evidence chứa workspace/profile/context/execution/artifact identifier, source hash/version, approximation và limitation, cùng invocation tạo ra nó. Agent route được scope theo workspace.

## Vị trí source code và kiểm chứng

- Graph/node: [`backend/src/agents/graph.py`](../../backend/src/agents/graph.py), [`qa_nodes.py`](../../backend/src/agents/nodes/qa_nodes.py).
- Guardrail và tool: [`backend/src/services/guardrails.py`](../../backend/src/services/guardrails.py) và agent tool module.
- Trace: [`backend/src/agents/runtime/trace.py`](../../backend/src/agents/runtime/trace.py).
- API contract: [`backend/src/models/schemas.py`](../../backend/src/models/schemas.py) và [`backend/src/api/agent_routes.py`](../../backend/src/api/agent_routes.py).
