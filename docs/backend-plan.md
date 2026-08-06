# Plan

Xây dựng backend production-grade như ranh giới tin cậy giữa Next.js frontend, AI agent và data layer. Quyết định đề xuất là giữ FastAPI cho API/control plane vì phù hợp trực tiếp với Pydantic, LangGraph và Python data stack; hiệu năng được tối ưu bằng cách tách profiling dài sang worker, chuẩn hóa I/O bất đồng bộ và PostgreSQL, chỉ chuyển sang Litestar nếu benchmark tải thực tế chứng minh lợi ích đủ lớn mà không làm suy giảm contract hoặc độ ổn định.

Tài liệu nền: [project_context.md](./project_context.md), [ADR_v1.md](./ADR/ADR_v1.md), [agent_architecture.md](./architecture/agent_architecture.md), [agent-plan.md](./agent-plan.md), [frontend-plan.md](./frontend-plan.md).

## Scope

- In: modular backend trong `backend/src/`, REST/OpenAPI, SSE, upload, lifecycle của profile run, HITL, test/drift/export/QA, PostgreSQL persistence, background jobs, OIDC/JWT, RBAC, rate limit, audit, observability, migration, test và deployment.
- Out: component giao diện trong `frontend/`; thuật toán metric, prompt và retrieval nội bộ của agent; ETL/cleaning dữ liệu; enterprise connector ngoài CSV/TSV/Parquet/JSON trong giai đoạn đầu.
- Dependency: agent cung cấp interface `start/resume/status/cancel/answer/stream`; frontend chỉ dùng generated API client từ OpenAPI; PostgreSQL là source of truth cho metadata, job state, audit reference và checkpoint production.
- Technology decision: FastAPI tiếp tục là baseline; Litestar là ứng viên benchmark, Django Ninja chỉ phù hợp nếu cần Django Admin/ORM, còn NestJS không được ưu tiên vì tạo thêm biên TypeScript–Python quanh LangGraph/compute mà không giảm chi phí xử lý dữ liệu.

## Action items

- [ ] **P0 — Chốt ADR backend và tiêu chí đổi framework.** Cập nhật ADR-008 bằng decision matrix cho FastAPI, Litestar, Django Ninja và NestJS theo các tiêu chí OpenAPI fidelity, Pydantic compatibility, SSE/cancellation, dependency injection, middleware, ecosystem, vận hành và migration cost. Benchmark upload nhỏ, profile job submission, GET profile và 100 SSE connections; chỉ migrate trước khi mở rộng API nếu ứng viên cải thiện có ý nghĩa trên p95 latency/RAM trong khi toàn bộ contract test và security test vẫn pass.

- [ ] **P0 — Chuẩn hóa modular monolith trong `backend/src/`.** Tách `api/` (routers/dependencies/middleware), `domain/` (entities, lifecycle, domain errors), `application/` (use cases/ports), `infrastructure/` (SQLAlchemy, storage, queue, audit, LLM adapters) và `agents/` (LangGraph public facade); loại bỏ import ngược từ domain vào FastAPI/SQLAlchemy. Giữ một composition root trong `backend/src/main.py`, settings typed trong `backend/src/config.py` và không để frontend asset trong backend sau cutover.

- [ ] **P0 — Chốt API contract và lifecycle nhất quán.** Giữ prefix `/api/v1`; chuẩn hóa resource cho dataset, upload, profile run, proposal decision, statistical test, drift report, export, QA và status. Dùng trạng thái `created/queued/running/pending_review/resuming/completed/failed/cancelled`, UTC ISO-8601, cursor pagination, `version`, `Idempotency-Key`, `ETag/If-Match`, correlation id và RFC 9457-style problem details; generate OpenAPI ổn định bằng explicit `operationId` để frontend sinh client không bị breaking ngầm.

