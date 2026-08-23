# Thông tin nhóm

- **Tên nhóm:** VduAgents
- **Link demo:** [https://p170-web-08140019.azurewebsites.net/](https://p170-web-08140019.azurewebsites.net/)

## Thành viên nhóm

- NGUYỄN MINH HIẾU — 2A2202601154
- PHẠM THẾ ĐĂNG — 2A202601766
- PHẠM THỊ THÙY LINH — 2A202601181
- VŨ NGUYỄN BẢO SƠN — 2A202601116

## Thông tin liên hệ

- SĐT: 0375049906
- Email: minhhieuhh2k5@gmail.com

# VDaAgent — Data Profiling

VDaAgent giúp Analyst biến một tệp dữ liệu thành hồ sơ có thể kiểm tra, biểu đồ
có bằng chứng và báo cáo có thể truy nguyên. **Profile Run** là đơn vị làm việc
trung tâm: mọi phân tích, biểu đồ, câu trả lời của Agent và report đều thuộc về
một Profile Run trong một workspace cụ thể.

```text
Tải dataset → Profile deterministic → Review metadata
       → Profile Run hoàn tất
       ├─ Biểu đồ: plan → Preview → Official evidence → insight
       ├─ Hỏi Agent: trả lời theo evidence đã được phép đọc
       └─ Report Draft → snapshot bất biến → PDF/JSON
```

Các nguyên tắc của dự án:

- Số liệu được tạo bằng compute deterministic; LLM chỉ hỗ trợ lập kế hoạch,
  diễn giải và hỏi đáp trong phạm vi evidence được cấp.
- UI, Agent và report không cung cấp raw row hoặc giá trị PII thô.
- Browser không gửi SQL hay mã thực thi tự do. Mọi aggregate dùng `QuerySpec`
  có allow-list, ngân sách thời gian và giới hạn kết quả.
- Backend luôn xác thực workspace, role và capability trước khi đọc hoặc ghi
  một resource.

## Vấn đề

Analyst thường mất nhiều thời gian để kiểm tra chất lượng dữ liệu, chọn biểu đồ
phù hợp và giải thích kết quả theo cách có thể kiểm chứng. Các công cụ chatbot
hoặc notebook tự do dễ tạo ra câu trả lời không có provenance, truy vấn vượt
phạm vi dữ liệu được phép hoặc vô tình đưa raw row/PII vào kết quả chia sẻ.

VDaAgent giải quyết khoảng trống này bằng một workflow có kiểm soát: số liệu do
compute deterministic tạo ra; AI chỉ lập kế hoạch, diễn giải và trả lời trong
phạm vi evidence đã được backend cấp quyền.

## Giải pháp

VDaAgent là workspace **evidence-first** cho quy trình từ dataset đến báo cáo:

- Profile dữ liệu có cấu trúc và review metadata/PII trước khi dùng làm ngữ
  cảnh phân tích.
- Tạo chart qua Preview có giới hạn, sau đó promote thành Official evidence có
  provenance và `result_hash`.
- Hỏi Agent trong phạm vi evidence của Profile Run; trace được redact để quan
  sát runtime mà không lưu raw prompt, raw row, secret hoặc chain-of-thought.
- Lưu chart/evidence/insight vào Report Draft, đóng băng snapshot rồi xuất
  PDF/JSON có thể truy nguyên.

## Người dùng mục tiêu

- **Chính:** Data Analyst và Business Analyst cần khám phá, kiểm tra và trình
  bày insight từ một dataset một cách có căn cứ.
- **Phụ:** Data/AI team, quản trị workspace và reviewer cần kiểm tra provenance,
  quyền truy cập, audit và chất lượng đầu ra AI.

## Tech stack

| Lớp | Công nghệ đang dùng |
| --- | --- |
| Frontend | Next.js 15, React 19, TypeScript, React Query, Supabase SSR |
| Backend | FastAPI, Python 3.11+, Pydantic, SQLAlchemy/Alembic |
| AI Agent | LangGraph, LangChain, Gemini hoặc LLM provider cấu hình, LangSmith |
| Compute | DuckDB, pandas, NumPy, SciPy, statsmodels, scikit-learn |
| Data & Auth | Supabase Auth/PostgreSQL/Storage; Google Drive tùy chọn |
| DevOps & chất lượng | Docker, Azure App Service containers, GitHub Actions, pytest, Ruff, Vitest, Playwright |

## Quick start

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env

corepack enable
Set-Location frontend
pnpm install
Set-Location ..
```

Điền `DATABASE_URL` và các biến cần thiết trong `.env`, chạy migration rồi mở
backend/frontend theo phần [Cài đặt local](#cài-đặt-local). `frontend/next.config.ts`
chỉ forward allow-list biến `NEXT_PUBLIC_*` từ root `.env` vào browser bundle; có
thể dùng `frontend/.env.local` để override riêng frontend. Không commit `.env`,
`frontend/.env.local`, API key, OAuth secret hay database URL nào.

## Tính năng hiện có

- **Data profiling** cho CSV, TSV, Parquet và JSON: schema, kiểu dữ liệu,
  missingness, cardinality, uniqueness, duplicate, outlier, top values và
  correlation.
- **Human-in-the-loop review** cho semantic type, candidate key và đề xuất PII
  còn chờ quyết định trước khi dùng chúng làm ngữ cảnh evidence.
- **Biểu đồ & phân tích trực quan** tại `/charts`: chọn Profile Run đã hoàn
  tất, nhập câu hỏi hoặc tạo profile pack tự động, sau đó kiểm tra Preview và
  promote thành Official evidence.
- **15 loại biểu đồ native**: line, bar, table, KPI, histogram, scatter, box,
  heatmap, missing-value bar/heatmap, correlation heatmap, cardinality, violin,
  donut và outlier. Renderer chỉ nhận kết quả aggregate.
- **Forecast chuỗi thời gian** với catalog 30 mô hình. Khả dụng thực tế phụ
  thuộc dependency cài trong môi trường và contract dữ liệu; các model cần giá
  trị ngoại sinh tương lai sẽ được đánh dấu không khả dụng thay vì tự suy đoán.
- **Chart planning an toàn**: LLM trả structured candidate khi được cấu hình;
  nếu không khả dụng, planner quy tắc vẫn tạo plan bounded từ metadata đã được
  duyệt. Backend mới là nơi validate cột, thuật toán và `QuerySpec`.
- **Agent Q&A, kiểm định và drift** theo Profile Run, với trace/provenance đã
  redact khi bật runtime trace.
- **Report Draft** lưu chart, evidence và insight; snapshot bất biến là nguồn
  chuẩn cho export/chia sẻ. Trang chi tiết vẫn có thể đọc draft hiện hành trước
  snapshot đầu tiên và gắn nhãn `snapshot_hash: "draft"`; cần tạo snapshot trước
  khi xem đó là bản báo cáo chính thức.
- **Workspace, Auth và storage**: Supabase Auth/PostgreSQL/Storage, Google
  Drive tùy chọn cho file nguồn lớn và local storage cho development/test.
- **Khởi động workspace tối ưu**: `GET /workspace-bootstrap` trả session,
  workspace/quyền hiệu lực và dashboard summary trong một round trip; frontend
  seed cache theo workspace còn backend vẫn kiểm tra capability ở mỗi request.
- **So sánh drift** tại `/compare` giữa hai Profile Run hoàn tất, hiển thị PSI,
  cardinality, null rate và distribution do backend tính.
- **Vận hành workspace**: quản lý thành viên/lời mời, archive/restore, cấu hình
  AI-nghiệp vụ, giao diện, compute và chính sách PII; `/activity` hiển thị audit
  event theo capability.
- **Vòng đời báo cáo** ngoài Snapshot gồm submit, review, publish và archive.
- **Chat Agent** dùng route `/chat` và chọn một Profile Run hoàn tất làm context.
- **MCP stdio adapter** cho trusted local clients, cung cấp tool profile/chart
  có giới hạn. Đây không phải endpoint MCP công khai.

## Luồng sử dụng

1. Vào **Tải dữ liệu**, tải một dataset và tạo Profile Run ở chế độ `sample`
   hoặc `full`.
2. Review, chỉnh sửa hoặc từ chối proposal metadata/PII còn chờ. Khi Profile
   Run hoàn tất, trạng thái chuyển sang `completed`.
3. Vào **Biểu đồ** (`/charts`), chọn đúng Profile Run, rồi nhập câu hỏi kinh
   doanh hoặc tạo bộ biểu đồ profile tự động.
4. Kiểm tra **Preview**. Đây là kết quả có ngân sách thời gian và có thể dùng
   sample nên chưa phải evidence báo cáo.
5. Promote Preview thành **Official**. Backend kiểm tra context hiện hành,
   quality gate và chạy lại kết quả; Official có `result_hash`/provenance.
6. Chọn renderer, tạo insight nếu cần và ghim chart đã có Official evidence vào
   Report Draft. Trang detail có thể xem draft hiện hành, nhưng tạo snapshot trước
   khi xuất hoặc chia sẻ bản báo cáo chính thức.

Trang `/profiles/{runId}` là Command Center cho **Tổng quan** và **Report Draft**.
Chat Agent được mở tại `/chat` và chọn Profile Run làm context. Không gian
**Biểu đồ** là route `/charts` riêng, nhưng dùng cùng Profile Run, Explorer
session và Report Draft.

## Kiến trúc ở mức cao

```text
Next.js / React :3000
  ├─ Supabase SSR / PKCE, React Query và SSE
  ├─ Profile pages, /charts và Next.js PDF route
  └─ Bearer token + X-Workspace-Id
                         ↓
FastAPI :8000/api/v1
  ├─ Auth, workspace/capability guard và audit
  ├─ LangGraph profiling/Q&A, native skill registry và trace
  ├─ Chart planner, bounded AnalysisEngine và forecasting registry
  ├─ DuckDB, pandas, NumPy, SciPy, statsmodels/scikit-learn khi có
  └─ Repository + storage adapter
                         ↓
PostgreSQL                 Object storage
workspace/profile/evidence Supabase Storage | Google Drive | local dev
report/audit/trace
```

Nguồn tệp được materialize tạm thời cho DuckDB/pandas khi cần compute rồi bị
xóa. Hiện tại dự án không triển khai một cloud warehouse (BigQuery/Snowflake)
hay vector database như compute backend; retrieval dùng knowledge base cấu hình
trong ứng dụng khi được bật.

Chi tiết về data flow, ownership, API và ranh giới bảo mật nằm trong
[ARCHITECTURE.md](ARCHITECTURE.md). Bản tóm tắt tiếng Việt tại
[docs/summary.md](docs/summary.md).

## Hiệu năng điều hướng workspace

Khi vào workspace đã đăng nhập, frontend dùng `GET /workspace-bootstrap` thay vì
chờ nhiều request nhánh cho session, workspace và dashboard. Response gồm user đã
xác thực, workspace đã chọn/role, danh sách workspace kèm effective permissions và
summary dashboard (count cùng tối đa 12 report gần nhất). `/dashboard` được seed
vào React Query cache theo workspace; cache có `staleTime` 30 giây, `gcTime` 10
phút và bị xóa khi đổi workspace để không lộ dữ liệu chéo.

Backend lấy membership/workspace bằng join và summary theo aggregate query, tránh
N+1 query; guest không update lại role/status nếu không thay đổi. Bootstrap không
nới lỏng security boundary: tất cả endpoint nghiệp vụ sau đó vẫn kiểm tra user,
workspace và capability. Log telemetry chỉ ghi route, status, duration và
correlation ID; không ghi token, email hay payload.

Không dùng latency của `pnpm dev` để kết luận UX production: HMR và route compile
là chi phí development. Trước release, đo smoke trên bundle hoặc image candidate
đã precompile:

```powershell
Set-Location frontend
pnpm build
pnpm start --port 3000
```

Azure frontend image build bundle ở stage builder và runtime chạy standalone server
từ bundle đó. Smoke candidate cần truy cập ít nhất `/dashboard` và `/datasets`,
đồng thời ghi nhận p50/p95 của API bootstrap/dashboard từ telemetry. Chưa có script
benchmark workspace tự động; không được coi route compile/HMR là regression production.

## Cấu trúc dự án
```text
backend/src/api/                 FastAPI routes và dependency guards
backend/src/agents/              LangGraph, prompts, skill registry, trace/tools
backend/src/services/            profiling, analysis, chart planner, forecast,
                                 report, storage, auth và retrieval
backend/src/mcp_server.py        MCP stdio adapter với bounded tools
backend/src/models/              Pydantic contracts
backend/migrations/              Alembic migrations
frontend/src/app/                Next.js App Router, gồm /charts và PDF route
frontend/src/components/         UI, profile, charts và report components
frontend/src/lib/                API client, auth, types và SSE transport
scripts/chart_production_smoke.py Smoke check cho chart production flow
tests/                           Backend/API/compute/security/frontend tests
docs/Biểu Đồ.md                  Tài liệu chi tiết về Charts & Evidence
```

## Yêu cầu

- Python 3.11+
- Node.js 20+ và pnpm 9+ (image frontend production dùng Node.js 22)
- PostgreSQL; production dùng Supabase PostgreSQL
- Git
- Khóa LLM là tùy chọn: profiling, Preview/Official và các model forecast khả
  dụng vẫn chạy không cần LLM; narrative, Q&A và agent chart planning cần một
  provider LLM hoặc sẽ dùng fallback ở nơi có hỗ trợ.

## Cài đặt local

### Windows PowerShell

Mẫu `.env.example` hướng đến production. Khi chạy local, đặt
`APP_ENV=development`, `AUTH_MODE=dual`, `STORAGE_PROVIDER=local`,
`GUEST_STORAGE_PROVIDER=local` và điền `DATABASE_URL` trỏ đến PostgreSQL local
trước khi chạy migration.

Từ thư mục root:

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

Tối thiểu điền các giá trị sau trong `.env`:

```env
APP_ENV=development
DATABASE_URL=postgresql+psycopg://USER:PASSWORD@HOST:5432/p170
AUTH_MODE=dual
AUTH_ALLOW_GUEST=true
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
UX_COMMAND_CENTER_ENABLED=true
NEXT_PUBLIC_UX_COMMAND_CENTER_ENABLED=true
```

`NEXT_PUBLIC_API_URL` trong root `.env` được `frontend/next.config.ts` forward vào
bundle frontend. Nếu cần override URL API chỉ cho frontend (ví dụ Windows ưu tiên
IPv4 loopback), tạo `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000/api/v1
```

Mọi thay đổi `NEXT_PUBLIC_*` yêu cầu restart frontend. Dùng `127.0.0.1` nhất quán
cho frontend và API khi chạy local để tránh khác biệt resolve IPv6 của `localhost`.

Áp migration trước request đầu tiên:

```powershell
$env:PYTHONPATH = backend
alembic upgrade head
```

Mở hai terminal:

```powershell
# Terminal 1 — từ root
.\.venv\Scripts\python.exe -m uvicorn src.main:app --app-dir backend --reload --host 0.0.0.0 --port 8000
```

```powershell
# Terminal 2 — từ root
Set-Location frontend
pnpm dev --port 3000
```

### macOS/Linux

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
cp .env.example .env
corepack enable
(cd frontend && pnpm install)
```

Áp `alembic upgrade head` với `PYTHONPATH=backend`, sau đó chạy backend bằng
`.venv/bin/python -m uvicorn src.main:app --app-dir backend --reload` và
frontend bằng `pnpm dev --port 3000` từ thư mục `frontend`.

Sau khi khởi động:

- Frontend: <http://localhost:3000>
- Health: <http://localhost:8000/health>
- OpenAPI docs: <http://localhost:8000/docs> (ngoài production)
- API prefix: <http://localhost:8000/api/v1>

Các shortcut Windows trong [Makefile](Makefile): `make install`, `make dev`,
`make health`, `make frontend-check` và `make frontend-build`.

### Forecast tùy chọn

`requirements.txt` chứa model core (baseline, exponential smoothing, ARIMA,
state space và scikit-learn). Cài nhóm model nặng tùy theo môi trường:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-forecast-full.txt
```

Catalog API sẽ trả từng model cùng trạng thái `available` và lý do nếu model
không được bật.

## Xác thực, workspace và storage

Supabase là nguồn sự thật cho Auth; PostgreSQL lưu workspace, membership,
Profile Run, evidence, draft/snapshot, audit và trace. Frontend chỉ dùng biến
công khai `NEXT_PUBLIC_*`; không đưa database URL, service key, storage secret
hay LLM key vào browser bundle.

`AUTH_MODE=dual` chỉ phù hợp cho local/rollout. Production phải dùng
`AUTH_MODE=supabase`. Guest trial chỉ tạo khi người dùng chủ động chọn Analyst;
guest workspace có storage/retention riêng và không phù hợp cho dữ liệu cần lưu
lâu dài.

Storage mặc định là Supabase Storage. Có thể đặt `STORAGE_PROVIDER=google_drive`
và cấu hình OAuth/`GOOGLE_DRIVE_*` để lưu file binary trên Google Drive; metadata,
workspace và audit vẫn ở PostgreSQL. Không commit `.env`, OAuth secret, refresh
token, Fernet key hay API key.

## Quan sát AI và đánh giá

Runtime trace của Agent hỗ trợ quan sát profiling và Q&A mà không thay đổi
compute deterministic. Trace chỉ lưu metadata/provenance đã redact; không lưu
raw prompt, chain-of-thought, raw row, PII hoặc secret.

Để gửi trace sang LangSmith, cấu hình ở môi trường backend:

```env
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=<LangSmith API key>
LANGSMITH_PROJECT=VDaAgents
AGENT_TRACE_MODE=shadow
```

Bộ AI evaluation nằm trong [`evaluations/`](evaluations/), gồm fixture tổng hợp,
evaluator deterministic, test và báo cáo. Có thể kiểm tra dataset/evaluator mà
không gọi API hay gửi kết quả lên LangSmith:

```powershell
.\.venv\Scripts\python.exe evaluations/run_evaluation.py --dry-run
.\.venv\Scripts\python.exe evaluations/run_evaluation.py --offline
```

Xem chi tiết tại [hướng dẫn evaluation](evaluations/README.md) và
[báo cáo evaluation](evaluations/results/ai_evaluation_report.md).
## API quan trọng

Mọi backend endpoint có prefix `/api/v1`.

| Nhóm | Endpoint tiêu biểu |
| --- | --- |
| Dataset & profile | `POST /datasets/upload`, `GET /datasets`, `POST /profile`, `GET /profile/{run_id}`, `PATCH /profile/{run_id}/confirm` |
| Chart planning | `POST /profile/{run_id}/charts/auto-plan`, `POST /profile/{run_id}/charts/auto-profile-pack`, `GET /profile/{run_id}/charts/algorithms` |
| Bounded analysis | `POST /profile/{run_id}/explorer/session`, `POST /profile/{run_id}/explorer/previews`, `POST /profile/{run_id}/explorer/previews/{preview_id}/promote` |
| Agent | `POST /qa`, `POST /qa/stream`, `GET /agent-runs/{run_id}/evidence` |
| Reports | `GET/POST /profile/{run_id}/report-draft`, `POST /reports/{report_id}/items`, `POST /reports/{report_id}/snapshots`, `GET /reports/{report_id}/export-source` |
| Workspace | `GET /workspace-bootstrap`, `GET /session`, `GET/POST /workspaces`, member/invitation/configuration endpoints, `GET /dashboard`, `GET /audit` |
| Quality & drift | `POST /profile/{run_id}/test`, `POST /profile/{run_id}/drift` |
| Report lifecycle | Submit, review, publish và archive sau khi tạo snapshot |

PDF profile report đi qua Next.js route cùng origin:
`/api/reports/profile/{runId}?reportId={reportId}`. Route này lấy export source
đã được FastAPI cấp quyền rồi render PDF ở server Next.js. `GET
/reports/{report_id}/export-source` ưu tiên snapshot mới nhất; khi report draft
chưa có snapshot, endpoint trả draft hiện hành với `snapshot_hash: "draft"` để
trang detail vẫn mở được. Hãy tạo snapshot trước khi dùng bản export để chia sẻ.

Renderer dùng Playwright Core với Chromium server-side; PDF giữ text/SVG vector,
không dùng screenshot hay browser print dialog. Image frontend Azure đã cài Chromium
và Noto fonts. Với môi trường local khác, đặt
`PDF_CHROMIUM_EXECUTABLE_PATH` tới executable Chromium trước khi gọi export.

## Kiểm tra trước khi commit

Từ thư mục `frontend`:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm start --port 3000
```

`pnpm start` sau `pnpm build` dùng cho smoke bundle production; không đo latency
production từ HMR hoặc route compile trong `pnpm dev`.
Từ root, sau khi cấu hình một PostgreSQL test database riêng:

```powershell
$env:P170_TEST_DATABASE_URL = postgresql+psycopg://p170_test:<password>@localhost:5432/p170_test
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check backend tests
```

`P170_TEST_DATABASE_URL` là bắt buộc cho test tích hợp và **phải khác**
`DATABASE_URL`. Không trỏ test vào database development hoặc production; test
có thể tạo migration, profile và report fixture.

## Giới hạn hiện tại

- Không có arbitrary SQL, raw-row exploration, source cleaning recipe hay join
  nhiều bảng qua UI/Agent/MCP.
- Preview bị giới hạn thời gian, dữ liệu và số kết quả; Preview không thể ghim
  trực tiếp vào Report Draft.
- Forecast là ước lượng có interval/limitation, không phải giá trị chắc chắn.
- Các capability planner autonomy, verifier enforcement, durable jobs và
  workspace/personal memory chưa là workflow phát hành; giữ các flag tương ứng
  tắt.

## Tài liệu liên quan

- [Technical summary](docs/summary.md)
- [Architecture](ARCHITECTURE.md)
- [Biểu đồ & Evidence-First Analytics](<docs/Biểu Đồ.md>)
- [Cấu hình mẫu](.env.example)
- [Cấu hình ứng dụng](config.yaml)
- [Hướng dẫn AI evaluation](evaluations/README.md)

## Checklist bàn giao

- [x] Mã nguồn backend, frontend và migration
- [x] README, technical summary và architecture
- [x] AI trace có thể tích hợp LangSmith với dữ liệu đã redact
- [x] Fixture, evaluator, test và báo cáo AI evaluation
- [x] Docker/Azure App Service deployment workflow
- [ ] Video demo và pitch deck (chưa nằm trong repository)
