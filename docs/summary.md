# VDaAgent — Technical Summary

Tài liệu này mô tả contract kỹ thuật và các boundary đang tồn tại trong code VDaAgent. README dành cho cài đặt và user flow; file này dành cho người phát triển, review code và vận hành deployment.

Khi `NEXT_PUBLIC_UX_COMMAND_CENTER_ENABLED=true`, Profile Run Command Center là trải nghiệm chính cho Tổng quan, Khám phá, Hỏi Agent và Báo cáo. Preview/Official, Workspace Context/Theme và Pin to Report là contract additive. Analysis Session và Notebook vẫn có API/route legacy để tương thích hoặc rollback, nhưng app shell không đưa chúng vào left sidebar.

## 1. Mục tiêu và invariant

VDaAgent là hệ thống profiling và phân tích dữ liệu theo workspace. Một kết quả
hợp lệ phải truy được về profile run, context, quality gate và execution tương
ứng. Khi agent runtime trace được bật, profiling/Q&A còn truy được về
`agent_run`, các step/invocation và evidence đã redact.

Các invariant chính:

1. Số liệu do deterministic compute tạo ra. LLM không được tự tạo hoặc sửa số.
2. Mọi resource thuộc workspace đều phải được scope ở repository/API boundary.
3. Proposal metadata phải qua review trước các workflow phụ thuộc.
4. Raw SQL, arbitrary code và raw row không phải public contract của Analysis API.
5. PII được mask trong profile/export/answer; PII không được dùng làm aggregate, group-by hoặc filter.
6. Guest là principal tạm thời, không phải Supabase user và không phải storage dài hạn.
7. PDF/JSON export phải phản ánh đúng nhóm nội dung người dùng đã chọn.
8. Agent trace là provenance bổ sung, không phải nguồn quyết định số liệu:
   deterministic compute và bounded analysis contract vẫn là authoritative.

## 2. Topology runtime

```text
Browser / Next.js :3000
  ├─ Supabase SSR Auth hoặc guest session
  ├─ React Query API client
  └─ JSON/SSE + Authorization + X-Workspace-Id
                         ↓
FastAPI :8000/api/v1
  ├─ authentication, membership, capability checks
  ├─ profiling LangGraph, Q&A LangGraph và native skill registry
  ├─ runtime trace/provenance (opt-in, redact trước khi persist)
  ├─ DuckDB/pandas/NumPy/SciPy compute
  ├─ repository PostgreSQL + agent-run lifecycle
  └─ storage adapter: Supabase Storage / Google Drive / local dev-test
```

Backend mount các router tại `/api/v1`:

- `routes.py`: dataset, profile, Q&A, test, drift và report source.
- `analysis_routes.py`: Analysis Workspace.
- `authz_routes.py`: session, workspace, dashboard và report workflow.
- `google_drive_routes.py`: OAuth connection/status.
- `agent_routes.py`: tenant-scoped run, trace, evidence, plan projection và
  trace summary.
- `skill_routes.py`: catalog native skill và inspect các read-only tool bundle.
- `notebook_routes.py`: notebook CRUD, cells, sharing và export.

Startup tạo/reuse metadata repository và kiểm tra cấu hình. Development/test có
thể gọi `metadata.create_all`; production yêu cầu Alembic migration chạy trước,
PostgreSQL kết nối được, Supabase Auth và storage provider hợp lệ. `/docs` và
`/redoc` bị tắt khi `APP_ENV=production`.

## 3. Authentication, tenancy và capability

### 3.1 Auth context

Frontend gửi:

```text
Authorization: Bearer <Supabase access token hoặc guest token>
X-Workspace-Id: <workspace UUID>  # cần khi principal có nhiều membership
```

`backend/src/services/auth.py` xác minh Supabase JWT qua JWKS asymmetric (`ES256`/`RS256`). Khi bật `AUTH_REQUIRE_EMAIL_CONFIRMED`, backend đọc trạng thái `email_confirmed_at` từ Supabase Auth user endpoint nếu claim này không có trong JWT; một số asymmetric token không chứa claim đó. `backend/src/api/dependencies.py` tạo `RequestContext` gồm:

```text
user_id
workspace_id
role
effective_permissions
actor/is_guest
```

