# Plan

Tích hợp LangSmith như lớp observability và experimentation bổ sung cho các luồng
AI, trong khi PostgreSQL vẫn là nguồn sự thật cho `agent_run`, audit, evidence và
provenance của sản phẩm. Kế hoạch ưu tiên privacy-by-default, liên kết được trace
ngoài với `agent_run_id`, rồi xây evaluation theo thứ tự deterministic gate trước,
LLM-as-judge sau để phù hợp nguyên tắc evidence-first của VDaAgent.

## Scope

- In: trace cho LangGraph profiling, Q&A, chart planner và các model/tool/retrieval
  call liên quan; cấu hình theo môi trường, redaction/sampling/correlation; bộ dữ
  liệu eval không chứa dữ liệu tenant; offline experiment, online monitoring,
  human feedback, CI gate, rollout và runbook vận hành.
- Out: thay PostgreSQL trace/audit/evidence bằng LangSmith; gửi raw row, PII,
  secret, system prompt, chain-of-thought hoặc nội dung tenant chưa được phê duyệt
  ra SaaS; chuyển prompt sang LangSmith Hub; bật planner autonomy, verifier
  `enforce`, durable jobs hay thay đổi kết quả deterministic của Profile Run.

## Action items

[ ] Chốt contract observability và data classification trước khi code: giữ
`agent_runs`/`agent_trace_events`/`model_invocations`/`tool_invocations` trong
PostgreSQL là authoritative, còn LangSmith là projection có thể mất mà không làm
request thất bại; lập allow-list chỉ gồm loại run, trạng thái, prompt
id/version/hash, model/provider, tool name, token/latency, số evidence, cờ
approximate/fallback và mã lỗi đã sanitize; dùng `agent_run_id` làm correlation
key, hash `workspace_id`/resource binding và không gửi `actor_user_id` hoặc natural
language ở production mặc định.

[ ] Bổ sung dependency và cấu hình server-side tại `requirements.txt`,
`backend/src/config.py`, `config.yaml` và `.env.example`: khai báo trực tiếp phiên
bản `langsmith` tương thích, `LANGSMITH_TRACING=false`, API key, endpoint,
workspace, project theo `development`/`staging`/`production`, chế độ dữ liệu
`metadata_only|sanitized_content`, sampling rate và flush timeout; không tạo bất kỳ
biến `NEXT_PUBLIC_*` nào cho LangSmith, giữ tracing tắt trong `tests/conftest.py`,
và fail-open độc lập với `AGENT_TRACE_MODE=required` để sự cố SaaS không chặn luồng
evidence nội bộ.

