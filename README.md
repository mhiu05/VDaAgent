# VDaAgent — Data Profiling & Evidence Workspace

VDaAgent là workspace giúp biến một dataset thành hồ sơ dữ liệu có thể kiểm tra,
review và dùng cho phân tích có evidence.

Nguyên tắc cốt lõi:

- Compute engine tạo các con số deterministic; LLM chỉ diễn giải, retrieval và
  hỗ trợ Q&A.
- Metadata, proposal, quality issue, execution và audit được lưu theo workspace.
- PII và raw row không được đưa vào report/export thông thường.
- Mọi aggregate trong Analysis Workspace đều bounded, không nhận raw SQL từ
  frontend hoặc Agent.

## Luồng sử dụng

```text
Chọn workspace hoặc guest trial
        ↓
Upload dataset → Profiling deterministic
        ↓
Review metadata proposals (semantic type / key / PII)
        ↓
Profile Run Command Center
   ┌───────────┬────────────┬────────────┐
   ↓           ↓            ↓            ↓
Tổng quan   Khám phá     Hỏi Agent    Báo cáo
              ↓            ↓            ↓
       Preview / Official  Evidence   Draft / export
```

Một workflow thông thường:

1. Mở workspace Analyst hoặc dùng guest Analyst để thử sản phẩm.
2. Tải CSV, TSV, Parquet hoặc JSON và chọn `sample` hoặc `full`.
3. Mở profile report, review các proposal metadata còn pending.
4. Làm việc trong **Profile Run Command Center**: xem Tổng quan, Khám phá dữ liệu theo nhóm, hỏi Agent trên evidence và quản lý Báo cáo.
5. Trong tab Khám phá, chạy Preview để kiểm tra nhanh; khi cần dùng làm evidence, Promote thành Official rồi Pin vào Report Draft.
6. Dùng kiểm định thống kê, drift hoặc export từ profile run khi phù hợp.
7. Xuất PDF/JSON theo các section đã chọn.

`/analyses` và `/notebooks` vẫn tồn tại để mở dữ liệu legacy trong thời gian chuyển đổi, nhưng không còn xuất hiện trong left sidebar hoặc là luồng tạo mới ưu tiên.

## Hai luồng truy cập

### Chưa đăng nhập — guest trial

Khi `AUTH_ALLOW_GUEST=true`, người dùng có thể chọn Analyst trên navbar và
dùng workspace tạm mà không cần tạo tài khoản.

- Guest được cấp token riêng cho browser session và workspace guest riêng.
- Guest chỉ bắt đầu sau khi người dùng chủ động chọn Analyst; không tự tạo
  workspace khi chỉ mở Trang chủ hoặc Hướng dẫn.
- Quyền backend vẫn được kiểm tra theo role Analyst, giống luồng đăng nhập.
- Dữ liệu guest không gắn với email hay workspace cá nhân.
- Bấm `Kết thúc dùng thử` sẽ dọn session hiện tại theo kiểu best-effort. Khi
  đóng tab, session trong browser biến mất; dữ liệu backend
  còn lại được dọn theo retention nên không dùng guest trial cho dữ liệu
  production hoặc dữ liệu cần lưu lâu dài.
- Guest mode không dùng SQLite. Metadata vẫn đi qua PostgreSQL; storage dùng
  provider đã cấu hình cho guest (`GUEST_STORAGE_PROVIDER`).

### Đã đăng nhập

Người dùng đăng nhập bằng Supabase Auth. Access token và workspace hiện tại được gửi tới backend trong `Authorization: Bearer` và `X-Workspace-Id`.

- Dữ liệu, lịch sử, report draft và workspace membership được giữ lâu dài.
- Role và capability được resolve lại ở backend cho từng request.
- Analyst có quyền upload, profiling, review metadata, test, drift, Q&A, Command Center, report workflow, audit và workspace settings. API/route Analysis và Notebook legacy vẫn tồn tại trong compatibility window nhưng không còn nằm trên điều hướng chính.
Trang chủ và Hướng dẫn chỉ là trang tổng quan; không gắn trạng thái role hiện tại.
Role/workspace chỉ có ý nghĩa khi người dùng bước vào workspace.

