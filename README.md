# VDaAgent — Data Profiling Workspace

VDaAgent là ứng dụng web hỗ trợ Data Analyst và Business Analyst khám phá dữ
liệu theo hướng evidence-first: các số liệu được tính bằng công cụ
deterministic, còn AI hỗ trợ lập kế hoạch, diễn giải và trả lời trong phạm vi
bằng chứng đã được cấp quyền.

Mỗi thao tác làm việc nằm trong một workspace. Đơn vị ngữ cảnh trung tâm là
Profile Run của một dataset; chart, câu trả lời Agent, so sánh drift, báo cáo
và audit đều được gắn với đúng workspace và Profile Run đó.

## Chức năng

- Upload CSV, TSV, Parquet và JSON; hoặc tạo dataset từ MySQL, MongoDB hay
  DuckDB.
- Profile dữ liệu bất đồng bộ: schema, missingness, cardinality, uniqueness,
  duplicate, outlier, correlation, risk/PII và đề xuất metadata.
- Review xác nhận/sửa/từ chối đề xuất trước khi Profile Run hoàn tất.
- Command Center cho chart: plan, Preview có giới hạn, Official evidence và
  insight cần Analyst review.
- Chat theo bằng chứng của Profile Run; compare drift giữa hai Profile Run.
- Report Draft, snapshot bất biến và export PDF/JSON.
- Workspace, thành viên, invitation, cấu hình; quản trị tài khoản system admin.
- Guest trial có cờ bật riêng và chính sách storage/retention độc lập.

~~~text
Supabase sign-in (hoặc guest nếu được bật)
  → Workspace → Dataset → Profile job (202)
  → Worker chạy profiling deterministic
  → Review proposal nếu cần → Profile Run completed
  → Charts / Chat / Compare / Report snapshot
~~~

## Nguyên tắc bảo vệ dữ liệu

- Backend là nơi xác thực JWT, workspace và capability. Kiểm tra quyền ở
  frontend chỉ phục vụ UX.
- DuckDB, pandas và compute adapter tạo ra số liệu. LLM không tự tính số liệu
  hoặc quyết định truy cập dữ liệu.
- Không trả raw row hay PII thô cho Explorer, Agent, report hoặc MCP.
- Browser chỉ gửi yêu cầu phân tích có cấu trúc; không có API thực thi SQL,
  Python hay shell tùy ý.
- Preview không phải bằng chứng bền vững. Chỉ Official execution có provenance,
  context binding và result hash mới có thể ghim vào report.

## Kiến trúc và stack

| Lớp | Công nghệ / trách nhiệm |
| --- | --- |
| Frontend | Next.js 15, React 19, TypeScript, React Query, Supabase SSR/PKCE |
| API | FastAPI, Pydantic, SQLAlchemy, Alembic, REST/SSE |
| Worker | Python worker claim durable profiling jobs bằng PostgreSQL lease |
| Agent | LangGraph, LangChain, native skill/tool registry, trace đã redact |
| Compute | DuckDB, pandas, NumPy, SciPy, statsmodels, scikit-learn |
| Persistence | PostgreSQL/Supabase DB; Supabase Storage, Google Drive hoặc local storage |
| Observability | PII-safe telemetry, audit event và LangSmith metadata-only tùy chọn |
| Delivery | Docker, Azure App Service, GitHub Actions, pytest, Ruff, Vitest, Playwright |

Xem luồng dữ liệu và các ranh giới bảo mật ở [ARCHITECTURE.md](ARCHITECTURE.md).
Tóm tắt dành cho demo/bàn giao ở [docs/summary.md](docs/summary.md).

## Điều kiện phát triển

- Python 3.11+
- Node.js 20+; image CI/production dùng Node.js 22
- pnpm 11
- PostgreSQL (Supabase PostgreSQL phù hợp nhất với production)
- Git

## Cài đặt local

1. Tạo môi trường Python và cài dependency.