`AUTH_MODE=dual` chỉ là bridge cho development/rollout. Production phải dùng `AUTH_MODE=supabase`; không dùng `JWT_SECRET` để thay thế JWKS verification.

### 3.2 Guest principal

Guest token có dạng `guest.<session_uuid>.<role>`. Backend map token vào user ID deterministic và tạo guest workspace riêng. Guest vẫn đi qua capability guard, nhưng không có email hay Supabase account.

Guest storage được cấu hình bằng `GUEST_STORAGE_PROVIDER`. Guest chỉ được tạo
sau khi visitor chọn Analyst. Bấm `Kết thúc dùng thử` sẽ yêu cầu cleanup
best-effort qua:

```text
DELETE /api/v1/guest/session
```

Không dùng SQLite; metadata vẫn cần PostgreSQL. Đóng tab xóa guest token ở
`sessionStorage`, nhưng workspace/file phía backend vẫn được dọn theo retention
nếu cleanup không chạy xong. Guest trial dành cho demo và test user flow, không
dành cho dữ liệu cần giữ lâu dài.

### 3.3 Capability catalog

Catalog tập trung tại `backend/src/services/permissions.py`.

Workspace chỉ có một role duy nhất là **`analyst`**. Các role legacy (`owner`,
`admin`, `viewer`) được chuẩn hóa thành `analyst` ở trust boundary. Role này sở
hữu toàn bộ tập capability:

| Capability nhóm | Ví dụ |
| --- | --- |
| Dataset | `dataset.read`, `dataset.upload`, `dataset.delete` |
| Profiling | `profile.run`, `profile.read`, `profile.review` |
| Stats / Drift | `stats.run`, `drift.run` |
| Q&A | `qa.profile.ask`, `qa.published.ask` |
| Analysis (legacy) | `analysis.run` |
| Notebook (legacy) | `notebook.read`, `notebook.write`, `notebook.share` |
| Report | `report.draft.write`, `report.submit`, `report.review`, `report.publish`, `report.archive`, `report.published.read`, `report.published.export` |
| Workspace | `workspace.members.manage`, `workspace.settings.manage`, `workspace.storage.connect`, `workspace.audit.read`, `workspace.activity.read`, `workspace.lifecycle.manage`, `workspace.create`, `workspace.delete` |
| Agent | `agent.run.read`, `agent.trace.read`, `agent.trace.debug.read` |

Frontend có thể ẩn button, nhưng không phải security boundary. Backend trả `401` cho auth failure, `403` cho thiếu permission, `404` cho resource ngoài tenant và `409 workspace_required` khi cần chọn workspace.

### 3.4 Signup, PKCE và guest Analyst

Self-signup có hai feature flag tương ứng:

```text
AUTH_ALLOW_SIGNUP=true
NEXT_PUBLIC_AUTH_ALLOW_SIGNUP=true
```

Frontend vẫn gửi `requested_role` trong callback URL và Supabase user metadata
để tương thích, nhưng giá trị hiện tại luôn là `analyst`; signup không có role
selector.
Sau khi email được xác nhận, `frontend/src/app/auth/callback/page.tsx` lấy
session đã được `createBrowserClient` xử lý PKCE rồi gọi
`POST /api/v1/onboarding/provision`. Callback không gọi
`exchangeCodeForSession` lần thứ hai; làm vậy có thể làm mất code verifier.

Provisioning tạo hoặc trả về personal workspace và membership Analyst. Nếu
callback cũ không có role, callback flow cũng dùng Analyst làm fallback an toàn.
Khi một tài khoản Supabase đã tồn tại nhưng chưa có membership (ví dụ được tạo
trực tiếp trong Supabase Dashboard), `AuthProvider` gọi lại endpoint provision
idempotent sau lần `GET /session` bị thiếu workspace rồi retry session. Role lấy
từ metadata nếu hợp lệ, mặc định là `analyst`; membership hiện có không bị đổi.
Trang signup hỗ trợ gửi lại email với cooldown 120 giây; email vẫn chịu rate
limit/SMTP của Supabase và Gmail có thể gộp thư vào cùng một thread.

`PublicNavbar` chỉ hiển thị một lựa chọn trial là Analyst trên các public entry
point. `AuthProvider.enterGuestRole` tạo guest session sau thao tác này, xóa
Supabase session local cũ và ưu tiên guest token; vì vậy Supabase token hết hạn
không thể chặn trial. `loadSequence` và `guestSwitchSequence` bảo đảm response
cũ không ghi đè session/workspace mới. Khi kết thúc dùng thử, cleanup là
best-effort và không được làm hỏng việc quay lại public flow.

