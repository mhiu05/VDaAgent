# Thông tin nhóm

- **Tên nhóm:** VduAgents
- **Link demo:** <https://p170-web-08140019.azurewebsites.net/>

## Thành viên nhóm

- NGUYỄN MINH HIẾU — 2A2202601154
- PHẠM THẾ ĐĂNG — 2A202601766
- PHẠM THỊ THÙY LINH — 2A202601181
- VŨ NGUYỄN BẢO SƠN — 2A202601116

## Thông tin liên hệ

- SĐT: 0375049906
- Email: minhhieuhh2k5@gmail.com

# VDaAgent — Data Profiling Workspace

VDaAgent biến một tệp dữ liệu thành hồ sơ có thể kiểm tra, biểu đồ có bằng
chứng và báo cáo có thể truy nguyên. Đơn vị làm việc trung tâm là **Profile
Run** thuộc một **workspace**; profile, chart, câu trả lời của Agent, report,
audit event và trace đều phải gắn với đúng workspace đó.

```text
Đăng nhập Supabase (guest trial chỉ khi được bật)
        → workspace
        → upload dataset
        → tạo Profile Run dạng job
        → profiling deterministic trong worker
        → review metadata / PII nếu cần
        → Profile Run completed
             ├─ Charts: plan → Preview → Official evidence → insight
             ├─ Chat Agent: hỏi đáp theo evidence của Profile Run
             ├─ Compare: drift giữa hai Profile Run
             └─ Report Draft → snapshot bất biến → PDF / JSON
```

Các nguyên tắc chính:

- Các con số do DuckDB/pandas và các compute adapter tạo ra; LLM chỉ lập kế
  hoạch, diễn giải hoặc trả lời trong phạm vi evidence được cấp.
- UI, Agent và report không cung cấp raw row hoặc giá trị PII thô.
- Browser không gửi SQL, Python hay shell tùy ý. Mọi phân tích dùng
  `QuerySpec` có allow-list, giới hạn thời gian và giới hạn kết quả.
- Backend xác thực identity, workspace và capability trước mọi thao tác nhạy
  cảm. Frontend permission check chỉ là lớp UX; backend mới là ranh giới bảo
  mật cuối cùng.

## Sản phẩm hiện tại

VDaAgent phục vụ Data Analyst và Business Analyst cần khám phá dữ liệu, kiểm
tra chất lượng và trình bày insight có provenance. Luồng chính gồm:

- Profiling CSV, TSV, Parquet và JSON: schema, kiểu dữ liệu, missingness,
  cardinality, uniqueness, duplicate, outlier, top values, correlation và
  risk/PII proposal.
- Profile job bền vững: API trả `202 Accepted`, worker claim job từ
  PostgreSQL bằng lease, retry lỗi tạm thời trong giới hạn và resume sau bước
  human-in-the-loop review.
- Datasource ngoài qua giao diện **MySQL, MongoDB và DuckDB**. Backend kiểm tra
  kết nối, mã hóa credential bằng Fernet và materialize nguồn thành file tạm để
  dùng chung pipeline DuckDB/pandas hiện có. MySQL/DuckDB chỉ nhận tên bảng
  hoặc câu lệnh `SELECT`/`WITH` chỉ-đọc; MongoDB chỉ nhận collection và JSON
  filter. Mỗi lần materialize bị chặn ở 1.000.000 dòng.
- Charts tại `/charts`: profile pack tự động hoặc câu hỏi tự nhiên → chart
  plan → Preview bounded → Official evidence. Backend kiểm tra cột, phép
  aggregate, PII policy, context version, budget và idempotency.
- 15 loại chart native đang được phát hành: line, bar, table, KPI, histogram,
  scatter, box, heatmap, missing-value bar/heatmap, correlation heatmap,
  cardinality, violin, donut và outlier.
- Forecast chuỗi thời gian với catalog **28 model**. Model chỉ chạy khi
  dependency và contract dữ liệu phù hợp; kết quả có interval và limitation,
  không phải giá trị chắc chắn.
- Chat Agent tại `/chat`, Q&A theo Profile Run, evidence và trace đã redact.
- Compare tại `/compare`: PSI, cardinality, null rate và distribution giữa hai
  Profile Run hoàn tất.