### Đăng ký, xác nhận email và callback

Self-signup được bật bằng cả `AUTH_ALLOW_SIGNUP=true` ở backend và
`NEXT_PUBLIC_AUTH_ALLOW_SIGNUP=true` ở frontend. Người dùng đăng ký với role
Analyst cố định. Sau khi Supabase gửi email xác nhận:

1. Người dùng mở link trong cùng browser/device đã đăng ký.
2. `/auth/callback` lấy session PKCE do Supabase SSR client xử lý; ứng dụng
   không exchange cùng một code lần thứ hai.
3. Backend tạo hoặc trả về personal workspace và membership Analyst.
4. Ứng dụng chuyển tới `/dashboard` sau khi provision thành công.

Tài khoản Supabase đã được tạo trước đó hoặc tạo ngoài form `/signup` cũng được
tự khôi phục: khi đăng nhập, nếu chưa có membership active, frontend gọi lại
provision idempotent với role Analyst rồi tải lại workspace.
Membership hiện có không bị thay đổi.

Trang đăng ký có nút gửi lại email với cooldown 120 giây. Việc gửi mail vẫn
chịu rate limit của Supabase; khi cần gửi nhiều email trong quá trình test,
nên cấu hình SMTP riêng. Gmail có thể gộp các email xác nhận vào cùng một
thread, vì vậy cần mở rộng thread hoặc kiểm tra Spam/Promotions.

## Tính năng chính

- Profiling deterministic: schema, dtype, missingness, cardinality, uniqueness, duplicate, outlier, top values và correlation.
- Human-in-the-loop review cho semantic type, candidate key và PII proposal.
- Profile report có provenance, narrative summary và các metric đã kiểm chứng.
- **Profile Run Command Center** tập trung năm tab Tổng quan, Khám phá, Biểu đồ, Hỏi Agent và Báo cáo vào đúng profile run.
- Explorer dùng bounded aggregate, Preview/Official, preset so sánh nhóm và Pin evidence vào Report Draft.
- Q&A theo profile evidence; có thể mở rộng tới external knowledge base nếu được cấu hình.
- Statistical tests với alpha và multiple-testing correction; drift giữa hai profile run cùng dataset.
- Workspace tạo mới có preset Business, Marketing, IT và Education để điền sẵn context/theme; người dùng vẫn có thể chỉnh sửa trước khi tạo.
- Export PDF hoặc JSON với checklist section, draft/snapshot và provenance.
- Google Drive storage tùy chọn cho file lớn; Supabase vẫn là nguồn sự thật cho Auth, workspace, permission, metadata và audit.
- Native skill registry cung cấp playbook versioned cho profiling, quality diagnosis, drift, Q&A và report; tool binding luôn bounded và tenant-scoped.

## Kiến trúc

```text
Next.js :3000
  ├─ Supabase SSR browser Auth / PKCE + guest transport
  └─ HTTP JSON + SSE + X-Workspace-Id
                    ↓
FastAPI :8000/api/v1
  ├─ JWT/JWKS + workspace membership + capability checks
  ├─ LangGraph profiling/Q&A + native skill registry + runtime trace (opt-in)
  ├─ DuckDB / pandas / NumPy / SciPy compute
  ├─ PostgreSQL: metadata, checkpoint, retrieval, audit, agent-run provenance
  └─ Storage adapter: Supabase Storage hoặc Google Drive
```

Chi tiết component architecture và data flow: [ARCHITECTURE.md](ARCHITECTURE.md).

Các thư mục quan trọng:

### Project structure

```text
backend/src/api/                 FastAPI routes
backend/src/agents/              LangGraph, runtime trace, prompts và read-only tools
backend/src/agents/skills/       Native SKILL.md playbooks, registry và bounded bindings
backend/src/services/            compute, storage, retrieval, auth, quality gate
backend/src/models/              Pydantic contracts
backend/migrations/              Alembic migrations
frontend/src/app/                Next.js pages và API route cho PDF
frontend/src/components/         app shell, navbar, auth và UI dùng chung
frontend/src/lib/                API client, auth, types, SSE
scripts/                         knowledge-base và auth migration utilities
tests/                           backend/API/compute/security tests
data/knowledge_base/             corpus retrieval local
```