### 3.5 API router inventory

Các router hiện được mount dưới `/api/v1`:

```text
routes.py              datasets, profiling, reports source, tests, drift, Q&A, audit, status
analysis_routes.py     analysis sessions, context versions, quality gate, executions
authz_routes.py        session, workspaces, dashboard, onboarding, invitations, report workflow
agent_routes.py        tenant-scoped agent run, trace, evidence, plan và summary
google_drive_routes.py status, OAuth connect/callback và disconnect
notebook_routes.py     notebook CRUD, cells, sharing và export
skill_routes.py        native skill catalog và read-only inspect
```

Các route nghiệp vụ dùng `RequestContext`/permission guard phù hợp; route auth
dùng `AuthContext` để bootstrap membership. Không route nào nhận workspace scope
từ client body để quyết định tenant. `GET /api/v1/profile/{id}/report`
là JSON report đã lọc section; PDF được tạo qua Next.js route
`/api/reports/profile/{runId}` và vẫn dùng cùng section contract.

## 4. Data lifecycle

```text
Dataset
  → ProfileRun(sample/full)
  → Proposal metadata
  → Review confirm/reject/edit
  → Profile completed
  → Report / Q&A / Test / Drift / Analysis
```

Các resource gốc có `workspace_id` trực tiếp hoặc được scope bắt buộc qua chuỗi
ownership đã kiểm tra:

- dataset và immutable source reference;
- profile run và column stats;
- proposal, statistical test result và drift report qua profile run;
- analysis session trực tiếp; context version, quality gate và execution qua
  session;
- report draft/version/visualization;
- audit event và profile retrieval document.

Repository luôn nhận workspace scope khi đọc resource. Không tin `workspace_id`, role hoặc permission do client gửi trong body.

## 5. Profiling pipeline

`POST /api/v1/profile` tạo profile run. Scan mode:

- `sample`: reservoir sample, mặc định 10.000 dòng, phù hợp exploratory workflow;
- `full`: quét toàn bộ source để có metric đầy đủ hơn.

Compute tạo schema/dtype, row count, null percentage, cardinality, uniqueness, duplicate, outlier, numeric summary, top values, date summary, correlation và risk warnings. Dataset upload mới đồng thời tính SHA-256 của binary source và lưu source version; hash này được mang sang profile run. Local path không được trả ra public API. Dataset/profile cũ chưa có content hash phải được xem là provenance chưa được pin hoàn toàn.

LangGraph hỗ trợ orchestration, resume/checkpoint và narrative. Nếu LLM không có key, compute/profile vẫn có thể chạy; narrative sẽ dùng fallback dạng bảng hoặc được bỏ qua tùy workflow.

### 5.1 Trạng thái skill và boundary tích hợp

Native skill registry hiện có tại `backend/src/agents/skills/registry.py`; agent
không dùng DB-GPT `SkillManager`/`SkillLoader`. Năm skill có version, permission
và execution mode rõ ràng: `profile-dataset`, `diagnose-data-quality`,
`compare-profile-drift`, `answer-business-question`, `generate-report`.

`SKILL.md` là playbook ngắn; registry là authority cho tool allowlist. Catalog
được đọc qua `GET /api/v1/agent-skills` hoặc `GET /api/v1/agent-skills/{name}`.
Hai skill read-only chạy được qua
`POST /api/v1/agent-skills/{skill_name}/inspect`; endpoint kiểm tra
`profile_run_id` thuộc workspace trước khi gọi read-only tool dispatcher. Các
skill tạo side effect trả về API workflow đã phân quyền, không được chạy qua
inspect endpoint. Q&A chọn playbook bằng deterministic routing và đưa guidance
vào cả prompt structured lẫn retrieval; guardrail, capability, trace và tool
budget vẫn giữ nguyên boundary hiện hữu. `get_profile_readiness` bổ sung trạng
thái evidence-ready nhưng không thay Analysis Workspace quality gate.

Không cho model tự đăng ký skill/tool mới lúc runtime, tự đọc source file hay tự
tính lại metric. Contract nguồn nằm trong từng `SKILL.md` dưới
`backend/src/agents/skills/` và registry tương ứng.

