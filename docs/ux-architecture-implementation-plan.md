# Plan

Triển khai `Profile Run Command Center` theo `docs/ux_architecture_proposal.md` bằng cách hợp nhất trải nghiệm ở frontend nhưng giữ nguyên các boundary đáng tin cậy của backend: Profile Run, Analysis Session, deterministic execution, Agent trace và Report version. Lộ trình ưu tiên contract/migration additive, sau đó dựng shell hợp nhất, bổ sung preview và Pin to Report, đưa Workspace Context/Theme vào luồng tạo workspace, rồi rollout bằng feature flag với legacy routes làm đường lui.

## Implementation status (2026-08-19)

Bản hiện tại đã đủ luồng demo khi bật hai feature flag: Profile Command Center →
Preview → Promote Official → Explain bằng Agent → Pin chart/answer → reorder/unpin
Report Draft → snapshot → export PDF. Workspace Context/Theme có API versioned,
form tạo workspace progressive và trang Settings. Legacy routes vẫn được giữ.

Phần cố ý chưa chốt trong môi trường local này:

- PDF hiện tái sử dụng bounded profile exporter; renderer theo ordered immutable
  snapshot items và legacy Notebook adapter đầy đủ vẫn là phase tiếp theo.
- Backend integration/security matrix cần `P170_TEST_DATABASE_URL` trỏ tới
  PostgreSQL test riêng; không được tự dùng database trong `.env`.
- Performance budget 100 MB, telemetry threshold và staged deployment cần fixture/
  staging thật; không thể xác nhận chỉ bằng local mocked E2E.
- `view_image` bị ACL sandbox ở vòng QA; concept và Playwright screenshots vẫn đã
  được tạo/kiểm tra bằng workflow thay thế, nhưng native side-by-side tool cần chạy
  lại khi môi trường sửa ACL.

## Scope

- In:
  - Command Center tại `/profiles/{runId}` với bốn tab `Tổng quan`, `Khám phá`, `Hỏi Agent`, `Báo cáo`; header luôn hiển thị dataset, tên/phiên bản profile, trạng thái và độ tin cậy.
  - Explorer dạng bounded query builder, lazy Analysis Session, preview có giới hạn, official execution qua context version + quality gate, giải thích chart bằng đúng execution evidence.
  - Report Draft gắn với Profile Run, Pin có provenance/idempotency, reorder/edit/unpin, immutable snapshot, stale detection và export PDF/JSON có PII policy.
  - Workspace Context và Workspace Theme có version, được dùng có kiểm soát bởi Agent/UI/PDF mà không thay đổi deterministic compute.
  - Compatibility cho `/analyses`, `/notebooks`, `/reports` và dữ liệu cũ trong thời gian chuyển đổi; telemetry, accessibility, security tests và staged rollout.
- Out:
  - Xóa ngay bảng/API Analysis Session, Notebook hoặc Report hiện có; raw SQL console, raw-row browser, arbitrary code execution và visual query không bounded.
  - Thay đổi thuật toán profiling/statistical/drift hiện tại, xây durable job platform tổng quát, long-term/personal memory, hoặc thêm workflow nhiều role.
  - Tự động làm mới report bằng profile/context mới; snapshot cũ phải được giữ nguyên và chỉ được đánh dấu stale.

## Action items