- Report Draft: ghim Official evidence, chỉnh sửa insight, tạo snapshot bất
  biến và xuất PDF/JSON. Snapshot là nguồn chính thức để chia sẻ.
- Workspace: tạo, archive/restore, thành viên, invitation, cấu hình AI/nghiệp
  vụ, theme, compute/statistics, PII policy và audit activity.
- Admin system: đăng nhập bằng cùng giao diện `/login`, sau đó truy cập
  `/admin` nếu có system role `admin`; có thể tạo Analyst bằng mật khẩu hoặc
  gửi Supabase email invite, xem, tìm kiếm, khóa/mở khóa, đổi role
  `analyst`/`admin` và xóa tài khoản người dùng.
- Guest trial: chỉ hiển thị và bắt đầu khi đồng thời bật `AUTH_ALLOW_GUEST` ở
  backend và `NEXT_PUBLIC_AUTH_ALLOW_GUEST` ở frontend; dữ liệu nằm trong
  storage/retention policy riêng và không thay thế workspace production.

## Auth, role và route

### Đăng nhập người dùng và admin

Frontend có một giao diện đăng nhập chung tại `/login`, dùng Supabase Auth với
email và mật khẩu. Không có `/admin/login` riêng. Sau khi đăng nhập, backend
đồng bộ user profile và trả về workspace cùng `effective_permissions` qua
`GET /api/v1/workspace-bootstrap`.

Signup công khai tại `/signup` chỉ tạo tài khoản Analyst khi
`AUTH_ALLOW_SIGNUP=true` và `NEXT_PUBLIC_AUTH_ALLOW_SIGNUP=true`. Supabase
email confirmation là bắt buộc trong cấu hình production. Link xác nhận signup
quay về `/auth/callback`; link reset password quay về
`/account/update-password`. `/auth/confirm` không phải route của ứng dụng hiện
tại, vì vậy không thêm route này vào Supabase Redirect URLs nếu chưa triển khai
custom token-hash flow. `/forgot-password` khởi tạo email reset và
`/account/update-password` xử lý đổi mật khẩu.

Redirect URLs cần khai báo trong Supabase Auth > URL Configuration:

```text
https://p170-web-08140019.azurewebsites.net/auth/callback
https://p170-web-08140019.azurewebsites.net/account/update-password
http://localhost:3000/auth/callback
http://localhost:3000/account/update-password
```

`NEXT_PUBLIC_SITE_URL` phải trỏ tới origin đang chạy (`http://localhost:3000`
ở local, domain Azure ở production). Các biến `NEXT_PUBLIC_*` được nhúng vào
bundle lúc build, nên đổi cờ auth phải build/restart frontend mới có hiệu lực.

Hệ thống có hai khái niệm cần phân biệt:

- **System role:** lưu ở `user_profiles.role`, hiện có `analyst` và `admin`.
  `admin` chỉ nhận quyền quản trị tài khoản/hệ thống. Các email trong
  `GLOBAL_ADMIN_EMAILS` chỉ seed role khi profile mới được tạo; trạng thái DB là
  authority sau đó.
- **Workspace membership role:** membership workspace hiện chuẩn hóa về
  `analyst`. System admin không được overlay thành workspace admin và không
  inherit Analyst capabilities. Việc mời thành viên workspace không tự cấp
  system admin.
- **Account status:** mọi request của permanent account mang bearer JWT đều kiểm tra
  `user_profiles.status` ở backend. `locked` và `deleted` bị từ chối ngay cả
  khi JWT chưa hết hạn; chỉ account Analyst đang active mới có thể nhận invite
  hoặc provision workspace.

Các route frontend chính:

| Nhóm | Route |
| --- | --- |
| Public | `/`, `/about`, `/guide`, `/docs`, `/contact` |
| Auth | `/login`, `/signup`, `/forgot-password`, `/auth/callback`, `/account/update-password` |
| Analyst workspace | `/dashboard`, `/workspaces`, `/workspaces/manage`, `/datasets`, `/datasets/new`, `/connectors`, `/profiles/{runId}`, `/profiles/{runId}/review`, `/charts`, `/chat`, `/compare`, `/reports`, `/reports/{reportId}`, `/activity`, `/settings`, `/account` |
| System admin | `/admin`, `/account` |
| PDF/health | `/api/reports/profile/{runId}`, `/health` |