## 6. Proposal review và PII

Các loại proposal:

- `semantic_type`: categorical, continuous, datetime và các kiểu ngữ nghĩa khác;
- `candidate_key`: cột có khả năng định danh entity/order;
- `pii`: cột có thể chứa thông tin cá nhân.

Proposal có trạng thái pending/confirmed/rejected/edited tùy loại. Human review là điểm chuyển tiếp trước các workflow yêu cầu metadata ổn định.

PII policy:

- Profile response mặc định mask top values của PII.
- Pending PII cũng được coi là nhạy cảm cho export.
- PII không được làm `column` aggregate, `dimension` group-by hoặc filter.
- Raw row không xuất qua profile report, Analysis API hoặc PDF/JSON combined report.

## 7. Report, Q&A và retrieval

`GET /api/v1/profile/{run_id}` trả profile đã mask.
`GET /api/v1/profile/{run_id}/report` tạo bounded source document cho combined
export, gồm profile metadata/metrics, section được chọn, linked Analysis
Sessions và export policy. `POST` trên cùng path tạo report workspace từ profile
completed và publish ngay theo flow Analyst hiện tại.

`GET /api/v1/reports` trả thư viện report trong workspace, gồm draft, published
và archived nhưng loại latest version bị rejected. Generic
`POST /api/v1/reports` và `PATCH /api/v1/reports/{report_id}` vẫn hỗ trợ
draft/version/visualization; endpoint `submit` được giữ cho client cũ nhưng hiện
publish trực tiếp, không có bước review tách role.

Agent có hai nhánh evidence:

1. `profile_report`: metric/evidence thuộc đúng profile run.
2. `external_knowledge`: kiến thức data quality/statistics từ corpus ngoài nếu `retrieval.external_knowledge_enabled=true`.

Retrieval áp metadata scope trước ranking. Có thể dùng BM25, Voyage hoặc local embedding fallback. Citation public chỉ chứa source metadata, không trả raw chunk, vector hoặc local path.

Q&A endpoint:

```text
POST /api/v1/qa
POST /api/v1/qa/stream
```

Khi `AGENT_TRACE_MODE=shadow|required`, profiling và Q&A có thêm `agent_run_id`
và `trace_summary` (additive contract). Sự kiện `done` của Q&A SSE cũng mang hai
trường này. `agent_runs`, step/attempt, model/tool invocation, evidence và
append-only trace event là nguồn truy nguyên runtime; LangGraph checkpoint chỉ
dùng resume orchestration.

Generic API luôn scope workspace và yêu cầu capability của Analyst:

```text
GET /api/v1/agent-runs/{run_id}
GET /api/v1/agent-runs/{run_id}/trace?after_sequence=&limit=
GET /api/v1/agent-runs/{run_id}/evidence
GET /api/v1/agent-runs/{run_id}/plan
GET /api/v1/agent-runs/{run_id}/trace-summary
```

Trace lưu reason code/tóm tắt ngắn, version snapshot, hash, timing, metadata
model/tool, query hash, document ID/score retrieval và aggregate evidence đã
redact. Nó không lưu raw prompt/message, chain-of-thought/scratchpad, raw row,
tool argument value, source path, secret hay giá trị PII. Evidence dùng source
content hash khi có; nếu source không được pin, evidence phải mang limitation.

`AGENT_TRACE_MODE=off` không tạo runtime record. `shadow` không làm thay đổi
luồng tương thích hiện có; `required` fail closed khi không thể persist trace.
Q&A hiện trả `verification.status=not_run`; verifier enforce chưa được phát
hành. `/plan` trả `plan: null` khi planner bị khóa.

History ngắn hạn do browser quản lý; backend graph không cung cấp long-term personal memory. PostgreSQL checkpointer phục vụ resume của profiling/HITL, không phải chat memory cá nhân.

## 8. Statistical test và drift

```text
POST /api/v1/profile/{run_id}/test
POST /api/v1/profile/{run_id}/drift
```

Test request có test type, target columns và alpha. Backend áp giới hạn số test và multiple-testing correction theo `stats.fdr_method`.

Drift chỉ so sánh profile run tương thích của cùng dataset. Kết quả lưu findings, severity, metric và summary; frontend không tự suy luận lại kết quả.