[ ] 1. Chốt contract đích, terminology và cờ rollout trước khi sửa schema.

  - Ghi quyết định kiến trúc vào `docs/adr-ux-command-center.md`, đồng thời cập nhật `ARCHITECTURE.md` và `docs/summary.md` sau từng phase:
    - UI hợp nhất nhưng backend vẫn giữ `Profile Run -> Analysis Session -> Context Version -> Quality Gate -> Query Execution`.
    - Tái sử dụng `reports`, `report_versions`, `report_sections` và `report_visualizations`; bổ sung `report_items` làm working model cho Pin thay vì biến Notebook cell thành report contract.
    - Preview không được pin trực tiếp trong MVP. Người dùng phải chọn `Xác nhận kết quả`; backend chạy official execution qua quality gate rồi mới cho Pin.
    - Report giữ snapshot cũ và hiện stale reason; không tự chạy lại query hoặc thay result hash.
    - Theme ở cấp workspace; mỗi snapshot pin chính xác theme version đã dùng khi export.
  - Định nghĩa response envelope và state machine dùng chung trong `backend/src/models/` và `frontend/src/lib/command-center-types.ts`:
    - Profile: `queued | running | pending_review | completed | failed | cancelled`.
    - Explorer: `idle | editing | previewing | preview_ready | promoting | blocked | failed | ready | cancelled`.
    - Agent: `idle | streaming | completed | no_evidence | rate_limited | failed`.
    - Report: `empty | draft | stale | snapshotting | exporting | exported | export_failed`.
  - Bổ sung feature flag an toàn trong `backend/src/config.py`, `config.yaml`, `.env.example`, `frontend/next.config.ts`:
    - `UX_COMMAND_CENTER_ENABLED=false` kiểm soát facade/backend mới.
    - `NEXT_PUBLIC_UX_COMMAND_CENTER_ENABLED=false` kiểm soát shell/navigation mới.
    - Backend vẫn là authority; bật riêng frontend không được mở contract chưa sẵn sàng.
  - Chốt event dictionary không chứa prompt/query filter value/PII: `command_center_opened`, `command_center_tab_viewed`, `explorer_preview_*`, `explorer_official_*`, `chart_explain_*`, `report_item_*`, `report_snapshot_*`, `report_export_*`.
  - Acceptance: OpenAPI và TypeScript types mô tả cùng enum/field; state nào cũng có next action; tắt flag trả UI/API về luồng hiện tại mà không cần rollback database.

[ ] 2. Thêm migration additive và persistence boundary cho Context, Theme, preview và Report Item.

  - Tạo migration kế tiếp, dự kiến `backend/migrations/versions/20260818_0012_ux_command_center.py`, theo convention inspect-before-create hiện tại:
    - `workspace_context_versions(id, workspace_id, version, domain, primary_goal, target_audience, status, created_by_user_id, created_at)` với unique `(workspace_id, version)`.
    - `workspace_theme_versions(id, workspace_id, version, primary_color, secondary_color, tone, default_language, status, created_by_user_id, created_at)` với unique `(workspace_id, version)`.
    - `report_items(id, report_version_id, item_type, position, profile_run_id, context_version_id, query_execution_id, agent_run_id, title, note, content_json, query_spec, result_hash, quality_status, limitations, export_policy, idempotency_key, created_by_user_id, created_at, updated_at)`.
    - Thêm `reports.profile_run_id`; thêm `report_versions.workspace_context_version_id`, `workspace_theme_version_id`, `snapshot_hash`, `snapshot_at`.
    - Thêm vào `query_executions`: `execution_kind` (`preview | official`), `status`, `quality_gate_run_id`, `requested_by_user_id`, `expires_at`; backfill record cũ thành `official/ready`.
  - Thêm unique/index cần thiết:
    - một draft đang hoạt động trên mỗi `(workspace_id, profile_run_id, created_by_user_id)` hoặc policy chia sẻ được chốt;
    - unique `(report_version_id, idempotency_key)` để double-click/retry Pin không tạo bản sao;
    - index theo `profile_run_id`, `context_version_id`, `query_execution_id`, `agent_run_id`, `expires_at` để stale scan và cleanup bounded.
  - Backfill workspace hiện có bằng context/theme mặc định version 1; lấy `reports.profile_run_id` từ latest `report_versions.scope.profile_run_id` khi có; không sửa/xóa Notebook hoặc published report cũ.
  - Cập nhật SQLAlchemy metadata trong `backend/src/services/repository.py`; thêm focused repositories `workspace_configuration_repository.py` và `report_draft_repository.py` để không tiếp tục dồn toàn bộ mutation mới vào `Repository`.
  - Mọi read/write mới bắt buộc nhận `workspace_id`; DB constraint và repository cùng kiểm tra profile, execution, agent run và report thuộc một workspace.
  - Acceptance: `alembic upgrade head` chạy được trên database rỗng và database có dữ liệu đến revision `20260815_0011`; dữ liệu report/notebook cũ vẫn đọc được; migration không drop/rename contract cũ.

