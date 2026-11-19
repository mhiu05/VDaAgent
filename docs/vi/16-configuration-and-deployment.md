# 16 · Cấu hình và triển khai

Dự án là một stack docker compose. **Phụ thuộc:** [02](02-architecture.md), [11](11-sandbox.md), [12](12-auth-and-domains.md), [13](13-observability.md).

## Cấu trúc repo

```text
pyproject.toml          gốc uv workspace; thành viên agents/, backend/, eval/
backend/                service api: backend.main:app, alembic/, tests/, pyproject.toml
agents/                 package Python phía agent (thành viên uv), pyproject.toml
eval/                   đánh giá agent (make eval → eval.runners.run_smoke_eval), pyproject.toml
frontend/               app React, image nginx riêng
infra/docker/           backend.Dockerfile, frontend.Dockerfile
infra/Caddyfile         reverse proxy: /api → backend:8000, còn lại → frontend:80 (CI sao chép file này)
workspace/              Dockerfile, execd/ (+ requirements*.txt), contoso/, tests/
domains/
  fabrikam/                    domain.yaml, credentials/*.env.example (12, 18)
deploy/
  langfuse.compose.yaml  các service Langfuse, chép từ docker-compose.yml của langfuse/langfuse (tag v4.63.0, image :4), bỏ postgres
  postgres/init/10-langfuse.sql
  postgres/test-init/20-contoso-test.sql   database contoso_test cho compose.test.yaml
.github/workflows/      ci-cd.yml
scripts/                (trống)
docs/                   bộ tài liệu này (+ vi/)
docker-compose.yml  compose.test.yaml  .env.example  .dockerignore  Makefile  uv.lock

Dự kiến (chưa có trong repo):
platform/
  agent-skeleton/       thư mục mà mọi agent bắt đầu từ đó (04)
  lead/prompt.md        vai trò lead chung
  rules.md              quy tắc nền tảng render vào mọi system prompt (06)
  compaction.md         prompt compaction (06)
  jev_criteria.yaml     tiêu chí phân loại của jev, qua Decisions API (07)
  seeds/skills.yaml, seeds/library_presets.yaml
domains/<id>/starters/, domains/<id>/seeds/    (12, 18)
```

Các thành viên uv workspace là thành viên ảo (`[tool.uv] package = false`): chúng chỉ khai báo thư viện phụ thuộc, còn code được import từ gốc repo (`PYTHONPATH=/app` trong image), nên `backend.main:app` và `python -m eval.runners…` chạy được mà không cần cài các thành viên thành distribution.

## Hiện trạng

**Trạng thái:** Đã triển khai (khung S0).