`/admin` được kiểm tra bởi permission `user.accounts.read`; các thao tác thay
đổi tài khoản yêu cầu `user.account.manage`. API vẫn kiểm tra Bearer token,
workspace context và permission cho mỗi request, kể cả khi UI đã ẩn route.

## Tech stack

| Lớp | Công nghệ |
| --- | --- |
| Frontend | Next.js 15, React 19, TypeScript, React Query, Supabase SSR/PKCE |
| Backend | FastAPI, Python 3.11+, Pydantic, SQLAlchemy, Alembic |
| Agent | LangGraph, LangChain, OpenAI/Gemini/Ollama tùy cấu hình, LangSmith tùy chọn |
| Compute | DuckDB, pandas, NumPy, SciPy, statsmodels, scikit-learn |
| Forecast | 28 adapter; model ngoài core chỉ khả dụng khi dependency được cài |
| Data/Auth | PostgreSQL/Supabase Auth, Supabase Storage/Google Drive, connector MySQL/MongoDB/DuckDB |
| Quality/Deploy | pytest, Ruff, Vitest, Playwright, Docker, Azure App Service, GitHub Actions |

## Quick start

Yêu cầu tối thiểu: Python 3.11+, Node.js 20+ (CI và image frontend dùng
Node.js 22), pnpm 11+, PostgreSQL và Git.

### Windows PowerShell

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
Copy-Item .env.example .env

corepack enable
Set-Location frontend
pnpm install
Set-Location ..
```

Cho local development, cập nhật `.env` tối thiểu. Dùng một PostgreSQL
development/test riêng; không trỏ các biến dưới đây vào database production:

```env
APP_ENV=development
DATABASE_URL=postgresql+psycopg://USER:PASSWORD@HOST:5432/p170_dev
DATABASE_CHECKPOINTER_URL=postgresql+psycopg://USER:PASSWORD@HOST:5432/p170_dev
AUTH_MODE=supabase
AUTH_ALLOW_GUEST=false
AUTH_ALLOW_SIGNUP=true
AUTH_REQUIRE_EMAIL_CONFIRMED=true
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_AUTH_ISSUER=https://<project-ref>.supabase.co/auth/v1
SUPABASE_AUTH_AUDIENCE=authenticated
SUPABASE_PUBLISHABLE_KEY=<publishable-key>
STORAGE_PROVIDER=local
GUEST_STORAGE_PROVIDER=local
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000/api/v1
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
NEXT_PUBLIC_AUTH_ALLOW_GUEST=false
NEXT_PUBLIC_AUTH_ALLOW_SIGNUP=true
UX_COMMAND_CENTER_ENABLED=true
NEXT_PUBLIC_UX_COMMAND_CENTER_ENABLED=true
```

`AUTH_MODE=supabase` giúp local kiểm tra đúng flow production. Chỉ dùng
`AUTH_MODE=dual` trong migration window hoặc khi cần tương thích auth legacy.
`P170_TEST_DATABASE_URL` phải là database khác `DATABASE_URL` khi chạy pytest;
test có thể chạy migration và ghi fixture. Không commit `.env`,
`frontend/.env.local`, database URL, service/secret key, OAuth secret, refresh
token hay LLM API key.

Áp migration trước request đầu tiên:

```powershell
$env:PYTHONPATH = backend
alembic upgrade head
```

Mở ba terminal từ root repository:

```powershell
# Terminal 1: FastAPI
.\.venv\Scripts\python.exe -m uvicorn src.main:app --app-dir backend --reload --host 0.0.0.0 --port 8000
```

```powershell
# Terminal 2: profiling worker
$env:PYTHONPATH = backend
.\.venv\Scripts\python.exe -m src.workers.profiling_worker
```

```powershell
# Terminal 3: Next.js
Set-Location frontend
pnpm dev --port 3000
```

Hoặc dùng shortcut trong [Makefile](Makefile): `make install`, `make dev`,
`make health`, `make frontend-check` và `make frontend-build`.

### macOS/Linux

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
cp .env.example .env
corepack enable
(cd frontend && pnpm install)
PYTHONPATH=backend alembic upgrade head
```