[ ] 3. Xây Workspace Context/Theme API, versioning và form onboarding/settings.

  - Mở rộng `WorkspaceCreate` trong `backend/src/models/auth_schemas.py` và `POST /workspaces` trong `backend/src/api/authz_routes.py` để nhận object có cấu trúc:
    - context: `domain`, `primary_goal`, `target_audience`;
    - theme: `primary_color`, `secondary_color`, `tone`, `default_language`.
  - Giữ tương thích payload `{name}`: backend tự tạo version 1 bằng default an toàn. Validate màu hex, chuỗi bounded, tone/language allowlist; không nhận CSS, HTML hoặc prompt template tùy ý.
  - Thêm `GET /workspaces/current/configuration` và `PATCH /workspaces/current/configuration` với `expected_context_version`/`expected_theme_version`. Update phải insert version mới và supersede version cũ trong một transaction; mismatch trả `409 configuration_stale`.
  - Audit `workspace_context_created`, `workspace_context_updated`, `workspace_theme_updated`; audit chỉ lưu version ID và field names thay đổi, không lưu nguyên văn business context nếu không cần.
  - Mở rộng `frontend/src/lib/api.ts`, `auth-provider.tsx` và type tương ứng để bootstrap active versions. Nâng `frontend/src/app/workspaces/page.tsx` thành form progressive (tên bắt buộc; context/theme có default và có thể bỏ qua) và tạo `frontend/src/app/settings/page.tsx` để chỉnh sửa sau.
  - Áp màu bằng CSS custom properties ở App Shell/Command Center và truyền theme snapshot vào PDF renderer. Luôn giữ contrast fallback nếu brand color không đạt WCAG; language/tone chỉ thay cách diễn đạt, không thay metric/query/result.
  - Khi dựng Agent state trong `backend/src/api/routes.py` và `backend/src/agents/state.py`, đưa context dưới một block structured, bounded và được xem là user-provided data; không nối trực tiếp thành system instruction. Pin context version ID/hash vào `agent_runs.version_snapshot`; theme không được đưa vào compute prompt.
  - Guest workspace nhận default context/theme; không bắt form onboarding làm gián đoạn guest trial.
  - Acceptance: hai lần update cạnh tranh không làm mất version; switch workspace xóa React Query/cache/theme của workspace cũ; prompt injection trong domain/goal không vượt `BASE_RULES`; cùng một official query cho kết quả/hash giống nhau trước và sau khi đổi theme/tone.