| Mục | Hiện tại |
|---|---|
| `docker-compose.yml` | stack bên dưới: `backend`, `frontend`, `workspace`, `postgres`, các service Langfuse được include, và một `proxy` tùy chọn (Caddy, profile `proxy`) |
| `pyproject.toml` (gốc, `agents/`, `backend/`, `eval/`) | uv workspace có `uv.lock`; cấu hình ruff và pytest nằm trong file gốc |
| `backend/` | `main.py` (app factory, bước khởi động 1, `GET /api/health`), `settings.py`, `preflight.py`, `init_env.py`, `domains/validate.py` (quy tắc 1–3 của [12](12-auth-and-domains.md#kiểm-tra-khi-khởi-động)), `tests/` |
| `workspace/` | image theo [11](11-sandbox.md#image); `execd` phục vụ `GET /health` và `POST /exec` có xác thực, áp dụng giới hạn filesystem và tạo snapshot Git; `workspace/prewarm.py` làm nóng cache uv dùng chung |
| `infra/docker/backend.Dockerfile` | `python:3.12-slim` + uv 0.9.30, `git`, `curl`, `uv sync --frozen`, uid 1000, healthcheck `/api/health`; stage `test` thêm nhóm dev |
| `infra/docker/frontend.Dockerfile` | `node:24-alpine` (`deps` → `source` → `builder`) + `nginx:alpine`, fallback SPA, cổng 80, context `./frontend` |
| `Makefile` | xem [Makefile](#makefile) |
| CI/CD (`.github/workflows/ci-cd.yml`, "VDaAgent CI/CD") | khi push/PR vào `main`: job Python có service `postgres:17` (`uv sync --frozen --all-packages`, ruff trên `agents backend eval workspace`, `pytest` với `MODEL_BACKEND=fake`, rồi test `execd`); job frontend trên Node 24 (`npm ci`, lint, build, `npm test`, `npm run test:domain`) |
| Triển khai | khi push vào `main`: đẩy image `backend`, `frontend`, `workspace` lên GHCR và triển khai cả ba theo cùng mã commit. Sao chép compose, Caddy, `deploy/`, `platform/` và template domain; giữ cấu hình cũ khi nâng cấp tên thư mục. Yêu cầu `.env` đã được cấu hình, kiểm tra compose, pull image và khởi động với `--no-build --wait`. Các lần deploy chạy tuần tự. |

Mọi phần còn lại của trang này là thiết kế mục tiêu (**Trạng thái:** Dự kiến) trừ khi ghi khác.

## `.env` gốc

Chạy `make setup` trước ([Bắt đầu](#bắt-đầu)). Lệnh này sao chép `.env.example` thành `.env` nếu chưa có `.env`. Sau đó nó điền mọi key **tự sinh** còn thiếu hoặc rỗng bằng một giá trị ngẫu nhiên: `secrets.token_urlsafe(32)`, 64 ký tự hex cho `LANGFUSE_ENCRYPTION_KEY`, và `pk-lf-<uuid>` / `sk-lf-<uuid>` cho key Langfuse. Nó tạo từng `domains/<id>/credentials/<set>.env` còn thiếu từ `.env.example` tương ứng (mode 600). Nó không bao giờ ghi đè giá trị hay file đã có. Nó chỉ in tên: các key đã điền, các file đã tạo, và theo từng file, các key rỗng mà người vận hành còn phải điền (các key người vận hành của `.env`, `DEMO_PASSWORD` là tùy chọn, và mọi key credentials còn rỗng). Đây là `python -m backend.init_env` (chỉ dùng thư viện chuẩn) trong container `python:3.12-slim`, nên không cần build image.

| Key | Nguồn | Ý nghĩa |
|---|---|---|
| `OPENROUTER_API_KEY` | **người vận hành** | credential duy nhất cho model ([quyết định 0008](decisions/0008-platform-openrouter-key-no-byok.md)) |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | **người vận hành** | admin đầu tiên; cũng là mật khẩu đăng nhập Langfuse |
| `DEMO_PASSWORD` | **người vận hành**, tùy chọn | khi được đặt, `make up` tạo người dùng demo `alice` và `bob` (cùng miền fabrikam) với mật khẩu này |
| `AGENT_MODEL` | mặc định `anthropic/claude-haiku-4.5` | activation |
| `JEV_MODEL` | mặc định `typesafe/jev-1.14` | jev, qua Decisions API của OpenRouter |
| `JEV_CONFIDENCE_FLOOR` | mặc định `0.6` | dưới ngưỡng này, `confidence` của jev ép `label` về `side_question` ([07](07-routing-and-queue.md#phân-loại)) |
| `COMPACTION_MODEL` | mặc định = `AGENT_MODEL` | compaction |
| `OPENROUTER_BASE_URL` | mặc định `https://openrouter.ai/api/v1` | |
| `POSTGRES_PASSWORD`, `SESSION_SECRET`, `EXECD_TOKEN` | tự sinh | |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` | tự sinh | key của project (headless init + SDK) |
| `LANGFUSE_NEXTAUTH_SECRET`, `LANGFUSE_SALT`, `LANGFUSE_ENCRYPTION_KEY` | tự sinh | nội bộ Langfuse |
| `CLICKHOUSE_PASSWORD`, `REDIS_AUTH`, `MINIO_ROOT_PASSWORD` | tự sinh | kho dữ liệu của Langfuse |
| `LANGFUSE_INIT_USER_EMAIL` | mặc định `admin@contoso.local` | đăng nhập Langfuse |
| `LANGFUSE_PUBLIC_URL` | mặc định `http://localhost:3100` | link và `NEXTAUTH_URL` |
| `APP_PORT` | mặc định `8000` | cổng API được publish |
| `APP_URL` | mặc định `http://localhost:${APP_PORT}` | `HTTP-Referer` gửi OpenRouter |
| `COOKIE_SECURE` | mặc định `0` | đặt `1` khi chạy sau HTTPS |
| `GITHUB_TOKEN` | tuỳ chọn | giới hạn GitHub cao hơn khi cài kỹ năng |
| `MODEL_BACKEND` | mặc định `openrouter` | `fake` khi test ([17](17-testing.md)) |
| `MODEL_CONTEXT_TOKENS` | tuỳ chọn | ghi đè kích thước cửa sổ, vốn được đọc từ `GET /models` của OpenRouter (`context_length`) khi khởi động |
| Tham số tinh chỉnh | mặc định trong code | `SOFT_CONTEXT_RATIO=0.6`, `HARD_CONTEXT_RATIO=0.9`, `OFFLOAD_CHARS=8000`, `OFFLOAD_HEAD_CHARS=2000`, `OFFLOAD_TAIL_CHARS=2000`, `EXEC_TIMEOUT_S=120`, `EXEC_MEM_MB=2048`, `MAX_STEPS_PER_ACTIVATION=50`, `MODEL_TIMEOUT_S=120`, `TASK_MAX_S=3600`, `JEV_K=20`, `MAX_AGENTS_PER_USER=12` |

`backend/settings.py` đọc chúng bằng `pydantic-settings`. Biến môi trường của tiến trình thắng `.env`, và giá trị rỗng được coi như chưa đặt (nên dùng giá trị mặc định). Compose còn đặt `DATABASE_URL`, `EXECD_URL`, `LANGFUSE_BASE_URL`, `DOMAINS_DIR` (`/domains`) và `PLATFORM_DIR` (`/platform`) cho `backend`; các key này không có trong `.env.example`.

**Preflight.** `make check`, cũng chạy đầu tiên trong `make up` và khi `api` khởi động, liệt kê các key bắt buộc còn thiếu hoặc rỗng và các miền không hợp lệ (bằng tên key hoặc tên file, không bao giờ bằng giá trị). Lệnh trả mã khác 0 nếu thiếu key của nền tảng, và khi đó `api` không khởi động. Miền không hợp lệ chỉ khiến miền đó `unavailable`. Các key nền tảng bắt buộc là `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `POSTGRES_PASSWORD`, `SESSION_SECRET`, `EXECD_TOKEN`, và `OPENROUTER_API_KEY` trừ khi `MODEL_BACKEND=fake`. Thiếu key Langfuse chỉ được báo, không gây lỗi (tracing tắt, [13](13-observability.md#langfuse-trong-stack-compose)).

Credentials của miền nằm trong `domains/<id>/credentials/<set>.env` ([12](12-auth-and-domains.md#luồng-credentials)), không nằm trong `.env` gốc.

## Compose

```yaml
# docker-compose.yml (phác thảo; env đầy đủ của Langfuse nằm ở deploy/langfuse.compose.yaml)
name: contoso
include:
  - deploy/langfuse.compose.yaml
services:
  backend:              # tài liệu này gọi là `api`
    build: {context: ., dockerfile: infra/docker/backend.Dockerfile}
    env_file: .env
    environment:
      DATABASE_URL: postgresql+asyncpg://contoso:${POSTGRES_PASSWORD}@postgres:5432/contoso
      EXECD_URL: http://workspace:7000
      LANGFUSE_BASE_URL: http://langfuse-web:3000
    user: "1000:1000"
    ports: ["127.0.0.1:${APP_PORT:-8000}:8000"]
    volumes:
      - folders:/data/folders
      - attachments:/data/attachments
      - reports:/data/reports
      - ./domains:/domains:ro
      - ./platform:/platform:ro
    networks: [app, exec]
    depends_on:
      postgres: {condition: service_healthy}
      workspace: {condition: service_healthy}
    healthcheck: {test: ["CMD", "curl", "-fs", "http://localhost:8000/api/health"]}
  frontend:
    build: {context: ./frontend, dockerfile: ../infra/docker/frontend.Dockerfile}
    networks: [app]     # nginx trên 80, fallback SPA; truy cập qua reverse proxy
  workspace:
    build: {context: ., dockerfile: workspace/Dockerfile}
    environment: {EXECD_TOKEN: "${EXECD_TOKEN}"}
    volumes:
      - folders:/data/folders
      - ./domains:/domains:ro
    networks: [exec]
    pids_limit: 4096
    healthcheck: {test: ["CMD", "curl", "-fs", "http://localhost:7000/health"]}
  postgres:
    image: postgres:17
    environment: {POSTGRES_USER: contoso, POSTGRES_PASSWORD: "${POSTGRES_PASSWORD}", POSTGRES_DB: contoso}
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./deploy/postgres/init:/docker-entrypoint-initdb.d:ro
    networks: [app]
    healthcheck: {test: ["CMD-SHELL", "pg_isready -U contoso"]}
networks:
  app: {}
  exec: {}
volumes: {folders: {}, attachments: {}, reports: {}, pgdata: {}}
```

- **`deploy/langfuse.compose.yaml`** định nghĩa `langfuse-web` (`127.0.0.1:3100:3000`), `langfuse-worker`, `clickhouse`, `redis` và `minio`, tất cả trên `app`. Nó ánh xạ key của chúng ta sang tên của Langfuse:
  - `DATABASE_URL=postgresql://contoso:${POSTGRES_PASSWORD}@postgres:5432/langfuse`
  - `SALT=${LANGFUSE_SALT}`, `ENCRYPTION_KEY=${LANGFUSE_ENCRYPTION_KEY}`, `NEXTAUTH_SECRET=${LANGFUSE_NEXTAUTH_SECRET}`, `NEXTAUTH_URL=${LANGFUSE_PUBLIC_URL}`
  - `CLICKHOUSE_PASSWORD`, `REDIS_AUTH`, `MINIO_ROOT_PASSWORD`, và các S3 secret access key = `${MINIO_ROOT_PASSWORD}`
  - `TELEMETRY_ENABLED=false`
  - các giá trị `LANGFUSE_INIT_*` ở [13](13-observability.md#langfuse-trong-stack-compose)
- **`deploy/postgres/init/10-langfuse.sql`:** `CREATE DATABASE langfuse OWNER contoso;`
- **Một uid cho cả hai bên ghi.** `api` chạy với uid 1000, trùng với user `agent` trong `workspace`, nên cả hai ghi được volume `folders`. Cả hai image chạy `git config --system safe.directory '*'`.
- **Image `api`** (`infra/docker/backend.Dockerfile`): `python:3.12-slim` có uv, `git` và `curl`; cài app bằng `uv sync --frozen`. Image này không chứa frontend.
- **Image `frontend`** (`infra/docker/frontend.Dockerfile`): builder `node:24-alpine` chạy bản build Vite, và `nginx:alpine` phục vụ `dist` trên cổng 80 với fallback SPA.
- **Tên image.** `backend`, `frontend` và `workspace` được gắn tag `${BACKEND_IMAGE:-contoso-backend}`, `${FRONTEND_IMAGE:-contoso-frontend}` và `${WORKSPACE_IMAGE:-contoso-workspace}`, nên máy triển khai có thể kéo image GHCR bằng cách đặt các biến này.
- **Reverse proxy.** `proxy` (`caddy:2.10-alpine`, `infra/Caddyfile`) nằm trong profile compose `proxy`, nên `docker compose up` thường (máy triển khai) không bật nó; `make up` truyền `--profile proxy`. Proxy được publish trên `127.0.0.1:${PROXY_PORT:-8080}`.
- **Secret không vào image.** `.dockerignore` loại `.env`, `.env.*` (trừ `.env.example`) và `domains/*/credentials/*.env`.
- **Mạng.** `workspace` không gắn vào `app`, nên không phân giải hay tới được `postgres` hay `langfuse-*`. `exec` là mạng bridge bình thường, nên vẫn ra internet được.

## Trình tự khởi động (lifespan của `api`)

**Trạng thái:** Đã triển khai bước 1–5 (S0, S1, S2; bước 4 là hook rỗng cho tới S9); các bước còn lại dự kiến cùng section của chúng. Bước 3–5 chạy trong một transaction (`backend.main.run_boot_steps`).

1. Nạp cấu hình và chạy preflight.
2. `alembic upgrade head` (`backend.db.migrate`, trong một worker thread), rồi tạo engine. Migration lỗi thì dừng khởi động. Từ đây check `db` của `/api/health` chạy `SELECT 1` qua engine đó.
3. Upsert `domains` từ kết quả miền của preflight ở bước 1, vốn chạy đủ năm quy tắc của [12](12-auth-and-domains.md#kiểm-tra-khi-khởi-động).
4. Upsert các kho (`skill_catalog`, `library_presets`) từ seed.
5. Đảm bảo có admin ([12](12-auth-and-domains.md#đăng-nhập-mức-poc)); `ADMIN_USERNAME` không hợp lệ hoặc đã bị dùng thì dừng khởi động.
6. Đánh dấu thất bại các `jobs` còn dở; đối chiếu agent: mỗi người dùng đang hoạt động có một lead, và thư mục của mỗi agent đang hoạt động tồn tại (nếu không thì báo `error` trên trang tổng quan). Rồi chạy xử lý khởi động lại ([03](03-agent-loop.md#khởi-động-lại)).
7. Lấy kích thước cửa sổ của model từ OpenRouter. `MODEL_CONTEXT_TOKENS`, nếu được đặt, ghi đè các giá trị này; model không có trong danh sách, hoặc lấy thất bại, thì dùng 128.000.
8. Khởi động supervisor (runner của các miền khả dụng), bộ lập lịch, worker job và client Langfuse.
9. Phục vụ `:8000` và `:8001`.

## Makefile

**Trạng thái:** Đã triển khai. Mọi target chạy công cụ trong Docker.

| Target | Làm gì |
|---|---|
| `make setup` | bước 1 của [Bắt đầu](#bắt-đầu): kiểm tra Docker, Compose và buildx hoạt động, rồi tạo hoặc bổ sung `.env` và các file credentials của miền, và liệt kê những gì còn phải điền (`python -m backend.init_env` trong container `python:3.12-slim`) |
| `make check` | bước 2: preflight từ dòng lệnh (`docker compose run --rm --no-deps --build backend python -m backend.preflight`); lỗi khi chưa có `.env` |
| `make up` | bước 3: `make check`, rồi `docker compose --profile proxy up -d --build --wait`; sau đó, nếu `.env` có `DEMO_PASSWORD`, chạy `python -m backend.seed_demo` trong `backend` đang chạy (tạo `alice` và `bob`, giữ nguyên người dùng đã có; job worker tạo agent cho họ); in URL của app, API và Langfuse |
| `make down` / `make logs` | `docker compose --profile '*' down --remove-orphans` (giữ volume) / `logs -f backend workspace` |
| `make test` | test backend, workspace và frontend trong compose ([17](17-testing.md#test-chạy-ở-đâu)), rồi xóa project `contoso-test`; có thêm `test-backend`, `test-workspace`, `test-frontend`, `test-clean` |
| `make lint` / `make format` | ruff trên `agents backend eval workspace` (image uv); `lint` chạy thêm ESLint của frontend |
| `make lock` | làm mới `uv.lock` và `workspace/execd/requirements*.txt` |
| `make eval` | `python -m eval.runners.run_smoke_eval` trong image `backend` (module này chưa tồn tại) |
| `make e2e` | Playwright trên một stack mới ở chế độ giả ([17](17-testing.md#end-to-end-playwright-chế-độ-giả)); khi lỗi, artifact nằm trong `e2e-results/` |
| `make test-live` | test hợp đồng live với OpenRouter (`pytest -m live`, tự chọn; cần `OPENROUTER_API_KEY` trong `.env`) |

Các target cũ chạy công cụ trên máy chủ (một `setup` cài công cụ trên máy, `dev-infra` với pgvector + Redis, `dev-be`, `dev-fe`, `docker-*`) đã bỏ: app dùng Postgres 17 thường, Langfuse tự mang Redis riêng, và không có gì chạy trên máy chủ. `init-env`, `check-env` và `seed-demo` đã gộp vào `setup`, `check` và `up`.

## Bắt đầu

**Trạng thái:** Đã triển khai. Hướng dẫn đầy đủ cho thành viên nhóm, gồm yêu cầu, bảng key và xử lý sự cố, nằm ở [`GUIDE.vi.md`](../../GUIDE.vi.md) ([English](../../GUIDE.md)).

```bash
make setup                          # 1. .env + domains/*/credentials/*.env; liệt kê các key cần điền
$EDITOR .env domains/*/credentials/*.env
make check                          # 2. đến khi không còn key bắt buộc nào thiếu
make up                             # 3. stack + proxy, người dùng demo nếu có DEMO_PASSWORD, in các URL
```

App (SPA và `/api` chung một origin, qua proxy) ở `http://localhost:8080`, riêng API ở `http://127.0.0.1:8000` (`/api/health` → `{"ok": true, "db": true, "execd": true}`), Langfuse ở `http://localhost:3100`. Nếu cổng đã bị chiếm, đặt `PROXY_PORT`, hoặc `APP_PORT` và `APP_URL`, trong `.env`.

**Không có Docker daemon cục bộ.** Đừng trỏ CLI cục bộ tới máy remote bằng `DOCKER_HOST=ssh://<host>`: compose phân giải các bind mount tương đối (`./domains`, `./platform`, `./deploy/postgres/init`) thành đường dẫn trên máy client, và daemon remote tạo chúng rỗng trên hệ thống file của nó, nên stack khởi động mà không có miền nào. Hãy chạy ba bước trong một bản checkout trên máy remote và truy cập cổng 8080, 8000 và 3100 qua SSH tunnel (`ssh -L 8080:127.0.0.1:8080 -L 8000:127.0.0.1:8000 -L 3100:127.0.0.1:3100 <host>`). Langfuse được publish ở 3100 vì cổng 3000 thường đã bị chiếm.