Chạy API bằng `.venv/bin/python -m uvicorn src.main:app --app-dir backend
--reload`, worker bằng `PYTHONPATH=backend .venv/bin/python -m
src.workers.profiling_worker`, và frontend bằng `pnpm dev --port 3000` trong
thư mục `frontend`.

Sau khi khởi động:

- Frontend: <http://localhost:3000>
- Backend health: <http://localhost:8000/health>
- OpenAPI docs: <http://localhost:8000/docs> (không dùng để public production)
- API prefix: <http://localhost:8000/api/v1>

## Storage và cấu hình production

Supabase Auth là nguồn sự thật cho identity/session. PostgreSQL lưu user
profile, workspace, membership, dataset metadata, Profile Run, evidence,
report, audit và trace. Frontend chỉ nhận biến `NEXT_PUBLIC_*` an toàn.

`STORAGE_PROVIDER` nhận `supabase`, `google_drive` hoặc `local`. Production
dùng Supabase Storage hoặc Google Drive; local storage chỉ dành cho
development/test. Khi dùng Google Drive, binary dataset đi qua OAuth callback
backend `/api/v1/google-drive/callback`; metadata, workspace và audit vẫn ở
PostgreSQL. Guest có storage provider và retention riêng.

Supabase Auth là nguồn sự thật cho identity/session. Backend xác minh JWT bằng
issuer `<SUPABASE_URL>/auth/v1` và audience `authenticated`; giữ hai giá trị
này rõ ràng ở production để tránh lỗi login thành công nhưng
`/workspace-bootstrap` trả `401`. Publishable key có thể xuất hiện trong
frontend, còn `SUPABASE_SECRET_KEY`, service key và database credential chỉ ở
server/Azure App Settings.

Các biến cần chú ý:

| Biến | Ý nghĩa |
| --- | --- |
| `DATABASE_URL` / `DATABASE_CHECKPOINTER_URL` | PostgreSQL cho metadata và LangGraph checkpoint |
| `AUTH_MODE` / `AUTH_REQUIRE_EMAIL_CONFIRMED` | Cơ chế và điều kiện xác thực |
| `AUTH_ALLOW_SIGNUP` / `AUTH_ALLOW_GUEST` | Bật signup và guest trial |
| `SUPABASE_URL` / `SUPABASE_AUTH_ISSUER` / `SUPABASE_AUTH_AUDIENCE` | Supabase project và thông tin verify JWT; production dùng issuer `<SUPABASE_URL>/auth/v1`, audience `authenticated` |
| `GLOBAL_ADMIN_EMAILS` | Danh sách email được seed system role admin, phân tách bằng dấu phẩy |
| `STORAGE_PROVIDER` / `GUEST_STORAGE_PROVIDER` | Backend storage cho user và guest |
| `DATASOURCE_ENCRYPTION_KEY` | Fernet key bắt buộc ở production để mã hóa credential connector; không đưa vào frontend |
| `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_API_URL` | Origin frontend và base URL FastAPI được embed vào frontend build |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase browser client; chỉ publishable key được phép xuất hiện trong bundle |
| `NEXT_PUBLIC_AUTH_ALLOW_SIGNUP` / `NEXT_PUBLIC_AUTH_ALLOW_GUEST` | Cờ hiển thị signup/guest ở frontend; phải đồng bộ với cờ backend và build lại khi đổi |
| `UX_COMMAND_CENTER_ENABLED` | Bật contract Command Center phía backend |
| `NEXT_PUBLIC_UX_COMMAND_CENTER_ENABLED` | Bật UI Command Center tại thời điểm build |
| `AGENT_TRACE_MODE` | `off`, `shadow` hoặc `required` cho trace đã redact |
| `LANGSMITH_*` | Projection metadata-only tùy chọn, chỉ cấu hình server-side |
| `GOOGLE_DRIVE_*` | OAuth/storage tùy chọn cho Google Drive |

## Quan sát AI và evaluation