[ ] Tạo adapter tập trung, dự kiến
`backend/src/agents/runtime/langsmith_observability.py`, để khởi tạo client một lần,
kiểm tra health/config, gắn project/tags/metadata và áp dụng allow-list transformer
cho inputs, outputs lẫn metadata; tái sử dụng `redact_trace_payload` nhưng không dựa
vào deny-list đơn thuần. Production dùng `metadata_only`; chỉ project eval với dữ
liệu synthetic mới được dùng `sanitized_content`. Viết unit test chứng minh token,
prompt/message/content, đường dẫn, raw row, top values và PII canary không xuất hiện
trong payload trước network theo các cơ chế
[mask input/output](https://docs.langchain.com/langsmith/mask-inputs-outputs) và
[conditional tracing](https://docs.langchain.com/langsmith/conditional-tracing)
của SDK.

[ ] Instrument một root trace cho mỗi `agent_run` trong
`backend/src/agents/runtime/trace.py`, rồi truyền context qua
`backend/src/api/routes.py` và `backend/src/api/analysis_routes.py` để bao trọn cả
`asyncio.to_thread`, resume HITL và SSE completion; dùng UUID tương thích của
`agent_run_id` làm LangSmith root run ID nếu SDK cho phép, nếu không thì lưu mapping
nullable `langsmith_trace_id` bằng migration. Gắn `run_type`, runtime/policy version,
prompt hash, model, scan mode, question type, planning mode và environment; dùng
auto-instrumentation LangGraph/LangChain cho node/model child runs, chỉ thêm manual
span cho boundary chưa phải Runnable như retrieval, registered tool, output
guardrail và rules fallback để tránh trace trùng lặp.

[ ] Kiểm tra coverage và semantics cho từng bề mặt AI: profiling phải tách compute
deterministic khỏi semantic refine/narrative; Q&A phải thấy router, retrieval hoặc
tool trajectory, evidence count, guardrail và response status; chart planner phải
thấy structured-output validation và backend-normalized plan. Lỗi model dẫn đến
rules fallback được ghi là child error nhưng root business run vẫn thành công với
`planning_mode=rules_fallback`; `awaiting_approval`, resume, client ngắt SSE,
timeout/rate-limit và trace export lỗi phải có terminal state đúng ở cả PostgreSQL
và LangSmith. Thêm integration test với fake LangSmith client để xác minh quan hệ
parent/child, correlation, exactly-one terminal event và không thay đổi API output.

[ ] Xây các dataset offline có version/split trong `tests/evals/fixtures/` và đồng
bộ lên LangSmith bằng script idempotent: (1) router/clarification/guardrail đa ngôn
ngữ; (2) structured Q&A với expected tool, metric, đơn vị, approximate flag và
Official evidence; (3) retrieval Q&A với expected citation, conflict, insufficient
evidence và prompt injection; (4) semantic-type/profile narrative với statistics
golden; (5) chart planner với allowed columns, analysis kind, forecast contract và
expected fallback. Chỉ dùng dataset synthetic hoặc production failure đã được
review/redact thủ công, gắn version, `train|dev|test|security|regression` split và
không đưa ID thật của workspace/dataset vào LangSmith.

[ ] Cài evaluator theo scorecard evidence-first: code evaluator chấm schema/allow-list,
router accuracy, required-tool use, tool budget, numeric equality với deterministic
reference, unit/approximation preservation, citation existence/precision,
evidence binding, planner validity, fallback availability, secret/PII leakage và
prompt-injection resistance; LLM-as-judge chỉ chấm relevance, groundedness,
clarity/limitation trên evidence synthetic đã cấp và phải trả score kèm rationale
có cấu trúc. Hiệu chỉnh judge với annotation queue do Analyst review, dùng pairwise
comparison khi đổi prompt/model và không để một judge score chủ quan tự mình quyết
định release; hard gate là 0 leak/cross-workspace/unsupported numeric claim và
100% schema/evidence/allow-list security cases, còn quality threshold được chốt sau
baseline rồi chỉ được ratchet hoặc cho phép regression nhỏ đã định trước.

[ ] Tạo runner `scripts/run_langsmith_evals.py` dùng `aevaluate()` và target adapter
gọi đúng graph/service production trên test database riêng, fixed fixtures và
retrieval index cố định; lưu experiment metadata gồm git SHA, runtime/policy
version, prompt id/hash, model/provider, temperature, tool registry hash,
retrieval model/index version và dataset version. Bổ sung unit test offline cho
evaluator, integration test có fake LLM/client, cùng lệnh `--dry-run`, chọn
dataset/split, concurrency, repetitions và budget để tái lập thí nghiệm mà không
chạm database development/production; tham chiếu quy trình
[offline evaluation](https://docs.langchain.com/langsmith/evaluate-llm-application)
và chỉ dùng pytest tracking cho suite nhỏ cần hiển thị trực tiếp trong CI.

[ ] Đưa evaluation vào pipeline theo ba tầng: PR chạy lint/unit/security evaluator
không network và eval smoke cho prompt/module bị đổi; nightly chạy full dataset với
model thật, nhiều repetition và so sánh experiment baseline; staging/release chạy
regression suite bắt buộc trước promote. Pipeline phải fail khi vi phạm hard gate,
vượt budget/latency đã đặt hoặc quality giảm quá ngưỡng, xuất URL experiment và
score summary nhưng không log API key/payload; model/provider outage được báo là
`infra_error`, không bị tính nhầm thành chất lượng thấp, và không được coi job bị
skip vì thiếu secret là đã pass.

[ ] Roll out theo `off -> staging shadow 100% -> production sampled` với project
tách theo môi trường: production bắt đầu 5–10% trace metadata-only, còn PostgreSQL
vẫn giữ trace redacted 100%; dùng
[trace sampling](https://docs.langchain.com/langsmith/sample-traces) và online code
evaluator cho error/fallback rate, latency/token budget, missing evidence,
citation/guardrail flags; chỉ bật sampled online LLM judge nếu privacy review cho
phép nội dung đã sanitize. Thêm thumbs up/down và lý do có taxonomy ở Q&A UI, gửi
qua backend authenticated rồi liên kết feedback với trace thay vì lộ LangSmith key
cho browser; lập dashboard/alert, retention/deletion/RBAC/cost budget, kill switch,
flush-on-shutdown và runbook chuyển trace xấu đã review thành regression case theo
vòng lặp [offline/online evaluation](https://docs.langchain.com/langsmith/evaluation).

## Open questions

- Dự án được phép dùng LangSmith SaaS (US/EU) hay cần hybrid/self-hosted, và retention
  tối đa cho trace/eval dataset là bao lâu?  Trả lời: Dùng US, còn lại bạn thấy hợp lý là được
- Production có được gửi question/answer đã redact ra LangSmith không, hay phải giữ
  tuyệt đối `metadata_only` và chỉ đánh giá nội dung trên synthetic/staging data? Trả lời: Bạn thấy hợp lý là được
- Model nào sẽ làm judge, ngân sách eval theo tháng và ai có quyền phê duyệt baseline
  mới khi đổi prompt/model/retrieval index? Trả lời: Mình dùng gemini-3.6-flash