### Trạng thái skill của agent

Agent không dùng DB-GPT SkillManager/SkillLoader. Native registry tại
`backend/src/agents/skills/registry.py` đăng ký 5 playbook versioned:
`profile-dataset`, `diagnose-data-quality`, `compare-profile-drift`,
`answer-business-question` và `generate-report`.

Skill là playbook; tool là thao tác có contract. Registry bind tool names theo
allowlist và route workflow có side effect về API đã phân quyền. Hai skill
read-only có catalog/inspect API dưới `/api/v1/agent-skills`; mỗi inspect kiểm
tra workspace scope trước khi gọi tool. Q&A chọn playbook bằng routing
deterministic nhưng guardrail, capability và bounded tool registry vẫn là
authority. Contract nguồn nằm trong từng `SKILL.md` dưới
`backend/src/agents/skills/` và registry tương ứng.

## Yêu cầu

- Python 3.11+
- Node.js 20+
- pnpm 9+
- PostgreSQL (metadata, membership và LangGraph checkpoint; dùng Supabase
  PostgreSQL cho production)
- Git
- LLM key tùy chọn về mặt compute; nếu thiếu, profiling/test/drift vẫn chạy,
  nhưng narrative/Q&A có thể không hoạt động hoặc dùng fallback.

## Agent runtime trace (rollout an toàn)

Agent runtime v2 bổ sung provenance/trace cho **profiling** và **Q&A**. Đây là
lớp quan sát bổ sung, không thay đổi deterministic compute hiện có và không mở
quyền SQL, code, shell hay dynamic tool tự do. Mặc định mọi runtime record đều
tắt:

```env
AGENT_TRACE_MODE=off
AGENT_VERIFIER_MODE=off
AGENT_PLANNER_ENABLED=false
AGENT_JOBS_ENABLED=false
```

Sau khi áp migration và kiểm tra staging, đặt `AGENT_TRACE_MODE=shadow` để ghi
trace đã redact trong khi workflow cũ vẫn là nguồn kết quả. `required` chỉ phù
hợp khi database trace đã được giám sát: nếu không thể ghi trace, request sẽ
fail closed. `off` không tạo `agent_run`.

`POST /profile`, `POST /qa` và sự kiện `done` của `POST /qa/stream` trả thêm
`agent_run_id` và `trace_summary` khi trace được bật; các trường này là additive
nên client cũ có thể bỏ qua. Analyst có thể đọc run, timeline, evidence, plan
projection và summary qua `/api/v1/agent-runs/{run_id}`.

Trace chỉ lưu reason code/tóm tắt ngắn, hash, phiên bản, thời lượng, metadata
tool/model và aggregate evidence đã giới hạn. Nó không lưu raw prompt/message,
chain-of-thought/scratchpad, raw row, secret, đường dẫn source hay giá trị PII.
Dataset mới có content hash và source version để tái lập provenance; trace của
nguồn cũ không có hash sẽ nêu limitation thay vì khẳng định source đã được pin.

Các lớp dưới đây **chưa phát hành** và phải để nguyên như cấu hình mặc định:
planner, verifier `enforce`, durable jobs, workspace memory và personal memory.
Backend từ chối khởi động nếu bật planner/jobs/memory hoặc verifier `enforce`.
Endpoint `/plan` hiện trả `{ "plan": null }` khi planner chưa được bật.

Quy trình rollout khuyến nghị:

1. Chạy `alembic upgrade head` và kiểm tra RLS/khả năng ghi PostgreSQL trên staging.
2. Bật `AGENT_TRACE_MODE=shadow`, kiểm tra trace đã redact và không làm thay đổi kết quả profiling/Q&A.
3. Chỉ cân nhắc `required` sau khi đã có giám sát lỗi ghi trace và quy trình xử lý sự cố.

## Cài đặt local

### Windows PowerShell

Từ thư mục root:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
Copy-Item .env.example .env