- [ ] **P0 — Hoàn thiện persistence và migration production.** Dùng SQLAlchemy 2 + Alembic với PostgreSQL production, SQLite chỉ cho local/unit test; model hóa Dataset, DatasetVersion, ProfileRun, ColumnStat, Proposal, ReviewDecision, StatisticalTestResult, DriftReport, ExportArtifact, Job và AuditEvent. Bổ sung foreign key, unique/check constraint, transaction boundary, optimistic locking, outbox/job handoff và migration test upgrade/downgrade trên PostgreSQL; định nghĩa backup, PITR, retention và quy trình xóa dữ liệu có kiểm soát.

- [ ] **P0 — Tách long-running work khỏi HTTP process.** `POST /profiles` chỉ chạy đồng bộ dưới ngưỡng cấu hình; job lớn trả `202 Accepted` cùng `run_id`, `status_url` và retry-safe idempotency. Đưa ingest/compute/agent execution vào worker pool có queue bền vững, timeout, cancellation, retry có jitter, dead-letter handling, concurrency quota theo tenant và graceful shutdown; API không giữ dataframe hoặc CPU-heavy task trong event loop.

- [ ] **P0 — Xây upload và dataset storage an toàn.** Stream upload theo chunk vào object/local storage adapter, sanitize filename, khóa path traversal/symlink, kiểm tra extension + MIME + magic bytes, quota dung lượng/cột, checksum SHA-256, duplicate detection, malware-scan hook và cleanup file dở dang. Production không nhận arbitrary server path; dùng opaque `dataset_id/version_id`, presigned URL nếu chuyển object storage và luôn audit upload/download/delete.

- [ ] **P0 — Hoàn thiện auth, authorization và privacy boundary.** Thay shared token production bằng OIDC/OAuth2 JWT validation; định nghĩa role `viewer/analyst/admin` và resource-level access cho dataset/run. Không tin `confirmed_by` từ body mà lấy từ identity; áp dụng CORS allow-list, trusted hosts, secure headers, request/body limits, distributed rate limiting, secret redaction, PII masking, fail-closed export và policy test cho cross-tenant access, replay, token expiry và privilege escalation.

- [ ] **P0 — Tích hợp agent/HITL theo public service contract.** Backend gọi duy nhất `AgentService.start_profile`, `resume_profile`, `cancel_profile`, `answer` và `stream_answer`; map lỗi ingest/compute/provider thành domain errors không lộ stack/secret. Review confirm/reject/edit phải atomic, kiểm tra proposal thuộc run, role reviewer, `final_type`, version/idempotency; ghi audit + outbox trước resume và trả `409` khi concurrent review hoặc stale version.

- [ ] **P1 — Hoàn thiện test, drift, export và QA streaming.** Validate allow-list test, số test tối đa, alpha và multiple-comparison method; drift chỉ so sánh compatible dataset versions. Export tạo artifact metadata-only đã mask, có checksum/provenance/expiry và audit. SSE chuẩn hóa event `meta/token/source/heartbeat/done/error`, headers chống buffering/cache, backpressure, disconnect cancellation và invariant đúng một terminal event; WebSocket chỉ cân nhắc khi có use case bidirectional thực sự.

- [ ] **P0 — Nghiệm thu security, reliability và deployment.** Thêm unit/domain/repository/API contract/integration/load tests cho malformed payload, upload abuse, rollback, idempotency, concurrent HITL, restart checkpoint, PII leak, SSE ordering/disconnect và PostgreSQL parity. Chạy `pytest`, `ruff`, `mypy`, Alembic migration check, OpenAPI breaking-change check và smoke test; đóng gói container non-root với health/readiness, migration job riêng, OpenTelemetry traces/metrics/logs, SLO cho API/job latency/error rate và rollback runbook trước production.

## Open questions

- Production dùng OIDC provider nào và mapping group nào tương ứng `viewer/analyst/admin`?
- Job queue dùng Redis-based worker cho giai đoạn đầu hay RabbitMQ ngay từ production để ưu tiên delivery durability?
- Ngưỡng kích thước/thời gian nào bắt buộc chuyển profile request từ synchronous `201` sang asynchronous `202`?
