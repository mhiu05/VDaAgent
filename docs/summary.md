# VDaAgent — Tóm tắt dự án

VDaAgent là nền tảng web cho Data Analyst và Business Analyst thực hiện data
profiling, phân tích trực quan và lập báo cáo có thể truy nguyên. Hệ thống dùng
AI để hỗ trợ lập kế hoạch và diễn giải, nhưng toàn bộ số liệu phải xuất phát từ
compute deterministic và evidence đã được cấp quyền.

## Giá trị cốt lõi

- Giảm thời gian khám phá dataset: schema, chất lượng dữ liệu, missingness,
  outlier, duplicate, correlation, rủi ro và PII.
- Giữ con người trong vòng kiểm soát: Analyst review các đề xuất metadata/PII
  và review insight trước khi đưa vào báo cáo.
- Tạo insight có provenance: chart Preview chỉ để khám phá; Official execution
  mới đủ điều kiện trở thành evidence trong report.
- Bảo vệ dữ liệu đa tenant: tất cả dữ liệu, request và artifact đều
  workspace-scoped; backend là security boundary.

## Luồng người dùng

~~~text
Đăng nhập Supabase / guest trial được bật
  → chọn Workspace
  → upload hoặc kết nối datasource
  → tạo Profile Run
  → profiling worker chạy job durable
  → Analyst review proposal nếu cần
  → Profile Run completed
      ├── Command Center: chart, Preview, Official evidence, insight
      ├── Chat: Q&A theo Profile Run
      ├── Compare: phát hiện drift giữa hai Profile Run
      └── Report Draft → snapshot bất biến → PDF/JSON
~~~

Profile job trả 202 Accepted và được worker claim từ PostgreSQL. Job succeeded
không đồng nghĩa Profile Run đã completed: run có thể dừng ở pending_review để
chờ quyết định của Analyst.

## Khả năng đã có

| Nhóm | Nội dung |
| --- | --- |
| Dataset | CSV, TSV, Parquet, JSON; MySQL, MongoDB và DuckDB connector |
| Profiling | Schema, kiểu dữ liệu, null/cardinality/uniqueness, top values, duplicate, outlier, correlation, quality/risk/PII proposal |
| Charts | Plan tự động/fallback, Preview bounded, Official promotion, 15 renderer native và 28 forecast adapter theo dependency/data contract |
| Agent | Q&A một lần hoặc SSE, native skill registry, trace/provenance đã redact |
| Báo cáo | Draft, pin evidence, snapshot, submit/review/publish/archive, PDF route |
| Workspace | Workspace, membership, invitation, cấu hình, activity/audit |
| Quản trị | System admin quản lý user Analyst/admin, trạng thái tài khoản và invitation |
| Vận hành | Telemetry PII-safe, CI quality gate, Azure container deployment |

Connector external không phải SQL console. MySQL và DuckDB chỉ nhận table hoặc
SELECT/WITH đọc dữ liệu; MongoDB nhận collection và JSON filter. Credential
được mã hóa ở backend và nguồn chỉ materialize tạm cho pipeline compute, tối đa
1.000.000 dòng.

## Công nghệ

| Thành phần | Công nghệ |
| --- | --- |
| Frontend | Next.js 15, React 19, TypeScript, React Query, Supabase SSR/PKCE |
| Backend | FastAPI, Pydantic, SQLAlchemy, Alembic |
| Agent | LangGraph/LangChain, provider OpenAI-compatible (Gemini, OpenAI, OpenRouter, Groq, Together, Ollama hoặc custom) |
| Compute | DuckDB, pandas, NumPy, SciPy, statsmodels, scikit-learn |
| Persistence | PostgreSQL/Supabase DB, Supabase Storage/Google Drive/local development storage |
| Test & deploy | pytest, Ruff, Vitest, Playwright, Docker, Azure App Service, GitHub Actions |

## Các ràng buộc thiết kế

- Không gửi raw row, PII thô, SQL/Python/shell tùy ý tới UI, report hoặc Agent.
- FastAPI xác thực Bearer token, resolve workspace và capability trước mọi API
  nhạy cảm. System admin không tự động có Analyst workspace permission.
- PII đã xác nhận bị loại khỏi chart/Agent context; output guardrails áp dụng
  trước khi trả về UI, report và MCP.
- Official evidence gắn với query/context/result hash. Snapshot bất biến là
  nguồn export ưu tiên, không dùng lại UI state trực tiếp.
- LangSmith là projection metadata-only, fail-open; PostgreSQL là nguồn trace
  có thẩm quyền.
- Browser chỉ nhận biến NEXT_PUBLIC_* an toàn. Key, password, service role,
  OAuth credential, database URL và DATASOURCE_ENCRYPTION_KEY chỉ ở server.

## Thành phần runtime

~~~mermaid
flowchart LR
  UI[Next.js frontend] -->|Bearer token + workspace| API[FastAPI]
  UI --> Auth[Supabase Auth]
  API --> DB[(PostgreSQL / Supabase)]
  API --> Store[Supabase Storage / Google Drive]
  API --> Worker[Profiling worker]
  Worker --> DB
  Worker --> Compute[DuckDB + pandas]
  Compute --> Store
  API --> LLM[LLM provider]
  API -. metadata only .-> Trace[LangSmith optional]
~~~

Production dùng ba process Azure App Service độc lập: frontend, API và
profiling worker. Pipeline build image, chạy Alembic migration, cập nhật App
Service settings rồi kiểm tra health endpoint.

## Kiểm thử và vận hành

- Backend: Ruff, pytest với PostgreSQL test riêng, offline evaluation.
- Frontend: Vitest, typecheck, lint, Playwright E2E và production build.
- API/public health: GET /health; API nghiệp vụ dùng prefix /api/v1.
- Cờ UX Command Center ở backend và frontend là độc lập; đổi
  NEXT_PUBLIC_UX_COMMAND_CENTER_ENABLED phải build lại frontend.
- Guest trial chỉ bật khi AUTH_ALLOW_GUEST và
  NEXT_PUBLIC_AUTH_ALLOW_GUEST đều true; guest có storage/retention riêng.

## Tài liệu liên quan

- [README](../README.md): cài đặt, cấu hình, API và kiểm thử.
- [Architecture](../ARCHITECTURE.md): data flow, ownership, sequence và
  security boundary.
- [Production Supabase](production-supabase.md): checklist Supabase/Auth.
- [Azure CI/CD](azure-deploy-cicd.md): build, secret và triển khai.
- [Evaluation](eval_v1.md): quy trình đánh giá AI.
