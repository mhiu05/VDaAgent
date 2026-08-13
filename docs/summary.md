# P-170 — Technical Summary

Tài liệu này mô tả contract kỹ thuật và các boundary quan trọng của P-170. README dành cho cài đặt và user flow; file này dành cho người phát triển, review code và vận hành deployment.

## 1. Mục tiêu và invariant

P-170 là hệ thống profiling và phân tích dữ liệu theo workspace. Một kết quả hợp lệ phải truy được về profile run, context, quality gate và execution tương ứng.

Các invariant chính:

1. Số liệu do deterministic compute tạo ra. LLM không được tự tạo hoặc sửa số.
2. Mọi resource thuộc workspace đều phải được scope ở repository/API boundary.
3. Proposal metadata phải qua review trước các workflow phụ thuộc.
4. Raw SQL, arbitrary code và raw row không phải public contract của Analysis API.
5. PII được mask trong profile/export/answer; PII không được dùng làm aggregate, group-by hoặc filter.
6. Guest là principal tạm thời, không phải Supabase user và không phải storage dài hạn.
7. PDF/JSON export phải phản ánh đúng nhóm nội dung người dùng đã chọn.

## 2. Topology runtime

```text
Browser / Next.js :3000
  ├─ Supabase SSR Auth hoặc guest session
  ├─ React Query API client
  └─ JSON/SSE + Authorization + X-Workspace-Id
                         ↓
FastAPI :8000/api/v1
  ├─ authentication, membership, capability checks
  ├─ profiling LangGraph và Q&A LangGraph
  ├─ DuckDB/pandas/NumPy/SciPy compute
  ├─ repository PostgreSQL
  └─ storage adapter: Supabase Storage / Google Drive / local dev-test
```

Backend mount các router tại `/api/v1`:

- `routes.py`: dataset, profile, Q&A, test, drift và report source.
- `analysis_routes.py`: Analysis Workspace.
- `authz_routes.py`: session, workspace, dashboard và report workflow.
- `google_drive_routes.py`: OAuth connection/status.

Startup tạo/reuse metadata repository và kiểm tra cấu hình. Production yêu cầu PostgreSQL kết nối được, Supabase Auth và storage provider hợp lệ. `/docs` và `/redoc` bị tắt khi `APP_ENV=production`.

## 3. Authentication, tenancy và capability

### 3.1 Auth context

Frontend gửi:

```text
Authorization: Bearer <Supabase access token hoặc guest token>
X-Workspace-Id: <workspace UUID>  # cần khi principal có nhiều membership
```

`backend/src/services/auth.py` xác minh Supabase JWT qua JWKS asymmetric (`ES256`/`RS256`). `backend/src/api/dependencies.py` tạo `RequestContext` gồm:

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

Guest storage được cấu hình bằng `GUEST_STORAGE_PROVIDER`. Guest data có retention giới hạn và cleanup best-effort qua:

```text
DELETE /api/v1/guest/session
```

Không dùng SQLite; metadata vẫn cần PostgreSQL. Guest trial dành cho demo và test user flow, không dành cho dữ liệu cần giữ lâu dài.

### 3.3 Capability catalog

Catalog tập trung tại `backend/src/services/permissions.py`.

| Role | Capability điển hình |
| --- | --- |
| Viewer | `report.published.read`, `report.published.export` |
| Analyst | dataset upload/read, profile run/read/review, test, drift, analysis, Q&A, report draft/submit |
| Admin | Analyst + dataset delete, member management, report review/publish/archive, audit, workspace settings |

Frontend có thể ẩn button, nhưng không phải security boundary. Backend trả `401` cho auth failure, `403` cho thiếu permission, `404` cho resource ngoài tenant và `409 workspace_required` khi cần chọn workspace.

## 4. Data lifecycle

```text
Dataset
  → ProfileRun(sample/full)
  → Proposal metadata
  → Review confirm/reject/edit
  → Profile completed
  → Report / Q&A / Test / Drift / Analysis
```

Các resource quan trọng đều có `workspace_id`:

- dataset và immutable source reference;
- profile run và column stats;
- proposal, statistical test result, drift report;
- analysis session, context version, quality gate, execution;
- report draft/version/visualization;
- audit event và profile retrieval document.