Trace PostgreSQL là nguồn có thẩm quyền cho Agent. Projection sang LangSmith là
best-effort/fail-open và chỉ gửi metadata allow-list; không gửi raw prompt,
raw row, PII, secret, file path hoặc chain-of-thought.

Bộ evaluation nằm trong [`evaluations/`](evaluations/), gồm fixture tổng hợp,
scorer deterministic, test và report. Chạy offline không gọi provider:

```powershell
.\.venv\Scripts\python.exe tests\evaluations\run_evaluation.py --dry-run
.\.venv\Scripts\python.exe tests\evaluations\run_evaluation.py --offline
```

Xem thêm [docs/eval_v1.md](docs/eval_v1.md),
[evaluations/README.md](evaluations/README.md) và
[evaluations/benchmark.md](evaluations/benchmark.md).

## API quan trọng

Mọi route FastAPI dưới đây có prefix `/api/v1` và yêu cầu auth/workspace phù
hợp, trừ health/system route được đánh dấu public.

| Nhóm | Endpoint tiêu biểu |
| --- | --- |
| Auth/workspace | `GET /session`, `GET /me`, `GET /workspace-bootstrap`, `GET/POST /workspaces`, member/invitation/configuration endpoints |
| Dataset/profile | `POST /datasets/upload`, `GET /datasets`, `POST /profile` (`202`), `GET /profiling-jobs/{job_id}`, `GET /profile/{run_id}`, `PATCH /profile/{run_id}/confirm` |
| Datasource | `POST /datasets/datasource/test`, `POST /datasets/datasource` cho MySQL, MongoDB và DuckDB |
| Connector center | `GET /connectors`, `POST/PATCH/DELETE /connectors/*`, test health và `POST /datasets/datasource/{connection_id}/use` |
| Quality/drift | `POST /profile/{run_id}/test`, `POST /profile/{run_id}/drift` |
| Charts/Explorer | `POST /profile/{run_id}/charts/auto-plan`, `POST /profile/{run_id}/charts/auto-profile-pack`, `GET /profile/{run_id}/charts/algorithms`, Preview và promote endpoints |
| Agent | `POST /qa`, `POST /qa/stream`, `GET /agent-runs/{run_id}`, `/trace`, `/evidence`, `/plan` |
| Reports | Draft, `POST /reports/{report_id}/items`, snapshot, submit, review, publish, archive và `GET /reports/{report_id}/export-source` |
| Admin | `GET/POST /admin/users`, `POST /admin/users/{user_id}/status`, `POST /admin/users/{user_id}/role`, `DELETE /admin/users/{user_id}` |
| Google Drive | `GET /google-drive/status`, `GET /google-drive/connect`, callback và `DELETE /google-drive/connection` |

PDF report đi qua route cùng origin của Next.js:
`/api/reports/profile/{runId}?reportId={reportId}`. Route này lấy export source
đã được FastAPI cấp quyền rồi render PDF bằng Playwright Core/Chromium; snapshot
được ưu tiên, còn draft chưa snapshot chỉ được trả với nhãn
`snapshot_hash: draft`.

## Cấu trúc repository

```text
backend/src/api/                 FastAPI routes và dependency/capability guards
backend/src/agents/              LangGraph, prompts, skills, trace/tools
backend/src/services/            auth, permissions, profiling, compute, charts,
                                 forecast, report, storage, datasource, retrieval, telemetry
backend/src/workers/             durable profiling worker claim/lease/retry
backend/src/models/              Pydantic request/response contracts
backend/migrations/              Alembic migrations
frontend/src/app/                Next.js App Router và route UI/PDF/health
frontend/src/components/        app shell, auth, chart, report và UI components
frontend/src/lib/                API client, auth, permissions, SSE và types
tests/                           backend/API/compute/security/frontend tests
scripts/chart_production_smoke.py  Smoke check chart production flow
docs/                            summary, evaluation, performance và deployment docs
```

## Kiểm tra trước khi commit