~~~powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
~~~

2. Tạo file cấu hình và cài frontend.

~~~powershell
Copy-Item .env.example .env
corepack enable
Set-Location frontend
pnpm install
Set-Location ..
~~~

3. Sửa .env cho môi trường local. Tối thiểu cần một PostgreSQL riêng, không
   dùng database production hoặc test chung.

~~~env
APP_ENV=development
DATABASE_URL=postgresql+psycopg://USER:PASSWORD@HOST:5432/p170_dev
DATABASE_CHECKPOINTER_URL=postgresql://USER:PASSWORD@HOST:5432/p170_dev

# Production bắt buộc supabase. Dual chỉ dành cho local/migration compatibility.
AUTH_MODE=supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_AUTH_ISSUER=https://your-project.supabase.co/auth/v1
SUPABASE_AUTH_AUDIENCE=authenticated
SUPABASE_PUBLISHABLE_KEY=your_publishable_key

STORAGE_PROVIDER=local
GUEST_STORAGE_PROVIDER=local
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000/api/v1
NEXT_PUBLIC_AUTH_ALLOW_SIGNUP=true
NEXT_PUBLIC_AUTH_ALLOW_GUEST=false
UX_COMMAND_CENTER_ENABLED=true
NEXT_PUBLIC_UX_COMMAND_CENTER_ENABLED=true
~~~

Frontend tự map SUPABASE_URL và SUPABASE_PUBLISHABLE_KEY thành biến public phù
hợp khi chạy local. Có thể đặt rõ NEXT_PUBLIC_SUPABASE_URL và
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY nếu muốn. Không đặt database URL,
service/secret key, OAuth secret, token hay LLM API key vào biến NEXT_PUBLIC_*.

4. Chạy migration trước khi chạy API.

~~~powershell
$env:PYTHONPATH = backend
alembic upgrade head
~~~

5. Mở ba terminal tại root repository.

~~~powershell
# API
.\.venv\Scripts\python.exe -m uvicorn src.main:app --app-dir backend --reload --host 0.0.0.0 --port 8000
~~~

~~~powershell
# Profiling worker
$env:PYTHONPATH = backend
.\.venv\Scripts\python.exe -m src.workers.profiling_worker
~~~

~~~powershell
# Frontend
Set-Location frontend
pnpm dev --port 3000
~~~

Trên Windows, Makefile có shortcut: make install, make dev, make health,
make frontend-check và make frontend-build.

Sau khi khởi động:

- Frontend: http://localhost:3000
- API health: http://localhost:8000/health
- OpenAPI local: http://localhost:8000/docs
- API prefix: http://localhost:8000/api/v1

## Cấu hình quan trọng

| Nhóm | Biến cần biết |
| --- | --- |
| Database | DATABASE_URL, DATABASE_CHECKPOINTER_URL, DATABASE_MIGRATION_URL |
| LLM | LLM_PROVIDER, LLM_MODEL và khóa riêng của provider hoặc LLM_API_KEY |
| Auth | AUTH_MODE, AUTH_ALLOW_SIGNUP, AUTH_ALLOW_GUEST, AUTH_REQUIRE_EMAIL_CONFIRMED |
| Supabase | SUPABASE_URL, SUPABASE_AUTH_ISSUER, SUPABASE_AUTH_AUDIENCE, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY |
| Storage | STORAGE_PROVIDER, GUEST_STORAGE_PROVIDER, SUPABASE_STORAGE_*, GOOGLE_DRIVE_* |
| Connector | DATASOURCE_ENCRYPTION_KEY để mã hóa credential MySQL/MongoDB/DuckDB |
| Frontend | NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_API_URL, NEXT_PUBLIC_AUTH_*, NEXT_PUBLIC_UX_COMMAND_CENTER_ENABLED |
| Runtime | PROFILING_WORKER_*, UX_PREVIEW_*, AGENT_TRACE_MODE, LANGSMITH_* |

