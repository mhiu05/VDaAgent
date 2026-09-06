# VDaAgent

> Nền tảng phân tích dữ liệu giúp Analyst đi từ nguồn dữ liệu thô đến profile, insight và báo cáo có thể kiểm chứng.

VDaAgent kết hợp compute xác định, workflow bất đồng bộ và AI Agent để tự động hóa các bước lặp lại trong quá trình khám phá dữ liệu. Hệ thống ưu tiên bằng chứng, giới hạn phạm vi thực thi, cô lập dữ liệu theo workspace và giữ con người trong vòng kiểm duyệt.

## Tính năng chính

- **Kết nối và quản lý dữ liệu:** tải lên CSV, TSV, Parquet, JSON; nhập dữ liệu từ Google Drive hoặc datasource như MySQL, MongoDB và DuckDB.
- **Profiling bất đồng bộ:** phân tích schema, missing value, cardinality, uniqueness, duplicate, distribution, outlier, correlation, PII, quasi-identifier, candidate key và semantic type bằng worker có lease, heartbeat, retry và phục hồi job stale.
- **Human-in-the-loop:** cho phép Analyst xác nhận, từ chối hoặc chỉnh sửa metadata do hệ thống đề xuất trước khi sử dụng kết quả tiếp theo.
- **Command Center:** chạy truy vấn và biểu đồ theo hai cấp độ — Preview có giới hạn để khám phá nhanh và Official được chạy lại trên nguồn đầy đủ sau quality gate.
- **AI Q&A evidence-first:** LangGraph Agent sử dụng tool và retrieval trong đúng Profile Run/workspace; câu trả lời phải vượt qua kiểm tra citation và numeric grounding, nếu thiếu bằng chứng hệ thống sẽ từ chối suy đoán.
- **Drift và kiểm định thống kê:** so sánh các Profile Run, chạy statistical test và lưu kết quả có provenance.
- **Báo cáo tái lập:** ghim profile, biểu đồ, câu trả lời và ghi chú vào Report Draft; tạo snapshot SHA-256 bất biến và xuất PDF an toàn với PII.
- **Workspace và phân quyền:** xác thực bằng Supabase, kiểm tra capability ở backend và cô lập tài nguyên giữa các workspace.
- **MCP local:** cung cấp MCP server qua stdio cho các thao tác profile, chart, Preview và Official; không mở MCP thành endpoint HTTP công khai.

## Nguyên tắc thiết kế

1. **Evidence-first:** số liệu đến từ compute, tool, retrieval hoặc Official execution đã lưu, không đến từ suy đoán của model.
2. **Bounded execution:** số hàng, cột, kết quả, thời gian và tool call đều có giới hạn.
3. **Workspace isolation:** identity, membership, capability và resource scope được kiểm tra trước khi truy cập dữ liệu.
4. **Durable workflow:** profiling chạy qua hàng đợi PostgreSQL và không phụ thuộc vòng đời của HTTP request.
5. **Backend-only data plane:** browser không truy cập trực tiếp các bảng nghiệp vụ qua Supabase Data API.

## Kiến trúc tổng quan

```mermaid
flowchart LR
  U[Browser] --> F[Next.js frontend]
  F -->|REST + SSE| A[FastAPI API]
  F -->|Session| AU[Supabase Auth]
  A --> DB[(PostgreSQL)]
  A --> ST[Supabase Storage / Google Drive / local]
  A --> AI[LLM / embedding provider]
  W[Profiling Worker] --> DB
  W --> ST
  W --> C[DuckDB + scientific Python]
  M[Local MCP stdio] --> DB
  M --> C
```

Production được thiết kế với ba process/container độc lập: Next.js, FastAPI và Profiling Worker. PostgreSQL lưu metadata, durable job, evidence, report, audit, retrieval và checkpoint; storage lưu raw object; DuckDB và scientific Python đảm nhiệm phần compute có giới hạn.

## Tech stack

| Lớp | Công nghệ |
| --- | --- |
| AI Agent | LangGraph, OpenAI/Gemini hoặc provider tương thích |
| Backend | FastAPI, Python 3.11, Pydantic, SQLAlchemy, Alembic |
| Compute | DuckDB, pandas, NumPy, SciPy, statsmodels, scikit-learn |
| Frontend | Next.js 15, React 19, TypeScript, TanStack Query |
| Database | PostgreSQL 16-compatible; không hỗ trợ SQLite runtime |
| Auth và storage | Supabase Auth, Supabase Storage; local storage cho development/test |
| Vận hành | Docker, Azure App Service, Azure Container Registry, GitHub Actions |

## Trạng thái repository

> [!IMPORTANT]
> Source đã được chuyển sang `src/backend` và `src/frontend`, nhưng một số consumer đường dẫn như Makefile, Alembic, test bootstrap, script, Docker và CI vẫn còn tham chiếu layout cũ. Vì vậy repository hiện chưa được xem là buildable từ clean checkout. Xem [giới hạn và sai lệch hiện tại](docs/architecture/known-limitations.md) trước khi chạy hoặc triển khai.

Các lệnh bên dưới mô tả contract local mục tiêu sau khi migration layout được hoàn tất. Không tạo symlink hoặc sao chép `.env` vào source tree để che lỗi đường dẫn.

## Bắt đầu nhanh

### Yêu cầu

- Python 3.11;
- Node.js 22;
- pnpm 11.0.8;
- PostgreSQL;
- Chromium khi chạy Playwright hoặc kiểm thử xuất PDF.

### 1. Cài đặt dependency

Từ repository root trên PowerShell:

```powershell
Copy-Item .env.example .env

python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt

Set-Location src/frontend
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
Set-Location ../..
```

### 2. Cấu hình local