corepack enable
cd frontend
pnpm install
cd ..
```

Mở `.env` và tối thiểu điền:

```env
APP_ENV=development
DATABASE_URL=postgresql+psycopg://USER:PASSWORD@HOST:5432/postgres
AUTH_MODE=dual
AUTH_ALLOW_GUEST=true
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
UX_COMMAND_CENTER_ENABLED=true
NEXT_PUBLIC_UX_COMMAND_CENTER_ENABLED=true
```

Nếu dùng Supabase Auth/Storage, điền thêm `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY` và `SUPABASE_SECRET_KEY`. Không đưa secret key vào
`NEXT_PUBLIC_*`.

Sau khi có database, áp migration trước request đầu tiên:

```powershell
$env:PYTHONPATH = "backend"
alembic upgrade head
```

Local có thể dùng `AUTH_MODE=dual` trong giai đoạn chuyển đổi, nhưng deployment
production phải dùng `AUTH_MODE=supabase`. `AUTH_ALLOW_GUEST` ở backend là
quyết định quyền truy cập guest. Đặt `NEXT_PUBLIC_AUTH_ALLOW_GUEST` cùng giá trị
khi build frontend để cấu hình triển khai nhất quán, nhưng backend vẫn là nơi
chấp nhận hoặc từ chối guest token.

Khởi động hai terminal:

```powershell
# Terminal 1
.\.venv\Scripts\python.exe -m uvicorn src.main:app --app-dir backend --reload --host 0.0.0.0 --port 8000
```

```powershell
# Terminal 2
cd frontend
pnpm dev --port 3000
```

Nhóm forecast core (Baseline, Exponential Smoothing, ARIMA, State Space và scikit-learn) nằm trong `requirements.txt`. Muốn bật thêm XGBoost, LightGBM, CatBoost, Prophet và NeuralProphet:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-forecast-full.txt
```

### macOS/Linux

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
cp .env.example .env
corepack enable
cd frontend && pnpm install && cd ..
```

Chạy backend bằng `.venv/bin/python` và frontend bằng `pnpm dev --port 3000`.

Sau khi khởi động:

- Frontend: <http://localhost:3000>
- Health: <http://localhost:8000/health>
- API docs: <http://localhost:8000/docs> khi `APP_ENV` không phải `production`
- API prefix: <http://localhost:8000/api/v1>

Có thể dùng shortcut trên Windows nếu đã cài Make:

```text
make install
make dev
make health
make frontend-check
make frontend-build
```

## Cấu hình storage

### Supabase Storage mặc định

```env
STORAGE_PROVIDER=supabase
SUPABASE_STORAGE_BUCKET=p170-dataset
SUPABASE_STORAGE_PREFIX=datasets
SUPABASE_STORAGE_TIMEOUT_SECONDS=300
SUPABASE_STORAGE_RESUMABLE_THRESHOLD_MB=6
SUPABASE_STORAGE_CHUNK_MB=6
```

File lớn hơn ngưỡng resumable được upload theo chunk. Giới hạn ứng dụng mặc định
là `SECURITY_MAX_UPLOAD_MB=500`, nhưng Supabase Free có giới hạn file thực tế
50 MB. Nếu bucket/provider từ chối file lớn hơn giới hạn plan, cần dùng provider
khác hoặc nâng plan.

### Google Drive cho file lớn

Google Drive chỉ lưu binary source; Supabase vẫn lưu Auth, workspace, quyền,
dataset metadata và audit.

1. Tạo OAuth Web Client trong Google Cloud, bật Google Drive API.
2. Thêm redirect URI chính xác:
   `http://localhost:8000/api/v1/google-drive/callback`.
3. Tạo folder private và lấy ID sau `/folders/` làm `GOOGLE_DRIVE_FOLDER_ID`.
4. Tạo key mã hóa token:

   ```powershell
   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```

5. Điền `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`,
   `GOOGLE_DRIVE_FOLDER_ID`, `GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY` và:

   ```env
   STORAGE_PROVIDER=google_drive
   ```

6. Restart backend, vào `/datasets/new`, chọn Kết nối Google Drive và hoàn tất
   OAuth. Kết nối thuộc workspace; Analyst có quyền upload có thể tự
   kết nối, sau đó các thành viên trong workspace có thể upload.

Không commit OAuth client secret, refresh token, Fernet key, `.env` hoặc API key.

## Role và capability