[ ] 4. Tách trang Profile hiện tại thành Command Center shell nhẹ và có deep-link ổn định.

  - Refactor `frontend/src/app/profiles/[runId]/page.tsx` thành shell và các component độc lập trong `frontend/src/components/command-center/`:
    - `command-center-shell.tsx` quản lý header, active tab, permissions và top-level state;
    - `overview-tab.tsx` tái sử dụng metric, quality, provenance, column profile, correlation hiện có;
    - `explorer-tab.tsx`, `agent-tab.tsx`, `report-tab.tsx` được lazy-load khi tab mở.
  - Đồng bộ tab với URL `?tab=overview|explorer|agent|report` để refresh/back/forward/deep-link hoạt động; route vẫn là `/profiles/{runId}` và không tạo thêm khái niệm người dùng.
  - Header cố định hiển thị dataset name, run name, `v{version}`, scan mode, profile status, pending proposal count và badge exact/preview/approximate phù hợp.
  - Giữ polling 3 giây cho profile đang chạy. Với `failed`, hiển thị message có thể hành động, retry entry point và reference ID; với `pending_review`, CTA dẫn tới `/profiles/{runId}/review?returnTo=...` rồi quay lại đúng tab.
  - Di chuyển JSX overview hiện đang monolithic thành component thuần, không đổi contract metric. Mỗi tab có loading/error/empty state riêng để lỗi Agent/export không làm mất Profile/Report Draft.
  - Trong `frontend/src/components/app-shell.tsx`, khi flag bật, bỏ `Phân tích chuyên sâu` và `Phiên phân tích` khỏi primary navigation; giữ `Bộ dữ liệu`, `Thư viện báo cáo`, `So sánh phiên bản`, `Hoạt động`. Legacy URL vẫn truy cập được và có banner/link quay về đúng Command Center tab.
  - Accessibility: tab dùng ARIA tab pattern, focus restoration, URL navigation bằng keyboard; mọi drag/drop về sau đều có select/button/reorder keyboard tương đương.
  - Acceptance: chỉ Overview bundle tải ở lần mở đầu; mở trực tiếp từng tab/refresh không mất selection; profile lỗi/đang chạy/review/completed đều có next action; tắt flag render trang và navigation cũ.

[ ] 5. Bổ sung Explorer facade, lazy Analysis Session và semantics Preview/Official chính xác.

  - Giữ API `analysis-sessions` hiện tại làm domain API; thêm profile-scoped facade trong `backend/src/api/analysis_routes.py` (hoặc router mới nếu file vượt ngưỡng review):
    - `POST /profile/{run_id}/explorer/session`: idempotently tạo/tìm quick Analysis Session cho user/profile và dựng draft context từ reviewed semantic types, PII decisions và column stats.
    - `POST /analysis-sessions/{session_id}/previews`: chạy bounded preview không cần explicit context approval, nhưng vẫn yêu cầu profile completed, không còn critical pending proposal, workspace scope và PII/restricted-column policy.
    - `POST /analysis-sessions/{session_id}/previews/{preview_id}/promote`: xác nhận context version, chạy quality gate và tạo official execution; nếu context/profile version stale trả `409` kèm rule/next action.
  - Không mở raw SQL. Tiếp tục dùng `QuerySpec` allowlist trong `backend/src/models/analysis_schemas.py`: tối đa 3 dimensions, 20 filters, IN tối đa 100 giá trị; đặt riêng preview `limit <= 50`, official `limit <= 500`, memory/thread/timeout từ `Settings`.
  - Sửa `backend/src/services/analysis_engine.py` để execution scope quyết định `is_approximate`:
    - hiện engine luôn materialize full immutable source nhưng lấy `profile_run.is_approximate` để gắn nhãn, dẫn tới semantics không chính xác;
    - preview sampling phải thực sự sample và ghi strategy/seed/row budget/limitation;
    - official execution đọc full pinned source và chỉ approximate khi aggregate algorithm thật sự approximate.
  - Thêm natural-language query summary do code deterministic sinh từ canonical `QuerySpec`; không dùng LLM để mô tả query trước khi chạy.
  - Chạy DuckDB ngoài event-loop với hard timeout và cancellation token; browser AbortController phải dẫn tới DuckDB interrupt/cleanup trong request hiện tại. Persist trạng thái `failed/cancelled/ready`, không ghi execution ready nếu timeout hoặc client cancel trước commit.
  - `AnalysisRepository` lưu canonical query, execution kind, active context/gate IDs, result hash, duration, limitations và actor. Promotion không copy preview result thành official; phải execute lại theo official policy rồi so provenance.
  - Acceptance: preview và official có badge/limitation đúng; query PII/cross-workspace/raw SQL bị chặn; retry cùng idempotency key trả cùng resource; timeout/cancel giải phóng connection/temp file; stale context không thể chạy official path.