## 9. Analysis Workspace

### 9.1 Session và context

Tạo session:

```text
POST /api/v1/analysis-sessions
GET  /api/v1/analysis-sessions
GET  /api/v1/analysis-sessions/{session_id}
```

Một session gắn với một `profile_run_id`. Context version chứa:

```text
row_grain
entity
keys
time_column / timezone
dimensions
measures
ignored_columns
limitations
```

`row_grain` giải thích một dòng đại diện cho gì. `dimensions` là cột dùng chia nhóm/so sánh; `measures` là cột dùng tính sum/mean/median. Đây là semantic allowlist cho exploration và execution.

Approve context:

```text
POST /api/v1/analysis-sessions/{session_id}/context-versions
POST /api/v1/analysis-sessions/{session_id}/context-versions/{context_id}/approve
```

### 9.2 Quality gate

```text
POST /api/v1/analysis-sessions/{session_id}/quality-gate
POST /api/v1/analysis-sessions/{session_id}/quality-issues/{issue_id}/acknowledge
```

Quality gate deterministic, chỉ ghi evidence và không sửa source. Các rule kiểm tra profile completed, pending proposal, row grain, timezone, missingness của measure, sample representativeness và metric readiness.

- `blocked`: không cho execution;
- `warning`: cho phép tiếp tục nhưng phải thấy limitation;
- `passed`: không có issue ngăn cản.

### 9.3 Bounded aggregate và exploration

```text
POST /api/v1/analysis-sessions/{session_id}/executions
GET  /api/v1/analysis-sessions/{session_id}/executions
```

Query contract:

```json
{
  "aggregate": "count | count_distinct | sum | mean | median",
  "column": "price",
  "dimensions": ["city"],
  "filters": [{"column": "status", "operator": "eq", "value": "paid"}],
  "limit": 100,
  "sort": "asc | desc"
}
```

Giới hạn hiện tại: tối đa 3 dimensions, 20 filters, 500 result rows. Source column phải tồn tại trong profile run. Filter values dùng bound parameters; tên cột được validate/quote. Khi semantic context có allowlist, dimension, measure và filter column phải thuộc allowlist đó.

Exploration UI khác profiling report ở chỗ nó trả lời quan hệ giữa các nhóm: so sánh nhóm, xếp hạng cao/thấp và lọc phân khúc. Execution lưu:

```text
execution_id
context_version_id
canonical_query
result_hash
is_approximate
limitations
duration_ms
```

Engine hiện materialize immutable source để aggregate, nhưng cờ
`is_approximate` của execution vẫn được kế thừa từ profile run. Vì vậy session
tạo từ profile sample được gắn limitation approximate ngay cả khi aggregate đọc
full source; contract Preview/Official tách biệt chưa được triển khai.

## 10. Export report có chọn nội dung

Export section keys:

```text
overview
technical_profile
quality
tests
drift
agent_summary
analysis
```

Frontend gửi danh sách section qua query parameter:

```text
GET /api/v1/profile/{run_id}/report?sections=overview,analysis
GET /api/reports/profile/{run_id}?sections=overview,analysis  # PDF proxy
```

Backend filter payload trước khi trả JSON. PDF proxy chuyển tiếp selection và dùng cùng payload. PDF heading được đánh số theo hierarchy:

```text
1. Tổng quan dataset
2. Hồ sơ kỹ thuật
6. Tóm tắt từ Agent
6.1 Một nhóm diễn giải
7. Phân tích nghiệp vụ
7.1 Mục tiêu session
7.1.1 Execution
```

Cover giữ metadata nhận diện report; checklist quyết định các section nội dung phía sau cover. Không truyền section sẽ export đầy đủ.

## 11. Storage và file lớn

`backend/src/services/storage.py` chọn provider theo `STORAGE_PROVIDER`:

| Provider | Vai trò |
| --- | --- |
| `supabase` | Mặc định; source immutable trong private Supabase bucket. |
| `google_drive` | Binary source tùy chọn cho file lớn; metadata vẫn ở Supabase PostgreSQL. |
| `local` | Development/test, không dùng cho production multi-instance. |

Supabase upload file lớn hơn `SUPABASE_STORAGE_RESUMABLE_THRESHOLD_MB` bằng resumable chunks. `SECURITY_MAX_UPLOAD_MB` chỉ là giới hạn ứng dụng; giới hạn plan của Supabase vẫn có hiệu lực. Google Drive dùng OAuth workspace-level, refresh token mã hóa bằng Fernet và resumable upload/download.