| Role | Phạm vi chính |
| --- | --- |
| Analyst | Upload, profiling, review metadata, test, drift, Command Center (Khám phá, Hỏi Agent, Báo cáo), quản lý member, review/publish/archive report, audit, workspace settings và đọc agent run/trace trong workspace. API Analysis/Notebook legacy vẫn được giữ trong compatibility window. |

Workspace chỉ có một role `analyst`. Các role legacy (`owner`, `admin`, `viewer`)
được chuẩn hóa thành `analyst` ở trust boundary.

Frontend chỉ ẩn/hiện action để UX rõ hơn. Backend mới là nơi quyết định quyền.
Thông thường: `401` là auth không hợp lệ, `403` là thiếu capability, `404` là
resource không thuộc workspace, `409 workspace_required` là cần chọn workspace.

## Route frontend chính

```text
/                             Trang chủ
/guide                        Hướng dẫn
/login                        Đăng nhập Supabase
/signup                       Đăng ký Analyst và gửi lại email xác nhận
/forgot-password              Yêu cầu reset password
/auth/callback                Callback PKCE và provision workspace
/account/update-password      Đặt mật khẩu mới sau reset
/dashboard                    Dashboard Analyst
/datasets                     Dataset và profile runs
/datasets/new                 Upload và tạo profiling run
/datasets/{datasetId}/runs    Lịch sử profile của dataset
/charts                       Chọn Profile Run và mở workspace Biểu đồ
/profiles/{runId}             Profile Run Command Center khi feature flag bật
/profiles/{runId}/review      Review proposal metadata
/profiles/{runId}/analysis    Kiểm định, drift và export
/reports                      Thư viện report draft/snapshot/published
/reports/{reportId}           Chi tiết report/version và xuất PDF
/workspaces                   Tạo/chọn workspace với preset context/theme
/workspaces/manage            Quản lý thành viên và lời mời
/settings                     Chỉnh Workspace Context & Theme
/activity                     Workspace activity log
/compare                      So sánh profile/drift
/chat                         Agent Q&A
/analyses                     Legacy Analysis Session, không hiển thị ở left sidebar
/analyses/new                 Legacy create route
/analyses/{sessionId}         Legacy context, quality gate và exploration
/notebooks                    Legacy notebook library, không hiển thị ở left sidebar
/notebooks/{notebookId}       Legacy notebook detail/cells
/api/reports/profile/...      Next.js PDF proxy cho profile report
```

Public navbar chỉ hiển thị một lựa chọn dùng thử là Analyst. Guest chỉ được tạo
sau khi người dùng chủ động chọn Analyst; nút `Kết thúc dùng thử` xóa token
guest khỏi browser và yêu cầu backend dọn workspace tạm theo kiểu best-effort.

## API nhóm chính

API backend có prefix `/api/v1`; riêng PDF profile report đi qua Next.js proxy
`/api/reports/profile/{runId}` để giữ cùng export section contract.

API mới tuân theo REST: collection dùng danh từ số nhiều, resource con được lồng
theo resource cha, `POST` tạo resource, `GET` đọc, `PATCH` cập nhật một phần và
`DELETE` lưu trữ/xóa theo policy. Ví dụ Notebook dùng `PATCH /notebooks/{id}`
cho đổi tên, visibility và khôi phục; không dùng endpoint lệnh `/share` hoặc
`/restore`.