[ ] 6. Nhúng Explorer UI và chart renderer có fallback truy cập được.

  - Di chuyển logic preset/query builder từ `frontend/src/app/analyses/[sessionId]/page.tsx` vào `frontend/src/components/command-center/explorer/`; trang legacy dùng lại component hoặc adapter thay vì fork logic.
  - Phân loại cột từ Profile + context thành `Dimensions`, `Measures`, `Time`, `Restricted/PII`. Cho kéo/thả như enhancement, nhưng select, add/remove button và keyboard là contract chính.
  - Hỗ trợ aggregate/filter/sort/group limit hiện có; trước Run luôn hiển thị query summary, scope badge, estimated group limit và các limitation.
  - Dùng HTML table và native SVG/CSS bar/line/KPI cho MVP để tránh thêm chart dependency không cần thiết; mọi chart có data table, accessible label và cùng formatter.
  - Mỗi result card có `Giải thích`, `Xác nhận kết quả`, `Pin to Report`, `Duplicate`, `Edit query`; Pin bị disable với preview và đưa người dùng qua Promote. Giữ selection/history bounded theo profile trong React Query, không đưa result rows vào localStorage.
  - Mapping UI state tới lỗi API cụ thể: quality rule blocked, context stale, restricted column, timeout, rate limit, cancelled và generic failure; `Blocked` phải hiện rule/evidence summary/action chứ không chỉ error string.
  - Acceptance: người dùng tạo được count/sum/mean/median/count-distinct với filter mà không thấy SQL; chart và table khớp result hash; toàn bộ flow chạy bằng keyboard; đổi tab không hủy result đã commit nhưng unmount phải abort request đang chạy.

[ ] 7. Gắn Agent vào đúng Profile/Execution evidence và cho phép Pin câu trả lời an toàn.

  - Tách phần chat dùng lại từ `frontend/src/app/chat/page.tsx` thành `frontend/src/components/command-center/profile-agent-panel.tsx`; trong Command Center, khóa `profile_run_id` theo route và bỏ dataset/profile picker cùng upload intake.
  - Mở rộng `QARequest`/SSE theo hướng additive với `analysis_execution_id`, `workspace_context_version_id`; backend xác thực execution thuộc đúng workspace, profile run, trạng thái ready và không hết hạn trước khi đưa aggregate evidence vào `qa_context`.
  - Khi chọn `Giải thích` từ chart, chỉ truyền canonical query, bounded result, result hash, limitations và source/version IDs cần thiết; không truyền full dataset, source path hay toàn bộ browser chat history.
  - Response/SSE `done` trả thêm `evidence_status`, `profile_run_id`, `context_version_id`, `analysis_execution_id`, `agent_run_id`; UI hiện `Show evidence`, limitation và `no evidence` rõ ràng. Agent vẫn chỉ diễn giải deterministic result, không tự tính lại metric.
  - Mở rộng `ChatMessage` để giữ `agent_run_id`, evidence refs và output hash. Pin gửi sanitized answer snapshot + refs; backend re-run output guardrail, kiểm tra agent run/workspace/profile, compute hash và không lưu raw prompt/history/chain-of-thought.
  - `Regenerate` tạo agent run mới; Follow-up chỉ gửi cửa sổ short-term bounded hiện có. Đổi workspace/profile phải abort stream và xóa context của panel cũ.
  - Acceptance: không thể giải thích execution của workspace/profile khác; answer thiếu evidence có nhãn và không được pin như verified insight; PII/prompt-exfiltration guardrail hiện có vẫn pass; lỗi/stream abort không làm mất report draft.

