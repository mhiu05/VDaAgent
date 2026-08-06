# Plan

Thay Web UI HTML tĩnh bằng ứng dụng production-grade trong `frontend/` sử dụng Next.js App Router, React và TypeScript strict. Frontend đảm nhiệm trải nghiệm Analyst hoàn chỉnh cho dataset, profile report, HITL, drift/test/export và QA streaming; backend chỉ cung cấp API/OpenAPI và không còn serve UI sau khi hoàn tất cutover.

Tài liệu nền: [project_context.md](./project_context.md), [ADR_v1.md](./ADR/ADR_v1.md), [agent_architecture.md](./architecture/agent_architecture.md), [backend-plan.md](./backend-plan.md), [agent-plan.md](./agent-plan.md).

## Scope

- In: Next.js application, TypeScript, routing/layout, design system, generated API client, auth/session, upload/profile workflow, report visualizations, HITL, test/drift/export, QA SSE, accessibility, responsive UX, unit/component/E2E tests và deployment.
- Out: tính lại metric/suy luận trong browser; hiển thị raw dataset; BI dashboard hoặc data catalog đầy đủ; trực tiếp truy cập database/checkpoint; calendar/notification và external research ngoài phase đầu.
- Dependency: OpenAPI và SSE event contract từ backend là source of truth; OIDC/session policy được thống nhất với backend; mọi metric, citation, PII state và lifecycle status được render nguyên nghĩa, không tự suy đoán từ sample.
- Target stack: Next.js App Router + React + TypeScript strict, pnpm, Tailwind CSS + accessible headless components, TanStack Query/Table, ECharts, React Hook Form + Zod, generated OpenAPI client, Vitest/Testing Library/MSW và Playwright.

## Action items

- [ ] **P0 — Bootstrap `frontend/` và quality baseline.** Khởi tạo Next.js App Router với TypeScript strict, `src/` directory, path aliases, pnpm lockfile, ESLint/formatter, environment schema và scripts `dev/build/start/lint/typecheck/test/test:e2e`. Thiết lập CI cache, bundle analyzer, error boundaries, CSP/security headers và không commit secret; chỉ biến có prefix public mới được đưa vào client bundle.

- [ ] **P0 — Chốt information architecture và route model.** Tạo route/layout cho `/datasets`, `/datasets/new`, `/profiles/[runId]`, `/profiles/[runId]/review`, `/profiles/[runId]/analysis`, `/compare` và `/chat`; dùng nested layout, loading/error/not-found states và URL làm source of navigation state. Định nghĩa state machine UI cho `idle/uploading/queued/running/pending_review/resuming/completed/failed/cancelled`, deep-link/reload an toàn và không lưu token/raw data trong localStorage.

- [ ] **P0 — Xây design system chuyên nghiệp và accessible.** Chuẩn hóa color/type/spacing/elevation/status tokens, responsive shell, navigation, breadcrumb, command/search, toast/dialog/drawer, form, data table, chart container, skeleton/empty/error states và dark mode nếu được duyệt. Dùng accessible headless primitives, keyboard/focus management, ARIA live region cho job/stream, contrast WCAG 2.2 AA và virtualized table cho dataset nhiều cột; tránh component copy-paste không có ownership/test.

- [ ] **P0 — Tạo type-safe API layer từ OpenAPI.** Generate TypeScript types/client theo stable `operationId`, fail CI khi schema breaking hoặc generated code bị stale; bọc auth, base URL, timeout, retry policy, correlation id, cancellation và RFC 9457 error mapping trong một transport layer. Dùng TanStack Query cho server state/cache/invalidation, Zod chỉ để validate runtime boundary cần thiết; không viết lại DTO bằng tay và không để component gọi `fetch` rải rác.

- [ ] **P0 — Hoàn thiện authentication và authorization UX.** Tích hợp OIDC qua secure server-side session/BFF hoặc cơ chế đã chốt, dùng `HttpOnly/Secure/SameSite` cookie và không lưu bearer token trong browser storage. Bảo vệ route theo session/role, render action theo permission nhưng vẫn coi backend là authority; xử lý login redirect, expiry/refresh, forbidden, multi-tab logout và session timeout mà không làm mất draft review chưa gửi.

- [ ] **P0 — Xây workflow dataset và profiling end-to-end.** Upload CSV/TSV/Parquet/JSON với drag-drop, client precheck, progress, cancel/retry, checksum/duplicate feedback và error có hướng xử lý; sau upload điều hướng bằng opaque dataset id. Form profile hỗ trợ full/sample, strategy/size/seed, estimate cost/uncertainty, idempotent submit; job screen polling có backoff hoặc dùng event stream, cho cancel/retry và giữ trạng thái chính xác khi reload.

- [ ] **P0 — Xây profile report evidence-first.** Hiển thị overview, schema, completeness, cardinality, distributions, top-k, outlier, correlation, warnings, provenance và narrative bằng data table/charts có loading/empty/error states. Gắn `≈`, confidence interval và sampling tooltip cho số ước lượng; phân biệt `0`, `null`, `not_applicable`, `masked`; không render top-k/raw sample của PII và luôn hiển thị metric source/version khi drill-down.

- [ ] **P0 — Xây HITL review chống mất dữ liệu và conflict.** Nhóm candidate key, semantic type và PII; hiển thị confidence, evidence, method, policy và pending/auto-confirmed status. Cho confirm/reject/edit từng proposal, bulk action có guard, validation, review summary, autosave draft cục bộ không chứa PII và submit kèm version/idempotency; xử lý `409` bằng refetch/diff thay vì overwrite, khóa resume cho đến khi required proposals được quyết định và giữ audit identity từ session.

- [ ] **P1 — Hoàn thiện deep analysis, drift, export và QA streaming.** Form statistical test chỉ cho phép test/cột/alpha hợp lệ, giải thích adjusted p-value/effect size mà không tự tạo kết luận. Drift so sánh compatible runs bằng table/chart và severity filters; export thể hiện scope mask/provenance/expiry trước download. QA dùng `fetch` + `ReadableStream` cho POST SSE, incremental parser cho split frames, `AbortController`, retry policy, `meta/token/source/heartbeat/done/error`, citation drawer và invariant không hiển thị answer chưa có terminal/source như kết luận chắc chắn.

- [ ] **P0 — Nghiệm thu, migrate và rollout frontend.** Viết unit test cho formatter/state/SSE parser, component test cho form/table/review, MSW contract tests và Playwright E2E cho upload → queued/profile → HITL → report → test/drift/export → QA/cancel; thêm cases PII masking, `409`, expired session, network loss, mobile và keyboard-only. Chạy `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm build`, Lighthouse/accessibility và real-backend smoke; deploy preview trước production, chuyển route/domain có rollback, rồi xóa `backend/src/webui` cùng `app.mount('/ui', ...)` chỉ sau khi feature parity được xác nhận.

## Open questions

- Frontend sẽ deploy độc lập trên Vercel hay container cùng hạ tầng để quyết định BFF, cookie domain và networking?
- OIDC provider và session strategy nào được chọn để frontend không phải giữ access token trong browser storage?
- Design system ưu tiên custom brand với headless components hay bộ enterprise component có license/support chính thức?