```text
GET       /session, /me
GET/POST  /workspaces
GET       /workspaces/archived
DELETE    /workspaces/{workspace_id}
POST      /workspaces/{workspace_id}/restore
DELETE    /workspaces/{workspace_id}/permanent
GET       /dashboard, /status, /audit
POST      /onboarding/provision
DELETE    /guest/session
POST      /invitations/accept
GET       /workspaces/current/members
GET/POST  /workspaces/current/invitations
PATCH     /workspaces/current/members/{user_id}
DELETE    /workspaces/current/invitations/{invitation_id}
POST      /datasets/upload
GET       /datasets
PATCH     /datasets/collection
DELETE    /datasets/{dataset_id}
GET       /datasets/{dataset_id}/runs
POST      /profile
GET       /profile/{run_id}
GET       /profile/{run_id}/export
PATCH     /profile/{run_id}/confirm
POST      /profile/{run_id}/test
POST      /profile/{run_id}/drift
GET/POST  /profile/{run_id}/report
POST      /qa và /qa/stream

GET       /agent-skills
GET       /agent-skills/{skill_name}
POST      /agent-skills/{skill_name}/inspect

GET       /agent-runs/{run_id}
GET       /agent-runs/{run_id}/trace
GET       /agent-runs/{run_id}/evidence
GET       /agent-runs/{run_id}/plan
GET       /agent-runs/{run_id}/trace-summary

GET/POST  /analysis-sessions
GET       /analysis-sessions/{id}
POST      /analysis-sessions/{id}/context-versions
POST      /analysis-sessions/{id}/context-versions/{context_id}/approve
POST      /analysis-sessions/{id}/quality-gate
POST      /analysis-sessions/{id}/quality-issues/{issue_id}/acknowledge
GET/POST  /analysis-sessions/{id}/executions

GET/POST  /notebooks
GET/PATCH/DELETE /notebooks/{notebook_id}
POST      /notebooks/{notebook_id}/cells
PATCH/DELETE /notebooks/{notebook_id}/cells/{cell_id}
GET       /notebooks/{notebook_id}/export

GET/POST  /reports
GET/PATCH/DELETE /reports/{report_id}
POST      /reports/{report_id}/submit|review|publish|archive
GET       /reports/{report_id}/export-source

GET       /google-drive/status
GET       /google-drive/connect
GET       /google-drive/callback
DELETE    /google-drive/connection

```

## Kiểm tra trước khi commit

Kiểm tra nhanh riêng cho runtime trace (không cần khởi tạo fixture PostgreSQL
tích hợp):

```powershell
$env:PYTHONPATH = "backend"
.\.venv\Scripts\python.exe -m pytest --confcutdir=tests/test_agents -q tests/test_agents/test_runtime_trace.py
```

Từ `frontend/`:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

Health backend:

```powershell
Invoke-RestMethod http://localhost:8000/health
```

Test cần PostgreSQL test database riêng. Không trỏ test vào database development hoặc production.

Trước khi chạy full backend suite, tạo database test và đặt DSN trong terminal hiện tại:

```powershell
$env:P170_TEST_DATABASE_URL = "postgresql+psycopg://p170_test:<password>@localhost:5432/p170_test"
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check backend tests
```

`P170_TEST_DATABASE_URL` là bắt buộc để tránh test vô tình ghi vào database ứng dụng.

## Giới hạn hiện tại

- Một Analysis Session gắn với một profile run; chưa hỗ trợ join nhiều bảng.
- Analysis không nhận arbitrary SQL, raw-row query hoặc cleaning recipe;
  Notebook là một artifact riêng, không phải execution engine.
- `deep` mode vẫn là workflow mở rộng; planner/approval nhiều bước chưa hoàn tất
  như quick bounded analysis.
- Agent runtime hiện chỉ có trace/provenance cho profiling và Q&A. Chưa có
  planner thực thi, verifier enforce, approval workflow, durable queue/DLQ,
  circuit breaker hay long-term memory.
- Sample run phù hợp khám phá nhanh, không mặc định là số liệu exact.
- `AnalysisEngine` hiện materialize immutable source để aggregate nhưng vẫn kế
  dùng sampling thật cho Preview; Official đọc full pinned source và có provenance
  riêng. Preview không thể Pin trực tiếp.
- Guest trial không phải cơ chế lưu trữ dài hạn.
- Published report là snapshot; thay đổi lớn cần tạo draft/version theo workflow
  report hiện có.
- Legacy Analysis Session và Notebook vẫn có page/API riêng trong compatibility
  window; navigation chính ẩn chúng khi Command Center flag được bật.

## Tài liệu liên quan

- [Technical summary](docs/summary.md)
- [Architecture](ARCHITECTURE.md)
- [UX architecture proposal](docs/ux_architecture_proposal.md)
- [UX architecture implementation plan](docs/ux-architecture-implementation-plan.md)
- [.env.example](.env.example)
- [config.yaml](config.yaml)
- [Makefile](Makefile)