Google Drive connection cho phép Analyst có capability
`workspace.storage.connect` tự tạo kết nối; cùng role Analyst có
`workspace.settings.manage` để ngắt kết nối. Kết nối thuộc workspace và OAuth
state có TTL; callback phải khớp redirect URI.

## 12. Configuration và deployment

Nguồn cấu hình:

1. Environment variables trong root `.env`;
2. `config.yaml` cho non-secret defaults;
3. default trong `backend/src/config.py`.

`.env` có ưu tiên hơn `config.yaml`. Production tối thiểu cần:

```env
APP_ENV=production
DATABASE_URL=postgresql+psycopg://...
AUTH_MODE=supabase
SUPABASE_URL=https://...supabase.co
SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SECRET_KEY=...
STORAGE_PROVIDER=supabase
```

Nếu dùng Google Drive thay Supabase Storage, điền toàn bộ `GOOGLE_DRIVE_*` và đặt `STORAGE_PROVIDER=google_drive`. Nếu bật guest với Supabase storage, backend key vẫn cần tồn tại để lưu guest source.

Release database:

```powershell
$env:PYTHONPATH = "backend"
alembic current
alembic upgrade head
```

`DATABASE_MIGRATION_URL` có thể tách connection migration khỏi runtime.

Production không tự tạo schema thiếu; migration phải chạy trước rollout. Không đưa secret vào `NEXT_PUBLIC_*`, image frontend, log hoặc git.

Agent runtime rollout bắt đầu bằng `AGENT_TRACE_MODE=shadow`; verifier,
planner, jobs và memory đều giữ `off/false` cho tới khi migration và deterministic
evaluation gate tương ứng pass. `AGENT_TRACE_MODE=required` fail closed nếu
không thể ghi trace.

Các switch runtime hiện có:

```env
AGENT_TRACE_MODE=off|shadow|required
AGENT_VERIFIER_MODE=off|shadow|enforce
AGENT_PLANNER_ENABLED=false
AGENT_JOBS_ENABLED=false
AGENT_WORKSPACE_MEMORY_ENABLED=false
AGENT_PERSONAL_MEMORY_ENABLED=false
AGENT_RUNTIME_VERSION=2.0.0
AGENT_TRACE_EVENT_LIMIT=500
```

Backend hiện fail fast nếu bật planner, jobs, workspace/personal memory hoặc
`AGENT_VERIFIER_MODE=enforce`; các capability này chưa được release. `shadow`
của verifier chỉ là giá trị cấu hình tương thích, chưa có verifier result được
thực thi trong Q&A.

## 13. Frontend contract

Frontend dùng Next.js 15, React 19, TypeScript, TanStack Query và Supabase SSR. `auth-provider.tsx` bootstrap session, workspace và permissions. `api.ts` gắn token/workspace vào request; React Query cache phải được reset khi logout hoặc switch workspace. Form tạo workspace dùng preset Business, Marketing, IT hoặc Education để điền sẵn context/theme và vẫn cho phép sửa trước khi submit.

Route chính:

```text
/                             public home và nút Analyst trial
/guide                        hướng dẫn public
/login                        Supabase login
/signup                       self-signup Analyst và resend confirmation
/forgot-password              yêu cầu reset password
/auth/callback                PKCE callback và self-signup provisioning
/account/update-password      đặt password mới sau reset
/dashboard                    dashboard Analyst
/datasets                     danh sách dataset trong workspace
/datasets/new                 upload + profile run
/datasets/{datasetId}/runs    lịch sử và tạo profile run mới
/profiles/{runId}             Profile Run Command Center khi feature flag bật
/profiles/{runId}/review      proposal review
/profiles/{runId}/analysis    test, drift, export
/reports                      thư viện report draft/published/archived
/reports/{reportId}           report detail/version và export PDF
/workspaces                   workspace management + preset context/theme
/workspaces/manage            quản lý thành viên và invitation
/settings                     Workspace Context & Theme
/activity                     workspace activity log
/compare                      so sánh profile/drift
/chat                         Agent Q&A
/analyses                     legacy Analysis Session; hidden from left sidebar
/analyses/new                 legacy create route
/analyses/{sessionId}         legacy context, quality gate, exploration
/notebooks                    legacy notebook library; hidden from left sidebar
/notebooks/{notebookId}       legacy notebook detail/cells
```