Production bắt buộc AUTH_MODE=supabase và AUTH_REQUIRE_EMAIL_CONFIRMED=true.
Khi đổi một biến NEXT_PUBLIC_*, cần build lại frontend vì giá trị được nhúng vào
bundle. Guest chỉ thực sự bật khi cả AUTH_ALLOW_GUEST ở backend và
NEXT_PUBLIC_AUTH_ALLOW_GUEST ở frontend đều bật.

Storage production có thể là Supabase Storage hoặc Google Drive. Local storage
chỉ phù hợp cho development/test. Datasource connector chỉ nhận hợp đồng đọc
an toàn: table hoặc SELECT/WITH cho MySQL/DuckDB, collection và JSON filter cho
MongoDB; dữ liệu được materialize tạm thời và dừng ở 1.000.000 dòng.

## API tiêu biểu

Tất cả API nghiệp vụ dùng prefix /api/v1.

| Nhóm | Endpoint |
| --- | --- |
| Workspace | GET /workspace-bootstrap, workspace/member/invitation/configuration |
| Dataset/profile | POST /datasets/upload, GET /datasets, POST /profile, GET /profiling-jobs/{jobId}, PATCH /profile/{runId}/confirm |
| Datasource | POST /datasets/datasource/test, POST /datasets/datasource |
| Charts | explorer session, auto-plan, auto-profile-pack, previews, promote, algorithms |
| Agent | POST /qa, POST /qa/stream, agent run, trace, evidence |
| Report | report draft, items, snapshots, export source, lifecycle |
| Admin | GET/POST /admin/users, status, role, delete |
| Diagnostics | GET /status, GET /audit và public GET /health |

POST /profile trả 202 Accepted. Client poll profiling job; worker mới là nơi
claim và thực thi. Job succeeded vẫn có thể tương ứng Profile Run pending_review
cho đến khi Analyst hoàn tất review.

## Kiểm thử

Thiết lập P170_TEST_DATABASE_URL trỏ tới database test riêng, khác DATABASE_URL,
trước khi chạy pytest. Test có thể migration và ghi fixture.

~~~powershell
# Backend
python -m pytest -q
ruff check backend/src tests
python tests/evaluations/run_evaluation.py --dry-run
python tests/evaluations/run_evaluation.py --offline

# Frontend
Set-Location frontend
pnpm test
pnpm typecheck
pnpm lint
pnpm test:e2e
pnpm build
~~~

## Triển khai

Pipeline GitHub Actions kiểm tra Ruff, pytest với PostgreSQL, offline
evaluation, Vitest, typecheck, lint, Playwright E2E và frontend build. Khi
deploy main, pipeline build/push image backend và frontend, chạy Alembic,
cập nhật ba Azure App Service (frontend, API, profiling worker), sau đó
health-check từng service.

Xem chi tiết tại [docs/azure-deploy-cicd.md](docs/azure-deploy-cicd.md) và
[docs/production-supabase.md](docs/production-supabase.md).

## Giới hạn hiện tại

- Không có arbitrary SQL, multi-table join, data-cleaning recipe hay general
  code execution từ UI, Agent, Explorer hoặc MCP.
- Forecast là ước lượng có khoảng tin cậy/cảnh báo; chỉ model đủ dependency và
  đúng data contract mới khả dụng.
- Planner autonomy, verifier enforce và long-term memory là feature-gated.
- Hủy profile job chưa được hỗ trợ vì pandas, DuckDB và LangGraph chưa có điểm
  hủy an toàn chung.

## Bảo mật

.env, .env.local, .env.production, log phiên AI và dữ liệu runtime đã được
ignore. Không commit hoặc dán vào issue/chat các API key, database URL có mật
khẩu, Supabase secret/service key, OAuth credential, bearer token hay khóa
Fernet. Nếu một secret đã lộ, thu hồi/rotate secret đó tại nhà cung cấp và cập
nhật secret store/App Settings.