Repository luôn nhận workspace scope khi đọc resource. Không tin `workspace_id`, role hoặc permission do client gửi trong body.

## 5. Profiling pipeline

`POST /api/v1/profile` tạo profile run. Scan mode:

- `sample`: reservoir sample, mặc định 10.000 dòng, phù hợp exploratory workflow;
- `full`: quét toàn bộ source để có metric đầy đủ hơn.

Compute tạo schema/dtype, row count, null percentage, cardinality, uniqueness, duplicate, outlier, numeric summary, top values, date summary, correlation và risk warnings. Source được pin bằng dataset reference; local path không được trả ra public API.

LangGraph hỗ trợ orchestration, resume/checkpoint và narrative. Nếu LLM không có key, compute/profile vẫn có thể chạy; narrative sẽ dùng fallback dạng bảng hoặc được bỏ qua tùy workflow.

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

`GET /api/v1/profile/{run_id}` trả profile đã mask. `GET /api/v1/profile/{run_id}/report` tạo bounded source document cho combined export, gồm profile metadata, report data, linked analysis sessions và export policy.

Agent có hai nhánh evidence:

1. `profile_report`: metric/evidence thuộc đúng profile run.
2. `external_knowledge`: kiến thức data quality/statistics từ corpus ngoài nếu `retrieval.external_knowledge_enabled=true`.

Retrieval áp metadata scope trước ranking. Có thể dùng BM25, Voyage hoặc local embedding fallback. Citation public chỉ chứa source metadata, không trả raw chunk, vector hoặc local path.

Q&A endpoint:

```text
POST /api/v1/qa
POST /api/v1/qa/stream
```

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

Nếu profile run là sample, execution được đánh dấu approximate.

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

Google Drive connection chỉ Admin có capability quản lý tạo/ngắt; Analyst dùng connection đã có. OAuth state có TTL và callback phải khớp redirect URI.

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

## 13. Frontend contract

Frontend dùng Next.js 15, React 19, TypeScript, TanStack Query và Supabase SSR. `auth-provider.tsx` bootstrap session, workspace và permissions. `api.ts` gắn token/workspace vào request; React Query cache phải được reset khi logout hoặc switch workspace.

Route chính:

```text
/login                         Supabase login
/signup                        self-signup khi được bật
/dashboard                     role dashboard
/datasets/new                  upload + profile run
/profiles/{runId}              profile report
/profiles/{runId}/review       proposal review
/profiles/{runId}/analysis     test, drift, export
/analyses/new                  create Analysis Session
/analyses/{sessionId}          context, quality gate, exploration
/chat                          Q&A Agent
/reports/{reportId}            published report
```

Navbar public và home/guide không dùng role card như trạng thái workspace. Guest workspace dùng public topbar kết hợp app shell; signed-in workspace dùng membership/workspace controls.

## 14. Kiểm tra và vận hành

Frontend:

```powershell
cd frontend
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Backend:

```powershell
python -m compileall -q backend/src
python -m pytest -q
```

Backend tests cần PostgreSQL test database riêng. Health check:

```text
GET http://localhost:8000/health
```

Khi điều tra lỗi “Failed to fetch”, kiểm tra theo thứ tự:

1. backend health và process port 8000;
2. `NEXT_PUBLIC_API_URL` và CORS origin;
3. Authorization/workspace header;
4. backend log/correlation ID;
5. storage provider, bucket/quota và database connection.

## 15. Giới hạn và quyết định chưa hoàn tất

- Chưa hỗ trợ join nhiều bảng hoặc semantic layer dùng chung cho một Analysis Session.
- Không có arbitrary SQL, notebook, source cleaning hay rollback.
- Deep analysis mới ở mức workflow mở rộng; planner nhiều bước và insight bank chưa phải contract hoàn chỉnh.
- Sample run không mặc định là exact population metric.
- Guest cleanup khi đóng tab chỉ best-effort.
- Published report là snapshot; report versioning nâng cao và viewer filter tương tác chưa phải phạm vi hiện tại.
- Invitation email cần nối Supabase Auth Admin hoặc SMTP ở deployment.

## 16. Tài liệu liên quan

- [README.md](../README.md)
- [.env.example](../.env.example)
- [config.yaml](../config.yaml)
- [Backend migrations](../backend/migrations)