Từ `frontend/`:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
```

Từ root, dùng PostgreSQL test riêng và khác `DATABASE_URL`:

```powershell
$env:P170_TEST_DATABASE_URL = postgresql+psycopg://p170_test:<password>@localhost:5432/p170_test
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check backend tests
```

`pnpm start` sau `pnpm build` dùng để smoke bundle production; không dùng HMR
hoặc route compile của `pnpm dev` để kết luận latency production.

## CI/CD và triển khai

Workflow [Deploy Azure Containers](.github/workflows/azure-container-deploy.yml)
chạy quality gate cho pull request và push vào `main`: Ruff, pytest với
PostgreSQL service, evaluation offline, Vitest, typecheck, lint, Playwright
E2E và frontend build.

Workflow hiện dùng giá trị mặc định guest là `true` nếu GitHub repository
variable `NEXT_PUBLIC_AUTH_ALLOW_GUEST` chưa được tạo. Production muốn tắt
guest phải tạo variable này với giá trị `false`; workflow sẽ truyền cùng giá
trị cho frontend và backend. Vì frontend flag là build-time, thay đổi variable
chỉ có hiệu lực sau một lần deploy mới.

Khi deploy, workflow build/push hai image immutable lên Azure Container
Registry:

- **Backend image:** dùng cho FastAPI API và profiling worker với startup
  command khác nhau.
- **Frontend image:** Next.js standalone server, build-time `NEXT_PUBLIC_*`,
  Chromium và Noto fonts cho PDF.

Ba process chạy độc lập trên Azure App Service: frontend, API và profiling
worker. Workflow chạy Alembic migration, cập nhật app settings, restart và
health-check backend, worker và frontend. Secrets nằm trong GitHub Actions /
Azure App Settings; không đưa secret vào browser bundle.

Chi tiết resource, secret và flow nằm trong
[docs/azure-deploy-cicd.md](docs/azure-deploy-cicd.md).
Checklist cấu hình Supabase Auth, Storage, session và production smoke test nằm
trong [docs/production-supabase.md](docs/production-supabase.md).

## Giới hạn hiện tại

- Không có SQL/Python/shell tùy ý cho Explorer, Chart, Agent hoặc MCP; raw-row
  exploration, source-cleaning recipe, multi-table join và general code
  execution cũng không được phát hành. Connector chỉ là ngoại lệ hẹp cho lúc
  nhập nguồn: MySQL/DuckDB cho phép một `SELECT`/`WITH` chỉ-đọc đã validate,
  MongoDB cho phép JSON filter, rồi dữ liệu bị materialize tạm với trần 1 triệu
  dòng trước khi vào pipeline profiling.
- Preview bị giới hạn thời gian, dữ liệu và số kết quả; chỉ Official execution
  mới đủ điều kiện làm report evidence.
- Forecast là ước lượng có interval/limitation; model bị ẩn khi thiếu package,
  thiếu lịch sử hoặc không đáp ứng contract.
- Hủy Profile Run chưa được hỗ trợ vì compute pandas/DuckDB/LangGraph chưa có
  cooperative cancellation checkpoint an toàn.
- Planner autonomy, verifier enforcement, circuit breaking và long-term memory
  vẫn là capability feature-gated, chưa phải workflow phát hành mặc định.
- Short-term conversation memory is implemented for recent Q&A context; it is
  bounded to the current conversation and is separate from long-term memory.
- Guest workspace có retention/storage riêng và không phải nơi lưu trữ
  production lâu dài.

## Tài liệu liên quan

- [Technical summary](docs/summary.md)
- [Architecture](ARCHITECTURE.md)
- [Azure CI/CD và triển khai](docs/azure-deploy-cicd.md)
- [Evaluation v1](docs/eval_v1.md)
- [MongoDB Atlas setup & connector](docs/mongodb-atlas-setup.md)
- [AI benchmark](evaluations/benchmark.md)
- [Evaluation README](evaluations/README.md)
- [Cấu hình mẫu](.env.example)
- [Cấu hình ứng dụng](config.yaml)

## Checklist bàn giao

- [x] Backend, frontend và migration
- [x] Auth Supabase, workspace authorization và system admin surface
- [x] Durable profiling worker và human-in-the-loop review
- [x] Charts bounded Preview/Official, Agent Q&A và report snapshot/export
- [x] AI trace redact và offline evaluation
- [x] Docker/Azure App Service deployment workflow
- [ ] Video demo và pitch deck (chưa nằm trong repository)
