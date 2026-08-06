# Plan

Xây dựng AI Data Profiling Agent trong `backend/src/agents/` như một subsystem có contract rõ ràng, checkpoint bền vững và eval đo được. Compute engine là nguồn duy nhất tạo metric; LLM chỉ phân loại, đề xuất metadata và diễn giải evidence đã kiểm chứng, với deterministic fallback để hệ thống vẫn hoạt động an toàn khi model, embedding hoặc network không khả dụng.

Tài liệu nền: [project_context.md](./project_context.md), [ADR_v1.md](./ADR/ADR_v1.md), [agent_architecture.md](./architecture/agent_architecture.md), [backend-plan.md](./backend-plan.md), [frontend-plan.md](./frontend-plan.md).

## Scope

- In: typed state, LangGraph orchestration, ingest/compute tools, evidence-first proposals, HITL interrupt/resume, statistical analysis, narrative, quantitative QA, hybrid retrieval, model gateway, guardrails, checkpoint, evaluation và observability.
- Out: REST/SSE/auth transport; frontend state/rendering; tự động clean/transform production data; model training/fine-tuning trước khi có eval corpus; connector ngoài file và database adapter được phê duyệt.
- Dependency: backend truyền immutable run context, identity và policy; agent chỉ truy cập data/repository qua allow-listed ports; worker chịu execution, timeout và cancellation; frontend không gọi graph hoặc tool trực tiếp.
- Invariants: LLM không tạo/sửa metric; candidate key và PII không auto-confirm; proposal luôn có confidence + evidence + method/version; sampled metric luôn có uncertainty; answer phải có source hoặc tuyên bố thiếu evidence; raw PII không đi vào prompt, log, index hay export.

## Action items

- [ ] **P0 — Chốt public contract, state và lifecycle invariant.** Chuẩn hóa `ProfilingState`, `QAState`, command/event/result schemas trong `backend/src/agents/state.py`; tách persisted state khỏi dataframe/transient handles, định nghĩa reducer, default, schema version và terminal state. Public facade chỉ expose `start_profile`, `resume_profile`, `cancel_profile`, `get_status`, `answer` và `stream_answer`; thêm compatibility/migration logic để checkpoint cũ không làm crash worker sau deploy.

- [ ] **P0 — Hoàn thiện ingest và compute deterministic.** Tách I/O khỏi graph node qua ports trong `backend/src/services/compute.py` và tools allow-list; hỗ trợ CSV/TSV/Parquet/JSON, full scan và sampling có `random_seed`. Tính row/column count, null/cardinality/top-k, numeric/string/datetime summaries, quantile, outlier, distribution và correlation bằng DuckDB/pandas/NumPy/SciPy; lưu engine version, source checksum, executed query/plan, sample strategy, `is_approximate`, confidence interval hoặc margin of error để tái lập.

- [ ] **P0 — Xây metadata proposal evidence-first và privacy-safe.** Kết hợp schema/name rules, regex, statistical heuristics và optional LLM cho candidate key, semantic type, PII/quasi-identifier; calibrate confidence theo labeled fixtures thay vì gán tay tùy ý. Chỉ gửi schema, aggregates và masked/redacted examples; validate structured output, chống prompt injection trong dataset/column names, loại raw value khỏi evidence và fallback hoàn toàn deterministic khi provider timeout, quota, malformed output hoặc safety refusal.

- [ ] **P0 — Dựng LangGraph HITL bền vững và idempotent.** Hoàn thiện graph `ingest → compute_stats → propose_metadata → pending_review → deep_analysis/summarize`, conditional routes và loop caps; dùng PostgreSQL checkpointer production, memory/SQLite chỉ cho test/local. Mọi node ghi event idempotent theo `run_id + node + attempt`, hỗ trợ resume sau process restart, cancellation, stale command rejection và concurrent reviewer conflict; tiered review chỉ auto-confirm semantic type low-risk đạt policy threshold, có audit reason.

- [ ] **P0 — Chuẩn hóa model gateway và prompt governance.** Đóng gói provider/model/temperature/timeout/retry/token budget/structured output trong một interface; model name và prompt template đều có version, traceable tới run. Thêm circuit breaker, exponential backoff có jitter, fallback model hoặc deterministic mode, redaction trước telemetry và cost/token accounting; không fine-tune trước khi prompt+retrieval baseline được đánh giá trên golden set và chứng minh còn khoảng trống ổn định.

- [ ] **P0 — Hoàn thiện deep analysis và narrative có căn cứ.** Kết nối allow-listed statistical tests, validate data assumptions, giới hạn số test/lượt lặp, hiệu chỉnh multiple comparisons và lưu statistic, raw/adjusted p-value, effect size, confidence interval, alpha, assumptions, conclusion và requester. Chỉ summarize sau review hợp lệ; narrative phân biệt observation với interpretation, exact với approximate, trích source id cho từng kết luận định lượng và dùng deterministic template khi LLM không sẵn sàng.

- [ ] **P0 — Xây QA định lượng zero-hallucination.** Dùng rule-first intent/entity resolver; chuyển `clarify` khi thiếu run, column, metric, unit hoặc comparison target. Structured branch chỉ gọi typed tools đọc repository, không cho model viết arbitrary SQL; formatter chèn value/precision/unit/uncertainty trực tiếp từ tool result và khóa số khỏi bước diễn giải. Mỗi `answer_source` phải chứa `profile_run_id`, record/column, metric, value, approximation marker và provenance version.

- [ ] **P1 — Nâng QA định tính lên hybrid retrieval production.** Tạo tài liệu từ profile digest, reviewed metadata, narrative, test và drift; chunk theo semantic record, version theo run và loại PII trước index. Dev có thể dùng BM25 + local dense index; production ưu tiên PostgreSQL full-text + pgvector để đồng bộ lifecycle/tenant filter/persistence, merge sparse-dense bằng rank fusion và optional cross-encoder rerank. Đo recall@k, MRR/nDCG, citation precision và dùng sparse-only fallback khi embedding/reranker lỗi.

- [ ] **P0 — Thêm guardrails, observability và evaluation harness.** Giới hạn file size/column count, tool calls, deep-analysis loops, prompt/context size, wall time, retry và concurrent jobs; phân loại retryable/non-retryable errors. Ghi OpenTelemetry span/event cho node start/end, route, latency, model/tool usage, fallback và policy violation với redaction; xây golden datasets cho metric accuracy, proposal precision/recall, QA exact match/citation, PII leakage, prompt injection và deterministic reproducibility.

- [ ] **P0 — Nghiệm thu và rollout agent theo quality gates.** Chạy unit/property/integration/graph-restart/adversarial tests trong `tests/test_agents/` và `tests/test_services/`, smoke offline và provider-enabled, cùng load test worker/checkpointer. Chỉ phát hành khi metric deterministic khớp oracle trong tolerance, quantitative QA khớp repository 100%, không raw PII trong prompt/trace/index/answer/export fixtures, resume/cancel sống qua restart, mọi answer có citation/insufficient-evidence marker và model upgrade không làm regression vượt ngưỡng eval đã chốt.

## Open questions

- Production retrieval dùng PostgreSQL full-text + pgvector ngay từ đầu hay giữ FAISS/BM25 đến khi corpus vượt ngưỡng benchmark?
- Provider/model nào được phép xử lý metadata doanh nghiệp, và yêu cầu data residency/retention của provider là gì?
- SLO và giới hạn dataset nào áp dụng cho full scan, sampling và thời gian chờ HITL trước khi checkpoint được archive?