[ ] 8. Xây Report Draft/Pin/Snapshot backend trên report lifecycle hiện có.

  - Thêm API typed, workspace-scoped và có audit:
    - `GET|POST /profile/{run_id}/report-draft` để load hoặc idempotently tạo draft gắn profile;
    - `POST /reports/{report_id}/items` để pin `profile_section | chart | agent_answer | note | legacy_notebook`;
    - `PATCH|DELETE /reports/{report_id}/items/{item_id}` và `PATCH /reports/{report_id}/items/reorder` với expected draft version;
    - `POST /reports/{report_id}/snapshots` để validate và đóng băng ordered items;
    - `GET /reports/{report_id}/snapshots/{version}/export-source` cho JSON/PDF renderer.
  - `report_draft_repository.py` phải resolve mọi provenance server-side:
    - chart lấy query spec/result hash/result snapshot từ official `query_execution_id`, không tin result do browser gửi;
    - Agent answer kiểm tra `agent_run_id`, profile/context/execution refs rồi lưu sanitized content hash;
    - profile section được dựng từ `_report_profile(..., mask_pii=True)` hoặc projection nhỏ hơn, không lưu raw row/source ref.
  - Pin dùng `Idempotency-Key`; cùng key + cùng payload trả item cũ, cùng key + payload khác trả `409`. Reorder cập nhật toàn bộ positions trong một transaction và reject stale draft version.
  - Stale evaluator trả reason codes riêng: `context_superseded`, `new_profile_available`, `source_version_changed`, `execution_unavailable`, `theme_superseded`. Không âm thầm cập nhật item; user phải re-run/re-pin hoặc chấp nhận limitation theo policy.
  - Snapshot tạo immutable `report_version`, pin context/theme version IDs và `snapshot_hash`; sau snapshot/export, lần chỉnh tiếp theo tạo draft version mới thay vì mutate version đã đóng băng.
  - Thay `create_profile_report` đang auto-publish ngay bằng compatibility wrapper dưới flag: Command Center tạo draft/snapshot rõ ràng, legacy caller vẫn nhận contract cũ. Không đổi published report đang tồn tại.
  - Bổ sung cleanup cascade có kiểm soát khi xóa draft; published snapshot không được delete qua draft endpoint. Audit create/pin/unpin/reorder/snapshot/export/share/publish với actor và resource IDs.
  - Acceptance: double-click Pin chỉ tạo một item; preview/cross-workspace/PII-unsafe evidence bị từ chối; snapshot hash ổn định với cùng ordered content; draft sống sót khi Agent/export lỗi; published snapshot không bị update khi context/theme/profile thay đổi.

[ ] 9. Hoàn thiện Report tab, export theo snapshot và compatibility cho Notebook/Analysis cũ.

  - `report-tab.tsx` hiển thị empty/draft/stale/export states; cho đổi title, note, move up/down/drag reorder, unpin, preview và xem evidence/limitation của từng item. Autosave debounce nhưng mutation vẫn có version/idempotency guard.
  - Update `frontend/src/lib/api.ts` với typed report draft methods; không tiếp tục dùng generic `listPublishedReports<T>`/`getPublishedReport<T>` cho Command Center contract mới.
  - Refactor `frontend/src/app/api/reports/profile/[runId]/route.ts` để lấy immutable snapshot payload, dùng theme version đã pin thay cho `COLORS` cố định, render chart/table/Agent answer theo ordered report items và giữ font Unicode hiện tại.
  - Export JSON và PDF phải cùng `snapshot_hash`, item order, limitation, profile/context/theme/evidence IDs và export policy; response/header có snapshot version. Export stale report được block hoặc yêu cầu explicit acknowledgement theo policy đã chốt, không silently refresh.
  - Tạo compatibility adapter đọc `notebooks`/`notebook_cells` thành read-only `legacy_notebook` items trong Report tab. Không copy raw prompt; chỉ expose markdown và sanitized completed answer được phép. Link cũ `/notebooks/{id}` và `/analyses/{id}` tiếp tục hoạt động trong deprecation window.
  - `/reports` vẫn là thư viện workspace cho draft/snapshot/published artifact; `/reports/{id}` ưu tiên immutable version và có deep-link về Profile Command Center nếu còn quyền.
  - Khi telemetry đạt ngưỡng, chuyển legacy list pages sang redirect/banner; chỉ xóa navigation trước, chưa drop table/API. Rollback chỉ tắt flags và dùng lại pages cũ.
  - Acceptance: reorder bằng keyboard và pointer cho cùng order; refresh không mất draft; PDF/JSON khớp snapshot; màu không đạt contrast dùng fallback; Notebook cũ xem được nhưng không thể tạo write path mới từ Command Center.