`.env.example` được cấu hình gần với production và chứa placeholder. Khi phát triển local, tối thiểu cần điều chỉnh:

```dotenv
APP_ENV=development
AUTH_MODE=dual
AUTH_ALLOW_GUEST=true
AUTH_REQUIRE_EMAIL_CONFIRMED=false
CANONICAL_STORAGE_PROVIDER=local
DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/p170
```

Không commit `.env` hoặc secret thật. Chỉ các biến `NEXT_PUBLIC_*` được phép đưa vào browser bundle.

### 3. Chuẩn bị database

Tạo database `p170`, sau đó chạy migration:

```powershell
.\.venv\Scripts\python.exe -m alembic -c alembic.ini upgrade head
```

Production schema phải được quản lý bằng Alembic; không dựa vào compatibility bootstrap để thay thế migration.

### 4. Chạy ứng dụng

API, worker và frontend phải chạy trong ba terminal riêng.

Terminal API:

```powershell
Set-Location src/backend
..\..\.venv\Scripts\python.exe -m uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
```

Terminal worker:

```powershell
Set-Location src/backend
..\..\.venv\Scripts\python.exe -m src.workers.profiling_worker
```

Terminal frontend:

```powershell
Set-Location src/frontend
pnpm dev
```

Sau khi khởi động:

- frontend: `http://localhost:3000`;
- backend: `http://localhost:8000`;
- health check: `http://localhost:8000/health`;
- OpenAPI: `http://localhost:8000/docs` khi không chạy production.

Worker là process bắt buộc cho profiling bất đồng bộ.

## API chính

Tất cả router nghiệp vụ dùng prefix `/api/v1`. Request theo workspace sử dụng bearer token và header `X-Workspace-Id`; mutation hỗ trợ retry phải giữ nguyên `Idempotency-Key` cho cùng một thao tác logic.

| Nhóm | Endpoint tiêu biểu |
| --- | --- |
| Health và chẩn đoán | `GET /health`, `GET /api/v1/status` |
| Session và workspace | `/api/v1/session`, `/workspace-bootstrap`, `/workspaces/*` |
| Dataset và ingestion | `/api/v1/datasets`, `/datasets/upload`, `/datasets/upload-sessions/*` |
| Profiling | `/api/v1/profile`, `/datasets/{id}/profile`, `/profiling-jobs/{id}` |
| Analysis và biểu đồ | `/api/v1/analysis-sessions/*`, `/profile/{run_id}/explorer/*`, `/charts/*` |
| QA và chat | `/api/v1/qa`, `/qa/stream`, `/conversations/*` |
| Drift và statistical test | `/api/v1/profile/{run_id}/drift`, `/profile/{run_id}/test` |
| Report | `/api/v1/reports/*`, `/profile/{run_id}/report-draft` |
| Connector | `/api/v1/connectors/*`, `/google-drive/*` |
| Agent và skill | `/api/v1/agent-runs/{id}/*`, `/agent-skills/*` |

Profiling tuân theo luồng `HTTP 202 → worker → status/SSE`. Chỉ Official execution hoặc terminal answer đã qua evidence validation mới được dùng làm bằng chứng canonical. Xem [API và event contract](docs/architecture/api-and-events.md) để biết chi tiết auth, SSE, idempotency và error contract.

## Kiểm thử

Backend, từ repository root:

```powershell
ruff check src/backend/src tests
.\.venv\Scripts\python.exe -m pytest -q
```

Frontend:

```powershell
Set-Location src/frontend
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm test:e2e
```

Khi có process khác dùng chung test database, sử dụng harness tạo database tạm:

```powershell
.\.venv\Scripts\python.exe scripts\run_isolated_pytest.py -q
```

## Cấu trúc dự án

```text
P-170/
├── src/
│   ├── backend/
│   │   ├── src/
│   │   │   ├── api/          # FastAPI router và dependency
│   │   │   ├── agents/       # LangGraph, node, tool, skill và runtime trace
│   │   │   ├── models/       # Pydantic request/response contract
│   │   │   ├── services/     # Nghiệp vụ, compute, storage và repository
│   │   │   └── workers/      # Durable profiling worker
│   │   └── migrations/       # Alembic revisions
│   └── frontend/
│       ├── src/app/           # Next.js App Router
│       ├── src/components/    # UI và feature components
│       ├── src/lib/           # API client, auth, SSE và helpers
│       └── tests/             # Playwright E2E
├── tests/                     # Backend, integration, agent và API tests
├── evaluations/               # Evaluation artifacts đã sinh
├── scripts/                   # Migration, security, storage và benchmark tools
├── docs/                      # Tài liệu kiến trúc, chức năng và vận hành
├── config.yaml                # Cấu hình không bí mật
├── .env.example               # Danh mục biến môi trường
└── Dockerfile.*.azure         # Production images
```

## Tài liệu

- [Cổng tài liệu kỹ thuật](docs/README.md)
- [Tổng quan hệ thống](docs/architecture/system-overview.md)
- [Cấu trúc codebase](docs/architecture/codebase-structure.md)
- [Phát triển và kiểm thử local](docs/development/local-development-and-testing.md)
- [Cấu hình](docs/operations/configuration.md)
- [Triển khai](docs/operations/deployment.md)
- [Authentication và authorization](docs/security/authentication-and-authorization.md)
- [Workspace isolation và privacy](docs/security/workspace-isolation-and-privacy.md)

## Thành viên

| Thành viên | Vai trò |
| --- | --- |
| Nguyễn Minh Hiếu | AI Engineer, Team Lead |
| Vũ Nguyễn Bảo Sơn | Product Manager |
| Phạm Thế Đăng | Web Developer |
| Phạm Thị Thùy Linh | Data Engineer, DevOps |

## License

MIT.