Navbar public dùng một nút Analyst để bắt đầu trial; không có selector nhiều
role. Guest workspace dùng public topbar kết hợp app shell và có nút `Kết
thúc dùng thử`; signed-in workspace dùng membership/workspace controls.
`AuthProvider` reset React Query cache khi logout/switch workspace. Sau khi
bootstrap, API client gắn `X-Workspace-Id` cho cả signed-in và guest khi có
workspace hiện tại; backend vẫn tự xác minh membership/session.

`/profiles/{runId}` expose Command Center bốn tab `Tổng quan`, `Khám phá`, `Hỏi Agent` và `Báo cáo` khi `NEXT_PUBLIC_UX_COMMAND_CENTER_ENABLED=true`. Explorer tạo Analysis Session lazy ở backend; Preview phải Promote thành Official qua quality gate trước khi Pin. Agent có thể bind execution evidence; Report tab quản lý draft, reorder, unpin, snapshot và export. Legacy URL vẫn truy cập trực tiếp được, nhưng app shell không đưa Analysis/Notebook vào primary navigation.

## 14. Kiểm tra và vận hành

Frontend:

```powershell
cd frontend
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

Backend:

```powershell
.\.venv\Scripts\python.exe -m compileall -q backend/src
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check backend tests
```

Backend tests cần PostgreSQL test database riêng. Health check:

```text
GET http://localhost:8000/health
```

Runtime trace có kiểm tra unit độc lập cho redaction, stable hash và feature
flag fail-closed:

```powershell
$env:PYTHONPATH = "backend"
.\.venv\Scripts\python.exe -m pytest --confcutdir=tests/test_agents -q tests/test_agents/test_runtime_trace.py
```

Trước khi bật `shadow` hoặc `required`, chạy `alembic upgrade head`, xác nhận
RLS workspace và thử ghi/đọc trace bằng principal Analyst tại staging. Không
chạy test tích hợp vào database production.

Khi điều tra lỗi “Failed to fetch”, kiểm tra theo thứ tự:

1. backend health và process port 8000;
2. `NEXT_PUBLIC_API_URL` và CORS origin;
3. Authorization/workspace header;
4. backend log/correlation ID;
5. storage provider, bucket/quota và database connection.

## 15. Giới hạn và quyết định chưa hoàn tất

- Chưa hỗ trợ join nhiều bảng hoặc semantic layer dùng chung cho một Analysis Session.
- Không có arbitrary SQL, raw-row analysis, source cleaning hay rollback;
  Notebook chỉ là working document riêng.
- Deep analysis mới ở mức workflow mở rộng; planner nhiều bước và insight bank chưa phải contract hoàn chỉnh.
- Agent runtime mới phát hành trace/provenance cho profiling và Q&A. Native
  skill registry chỉ phát hành playbook + bounded tool bindings; chưa có planner
  thực thi tự do, verifier enforce, approval workflow, durable
  queue/DLQ, circuit breaker hoặc long-term memory.
- Sample run không mặc định là exact population metric.
- Preview dùng bounded sample và limitation riêng; Official chạy lại trên full
  pinned source. Hard cancellation vẫn phụ thuộc request lifecycle/runtime.
- Đóng tab chỉ xóa guest token ở browser; cleanup workspace/file ở backend phụ
  thuộc retention nếu request cleanup best-effort chưa hoàn tất.
- Published report là snapshot; report versioning nâng cao và viewer filter tương tác chưa phải phạm vi hiện tại.
- Legacy Profile/Analysis/Notebook data model vẫn tồn tại trong compatibility
  window; chưa có kế hoạch drop table/API trong release Command Center này.
- Invitation email cần nối Supabase Auth Admin API hoặc SMTP ở deployment.

## 16. Tài liệu liên quan

- [README.md](../README.md)
- [Architecture](../ARCHITECTURE.md)
- [UX architecture proposal](ux_architecture_proposal.md)
- [UX architecture implementation plan](ux-architecture-implementation-plan.md)
- [.env.example](../.env.example)
- [config.yaml](../config.yaml)
- [Backend migrations](../backend/migrations)