[ ] 10. Phủ test, đo hiệu năng và rollout theo từng phase có rollback.

  - Backend contract/integration tests:
    - mở rộng `tests/test_api/test_analysis_routes.py` cho lazy session, preview/promote, exact-vs-approximate, timeout/cancel, stale context và PII/cross-workspace;
    - thêm `tests/test_api/test_command_center_routes.py`, `test_workspace_configuration.py`, `test_report_draft_routes.py` cho version races, idempotent Pin/reorder, stale reasons, snapshot immutability, export masking và guest policy;
    - giữ `tests/test_api/test_notebook_routes.py`, `test_routes.py`, guardrail/security/permission suite xanh để chứng minh compatibility.
  - Frontend tests:
    - Vitest + Testing Library cho tab URL state, query builder keyboard path, status-to-action mapping, Pin disabled on preview, autosave conflict và stale banner;
    - Playwright `frontend/tests/command-center.spec.ts` cho happy path Workspace -> Upload/Profile -> Explorer -> Explain -> Promote -> Pin -> Reorder -> Export;
    - Playwright matrix cho reload/deep-link, Agent/export failure, mobile viewport, keyboard-only và feature flag off.
  - Security/reliability matrix bắt buộc: hai user/hai workspace, restricted/PII column, prompt injection trong workspace context, forged execution/agent/report IDs, double-submit, concurrent reorder, stale version, cancel-before-commit và export retry.
  - Chạy validation chuẩn của repo:
    - `.\.venv\Scripts\python.exe -m pytest`;
    - `.\.venv\Scripts\python.exe -m ruff check backend tests`;
    - `cd frontend; pnpm typecheck; pnpm lint; pnpm test; pnpm build; pnpm test:e2e`.
  - Performance budget mặc định để bắt đầu đo trên staging fixture 100 MB: Command Center Overview p95 <= 2.5 giây, preview p95 <= 3 giây với hard timeout 10 giây, export p95 <= 15 giây; ghi rõ hardware/dataset và điều chỉnh chỉ bằng quyết định có log.
  - Rollout:
    1. deploy migration + API/types với cả hai flag off;
    2. backfill/verify context-theme-report provenance và chạy cross-workspace/PII suite;
    3. bật backend flag, chạy shadow telemetry và internal API clients;
    4. bật shell/Overview cho pilot workspace;
    5. bật Explorer preview, sau đó Promote/Explain;
    6. bật Report Draft/Pin/Snapshot/Export;
    7. bật workspace onboarding/theme và cuối cùng ẩn legacy navigation;
    8. deprecate legacy pages chỉ sau khi adoption/error/stale/export metrics đạt ngưỡng đã chốt.
  - Go/no-go MVP: người dùng hoàn thành một evidence-backed insight và pin/export trong cùng Profile Run; official path không bypass stale context/quality gate; không raw SQL/raw row/PII leakage; snapshot immutable và export tái lập; tắt flag khôi phục UX cũ mà không mất draft/evidence.

## Open questions

- Guest policy: guest có được export PDF/JSON hay share/publish không? Mặc định khuyến nghị: cho export PDF có watermark `Guest trial`, không cho share/publish và dữ liệu vẫn theo retention guest.
- Compatibility window cho Notebook/Analysis độc lập là bao lâu? Mặc định khuyến nghị: tối thiểu 2 release và chỉ deprecate sau 30 ngày không còn write traffic từ legacy UI.
- Taxonomy Workspace Context/Theme có cần danh mục domain/audience/tone do product quản lý hay cho free text bounded? Mặc định khuyến nghị: preset có `Khác` cho domain/audience, tone và language dùng allowlist để output nhất quán.
