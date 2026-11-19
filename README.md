# VDaAgent

Mỗi người dùng có một nhóm AI agent riêng, phân tích kho dữ liệu (data warehouse) của miền nghiệp vụ (domain) và trả lời bằng tiếng Việt. Mỗi người dùng có một agent điều phối (lead) và các agent khởi tạo sẵn (starter) theo domain của mình. Agent chạy Python trong sandbox, truy vấn warehouse ở chế độ chỉ đọc và xuất bản báo cáo. Tài liệu thiết kế nằm trong [`docs/`](docs/00-overview.md) (bản tiếng Anh là bản gốc; [`docs/vi/`](docs/vi/00-overview.md) là bản dịch tương ứng).

## Kiến trúc

```text
Browser ──► proxy (Caddy, :8080) ──► frontend (nginx, React SPA)
                    │
                    └── /api ──► backend (FastAPI :8000, agent harness, internal API :8001)
                                   ├──► workspace (execd: sandboxed Python per agent, :7000)
                                   ├──► postgres (application DB `contoso`; Langfuse DB `langfuse`)
                                   ├──► model provider (OpenRouter-compatible API)   external
                                   └──► Langfuse (tracing, :3100)                     optional
workspace ──► domain warehouse (read-only DSN per domain)                             external, optional
```

Toàn bộ hệ thống chạy bằng Docker Compose (tên project `contoso`). Chỉ có proxy (8080), API (8000) và Langfuse (3100) được mở ra máy host, và chỉ trên `127.0.0.1`.

## Yêu cầu

| Cần có | Ghi chú |
|---|---|
| Docker với Compose **v2.20+** và **buildx** | Docker Desktop có sẵn cả hai. Linux: Docker Engine + `docker-compose-plugin` + `docker-buildx-plugin` |
| `make`, `git` | Windows: dùng WSL 2 và bật WSL integration của Docker Desktop |
| ~6 GB RAM, ~10 GB ổ đĩa cho Docker | Langfuse và ClickHouse chiếm phần lớn bộ nhớ khi rảnh |
| Một OpenRouter API key | xin từ chủ dự án; không cần khi dùng `MODEL_BACKEND=fake` |

Bạn không cần cài Python, Node hay uv trên máy host: mọi công cụ đều chạy trong container.

## Bắt đầu nhanh

```bash
git clone <repo-url> VDaAgent && cd VDaAgent
make setup     # creates .env (+ random internal secrets) and domains/*/credentials/*.env
# edit .env: OPENROUTER_API_KEY, ADMIN_USERNAME, ADMIN_PASSWORD (and DEMO_PASSWORD if you want demo users)
make check     # names any missing key; prints the effective model config
make up        # builds, starts, waits for health, creates demo users, prints the URLs
make health    # api + proxy health
```

Thứ tự các bước:

1. `make setup` tạo `.env` (kèm các secret nội bộ ngẫu nhiên) và các file `domains/*/credentials/*.env`.
2. Mở `.env`, điền `OPENROUTER_API_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` (và `DEMO_PASSWORD` nếu muốn có tài khoản demo).
3. `make check` báo tên các biến còn thiếu và in cấu hình model đang có hiệu lực.
4. `make up` build, khởi động hệ thống, chờ các health check đạt, tạo tài khoản demo và in các URL.
5. `make health` kiểm tra sức khỏe hệ thống qua API và proxy.

Mở <http://localhost:8080> và đăng nhập bằng `ADMIN_USERNAME`, hoặc bằng `alice`/`bob` với mật khẩu `DEMO_PASSWORD`.

`make up` không tải các gói phân tích của agent (pandas, scipy, …): image `workspace` chỉ chứa những gì execd cần, nên hệ thống nhanh chóng đạt `healthy`. Gói chỉ được tải khi provisioning một agent cần đến chúng, vào cache uv dùng chung `/data/folders/.uv-cache`; agent sau dùng lại cache đó. Trên mạng chậm, lần provisioning đầu tiên có thể mất vài phút cho mỗi người dùng. Trong lúc đó người dùng đăng nhập được và thấy màn hình "Đang khởi tạo không gian AI của bạn"; trang chat tự hiện khi trạng thái chuyển sang `active`. Quản trị viên theo dõi tiến độ (agent nào đang được chuẩn bị) và bấm **Thử lại khởi tạo** cho người dùng `failed` ở Admin → Người dùng.

**Tùy chọn — làm nóng cache:**

```bash
make warm-cache          # tải trước mọi gói của các preset vào cache uv dùng chung (kèm hash)
make warm-cache-status   # dung lượng cache và đã có đủ gói preset hay chưa
```

`warm-cache` là tùy chọn: nó giúp lần provisioning agent đầu tiên nhanh hơn, nhưng không cần thiết để khởi động Contoso. Lệnh không tạo agent, không đổi trạng thái người dùng, không cần xóa volume, và chạy lại nhiều lần vẫn an toàn (dùng lại những gì đã có trong cache).

**Tùy chọn — chuẩn bị máy trước buổi demo / onboarding nhiều người dùng:**

```bash
make demo-ready   # warm-cache → warm-cache-status → up → health; dừng ngay nếu một bước lỗi
```

`demo-ready` làm nóng cache *trước* `make up` (để `alice`/`bob` được provisioning từ cache), không xóa volume, không reset DB, không tạo lại người dùng có sẵn. Phát triển hằng ngày vẫn chỉ cần `make up`.

## Cấu hình biến môi trường

`.env.example` là template chuẩn. Mỗi biến trong đó đều được gắn nhãn: [REQUIRED], [SECRET], [GENERATED], [DEFAULTED] hoặc [OPTIONAL]. Giá trị rỗng nghĩa là "dùng giá trị mặc định". `make setup` không bao giờ ghi đè một giá trị đã có.

| Biến | Bắt buộc? | Mặc định | Mục đích |
|---|---|---|---|
| `OPENROUTER_API_KEY` | **có** (secret), trừ khi `MODEL_BACKEND=fake` | — | thông tin xác thực duy nhất cho model |
| `ADMIN_USERNAME` | **có** | — | tài khoản quản trị đầu tiên (3–32 ký tự `a-z 0-9 . _ -`) |
| `ADMIN_PASSWORD` | **có** (secret) | — | mật khẩu quản trị, đồng thời là mật khẩu Langfuse |
| `POSTGRES_PASSWORD`, `SESSION_SECRET`, `EXECD_TOKEN`, các biến `LANGFUSE_*`, `CLICKHOUSE_PASSWORD`, `REDIS_AUTH`, `MINIO_ROOT_PASSWORD` | **có** (secret) | do `make setup` sinh ra | các secret nội bộ |
| `AGENT_MODEL` | không | `deepseek/deepseek-v4.1-flash` trong template (trong code: `anthropic/claude-haiku-4.5`) | model cho các lượt xử lý của agent |
| `COMPACTION_MODEL` | không | = `AGENT_MODEL` | model dùng để nén ngữ cảnh (compaction) |
| `JEV_MODEL` | không | `typesafe/jev-1.14` | bộ định tuyến tin nhắn của lead; để trống |
| `OPENROUTER_BASE_URL` | không | `https://openrouter.ai/api/v1` | endpoint của provider |
| `MODEL_BACKEND` | không | `openrouter` | `fake` = model giả lập theo kịch bản, không cần key |
| `DEMO_PASSWORD` | không | — | tạo `alice` và `bob`; khi `DEMO_MODE=true`, mật khẩu này được điền trên trình duyệt, nên chỉ dùng mật khẩu demo riêng |
| `DEMO_MODE` | không | `false` | bật truy cập nhanh demo; tắt trong môi trường production |
| `DEMO_ADMIN_PASSWORD` | không (secret) | — | tạo tài khoản `admin-demo` riêng; chỉ dùng ở backend |
| `PROXY_PORT` / `APP_PORT` / `LANGFUSE_PORT` | không | `8080` / `8000` / `3100` | cổng trên máy host (127.0.0.1) |
| `APP_URL` | không | `http://localhost:${APP_PORT}` | chỉ được gửi làm `HTTP-Referer` tới provider |
| `COOKIE_SECURE` | không | `0` | đặt `1` khi chạy sau HTTPS |
| `VITE_SERVICE_MODE` | không | `hybrid` | chế độ build frontend; `mock` = giao diện demo không cần backend |
| `UV_HTTP_TIMEOUT` | không | `300` | thời gian chờ mỗi lần tải gói khi provisioning agent |
| `AGENT_PACKAGE_INSTALL_TIMEOUT_S` | không | `1200` (tối đa 3600) | giới hạn thời gian cho `uv add` / `uv sync` trong thư mục agent; các system exec khác giữ 600 s |
| `GITHUB_TOKEN` | không (secret) | — | nâng giới hạn rate limit của GitHub khi cài skill |
| `COMPOSE_FILE`, `POSTGRES_HOST_PORT` | không | — | mở PostgreSQL cho psql/DBeaver ([xem bên dưới](#dbeaver)) |

Code đọc `OPENROUTER_API_KEY` và `OPENROUTER_BASE_URL`. `OPENAI_API_KEY` / `OPENAI_BASE_URL` bị **bỏ qua**, và `make check` sẽ cảnh báo nếu chúng được đặt. `DATABASE_URL`, `EXECD_URL` và các biến tương tự do Docker Compose đặt, không thuộc về `.env`.

Thông tin xác thực của domain warehouse nằm trong `domains/<id>/credentials/*.env` (ví dụ `WAREHOUSE_DSN`, `WAREHOUSE_SNAPSHOT_ID`, `TAVILY_API_KEY`), không nằm trong `.env`.

## Cấu hình model

```text
AGENT_MODEL=deepseek/deepseek-v4.1-flash          # known working
COMPACTION_MODEL=deepseek/deepseek-v4.1-flash
# generic form
AGENT_MODEL=<provider>/<model-id>
COMPACTION_MODEL=<provider>/<model-id>
```

- Model ID được cấu hình trong `.env`. Cấu hình `deepseek/deepseek-v4.1-flash` ở trên đã được kiểm chứng là chạy được.
- Hai model có thể giống nhau hoặc cấu hình độc lập. Nếu `COMPACTION_MODEL` để trống thì hệ thống dùng `AGENT_MODEL`.
- Đổi `AGENT_MODEL` / `COMPACTION_MODEL` chỉ cần sửa `.env`, không bao giờ phải sửa source code. Sau khi sửa, chạy `make up` để tạo lại container (xem [Đổi model](#đổi-model)).
- Model ID phải tồn tại ở provider đang cấu hình. `AGENT_MODEL` phải hỗ trợ **tool calling** vì agent làm việc qua tool `python`. Không phải model nào ở provider nào cũng tương thích: runtime phụ thuộc vào khả năng của provider và model.
- Cấu hình sai sẽ báo lỗi rõ ràng chứ không lặng lẽ thất bại:
  - `make check` và log khởi động in dòng `model: backend=… base_url=… agent=… compaction=…` với cấu hình đang có hiệu lực.
  - Khi khởi động, backend ghi WARNING nếu model không có trong danh sách `GET /models` của provider, hoặc không khai báo hỗ trợ tool calling.
  - Khi chạy, khung chat hiển thị lỗi có mã, ví dụ `model_request_rejected` hoặc `MODEL_PROTOCOL_ERROR`, thay vì treo.

## Khởi động hệ thống

| Lệnh | Kết quả |
|---|---|
| `make up` | chạy `make check`, rồi `docker compose --profile proxy up -d --build --wait`, sau đó tạo tài khoản demo và in các URL. Chạy lại nhiều lần vẫn an toàn: chỉ build lại và tạo lại những gì đã thay đổi |
| `make ps` | xem trạng thái dịch vụ: mọi dịch vụ `running`; backend, workspace, postgres, frontend `healthy` |
| `make down` | dừng toàn bộ; **dữ liệu được giữ nguyên** |

Thứ tự khởi động:

1. postgres và workspace chạy trước và phải đạt `healthy`.
2. backend chạy preflight, áp dụng migration `alembic upgrade head` (tự động), đồng bộ domain và catalog, tạo tài khoản quản trị đầu tiên và khởi động agent runtime.
3. frontend và proxy chạy sau cùng.

Langfuse là tùy chọn đối với backend: thiếu key Langfuse thì chỉ đơn giản là tắt tracing.

## Tạo / seed người dùng

- **Tài khoản quản trị đầu tiên.** Được tạo khi backend khởi động, từ `ADMIN_USERNAME` / `ADMIN_PASSWORD`, và chỉ khi chưa có tài khoản quản trị nào. Đổi hai biến này sau đó sẽ không thay đổi tài khoản quản trị đã có.
- **Người dùng thường.** Tài khoản quản trị tạo họ trong trang quản lý người dùng của ứng dụng web (POST `/api/admin/users`) và chọn domain. Người dùng bắt đầu ở trạng thái `provisioning`. Một job chạy nền tạo agent cho họ, sau đó trạng thái chuyển thành `active`, hoặc `failed` kèm nút thử lại.
- **Người dùng demo.** `alice` và `bob` (cùng miền fabrikam), được `make up` (hoặc `make seed-demo`) tạo khi `DEMO_PASSWORD` được đặt. Người dùng đã tồn tại được giữ nguyên.
- **Demo quản trị.** Khi `DEMO_MODE=true` và `DEMO_ADMIN_PASSWORD` được đặt trong `.env`, `make seed-demo` tạo tài khoản `admin-demo` riêng. Nút quản trị demo chỉ hoạt động trong chế độ này và dùng session cookie cùng RBAC của backend; tắt `DEMO_MODE` để vô hiệu hóa lối vào nhanh. Mật khẩu quản trị thật không được gửi tới frontend.
- **Không có tự đăng ký.** Ứng dụng không có trang đăng ký tài khoản.

## Đăng nhập

Truy cập <http://localhost:8080> (hoặc `PROXY_PORT` của bạn) và đăng nhập bằng username và mật khẩu, không phải email. Sai mật khẩu sẽ nhận thông báo "invalid credentials", và đăng nhập sai nhiều lần sẽ bị giới hạn (rate limit). Khi gọi API thủ công, mọi request không phải GET đều cần header `X-Contoso-Client: web` (nếu không sẽ nhận 403 `csrf`):

```bash
curl -c /tmp/cj -H 'X-Contoso-Client: web' -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"…"}' http://127.0.0.1:8080/api/auth/login
curl -b /tmp/cj http://127.0.0.1:8080/api/auth/me
```

## PostgreSQL

Có hai loại cơ sở dữ liệu khác nhau, đừng nhầm lẫn:

| | Cơ sở dữ liệu ứng dụng | Domain warehouse |
|---|---|---|
| Là gì | người dùng, agent, chat, task, event | dữ liệu nghiệp vụ mà agent phân tích |
| Ở đâu | dịch vụ Compose `postgres` (image `postgres:17`) | server bên ngoài, mỗi domain một server |
| Database / user | `contoso` / `contoso` (Langfuse dùng DB `langfuse` trên cùng server) | lấy từ `WAREHOUSE_DSN` |
| Mật khẩu | `POSTGRES_PASSWORD` trong `.env` | trong `domains/<id>/credentials/warehouse.env` |
| Từ các container | `postgres:5432` (`DATABASE_URL` do Compose tạo) | chỉ đọc, do agent trong `workspace` truy cập |
| Từ máy host | mặc định không mở ra; xem [DBeaver](#dbeaver) | tùy quy tắc mạng của warehouse đó |
| Schema | migration Alembic trong `backend/alembic/`, áp dụng mỗi lần backend khởi động | không do dự án này quản lý |
| Lưu trữ | volume `contoso_pgdata` | — |

`POSTGRES_PASSWORD` được cố định ngay khi volume `contoso_pgdata` được tạo lần đầu. Nếu đổi giá trị này sau đó, backend sẽ không đăng nhập được vào cơ sở dữ liệu hiện có.

```bash
make psql                                            # psql shell on contoso
docker compose exec -T postgres psql -U contoso -d contoso -c "SELECT version_num FROM alembic_version;"
```

```sql
SELECT id, username, display_name, role, status, created_at
FROM public.users
ORDER BY created_at DESC;
```

## DBeaver

Mặc định PostgreSQL không được mở ra máy host. Để mở cổng chỉ trên loopback, thêm vào `.env`:

```text
COMPOSE_FILE=docker-compose.yml:compose.db-port.yaml
POSTGRES_HOST_PORT=15432
```

Sau đó chạy `make up`. Container postgres được tạo lại với `127.0.0.1:15432->5432`; dữ liệu vẫn nằm trong volume. Trong DBeaver dùng:

- Host: `127.0.0.1`
- Port: `15432`
- Database: `contoso`
- User: `contoso`
- Mật khẩu: giá trị của `POSTGRES_PASSWORD`

Luôn giữ binding trên `127.0.0.1`, không bao giờ dùng `0.0.0.0`. Nếu cổng 15432 đã bị dùng (ví dụ bởi một bản sao warehouse chạy trên máy), hãy chọn cổng khác.

## Kiểm tra sức khỏe hệ thống

```bash
make health          # api, proxy /api/health and the app page
curl -fsS http://127.0.0.1:8000/api/health       # {"ok":true,"db":true,"execd":true}; 503 if not
make ps              # container health
```

- `make health` kiểm tra API, `/api/health` qua proxy và trang ứng dụng.
- `/api/health` trả về `{"ok":true,"db":true,"execd":true}` khi mọi thứ ổn, ngược lại trả 503.
- `make ps` hiển thị health của các container.

`/api/health` chứng minh backend đang chạy, cơ sở dữ liệu phản hồi và sandbox workspace phản hồi. Nó không gọi tới model provider: lần chat đầu tiên mới là phép kiểm tra model thật.

## Log

```bash
make logs                       # backend + workspace
make logs SERVICES=frontend     # or postgres, proxy, langfuse-web, ...
make logs SERVICES=             # whole stack
docker compose logs backend | grep preflight     # effective config at last boot
```

- `make logs` theo dõi log của backend và workspace.
- `make logs SERVICES=frontend` xem log của một dịch vụ (hoặc `postgres`, `proxy`, `langfuse-web`, …).
- `make logs SERVICES=` xem log của toàn bộ hệ thống.
- Lệnh `grep preflight` cho biết cấu hình đang có hiệu lực ở lần khởi động gần nhất.

## Khởi động lại sau khi sửa .env

Container chỉ đọc `.env` khi được **tạo**. `docker compose restart` dùng lại container cũ nên vẫn giữ các giá trị **cũ**. Hãy dùng một trong các lệnh sau:

| Thay đổi | Chạy |
|---|---|
| bất kỳ biến nào của backend/workspace (model, API key, tunable) | `make up` (tạo lại những gì đã đổi) hoặc `make restart` (buộc tạo lại backend + workspace) |
| `VITE_SERVICE_MODE` | `make up` (build lại image frontend) |
| cổng, `COMPOSE_FILE` | `make up` |
| `ADMIN_*` | không có tác dụng khi đã có tài khoản quản trị |
| `POSTGRES_PASSWORD` | không đổi khi volume đã tồn tại |

## Đổi model

```bash
# in .env
AGENT_MODEL=<provider>/<model-id>
COMPACTION_MODEL=<provider>/<model-id>

make up                                           # recreates the backend
docker compose logs backend | grep "preflight model"
```

Sửa hai dòng trên trong `.env`, chạy `make up` để tạo lại backend, rồi xác nhận model mới qua dòng `preflight model` trong log. Không cần sửa source code.

## Chạy test

Test chạy trong một Compose project riêng (`contoso-test`) với cơ sở dữ liệu riêng, nên không bao giờ đụng tới dữ liệu của môi trường phát triển.

```bash
make test                 # backend + workspace + frontend
make test-backend         # backend pytest (FakeModel, no API key)
make test-workspace       # execd tests
make test-frontend        # Vitest
make lint                 # ruff + eslint
# focused backend tests:
docker compose -f docker-compose.yml -f compose.test.yaml run --rm --build backend \
  pytest -q backend/tests/unit backend/tests/harness/test_runner.py
make test-live            # opt-in live OpenRouter contract tests (uses credits)
make e2e                  # Playwright against a fresh fake-mode stack
```

- `make test` chạy toàn bộ test backend, workspace và frontend. `make test-backend` dùng FakeModel nên không cần API key.
- Lệnh `docker compose … pytest -q …` chạy một nhóm test backend cụ thể.
- `make test-live` là test hợp đồng với OpenRouter thật, chỉ chạy khi chủ động gọi, và **tốn credit**.
- `make e2e` chạy Playwright trên một stack mới ở chế độ fake.

## Xử lý sự cố

| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| `check: no .env yet` | chưa chạy setup | `make setup` |
| `platform: missing required keys: …` | các biến bắt buộc còn trống | điền vào `.env`, rồi `make check` |
| `X is set but not used; use …` | ví dụ `OPENAI_API_KEY`, `DOCKER_HOST` nằm trong `.env` | dùng `OPENROUTER_*`; đặt `DOCKER_HOST` trong shell, không đặt trong `.env` |
| lỗi chat `model_authentication_failed` / HTTP 402 | key sai hoặc hết credit | sửa `OPENROUTER_API_KEY` / nạp credit, rồi `make up` |
| WARNING lúc khởi động "not in the provider's model list", lỗi chat `model_request_rejected` | model ID sai | sửa `AGENT_MODEL` / `COMPACTION_MODEL`, rồi `make up` |
| `MODEL_PROTOCOL_ERROR`, "does not advertise tool calling" | model không hỗ trợ tool calling | chọn model có hỗ trợ tool calling |
| backend `unhealthy`, log báo lỗi kết nối DB | DB chưa sẵn sàng, hoặc `POSTGRES_PASSWORD` bị đổi sau khi đã tạo volume | `make ps`; khôi phục mật khẩu ban đầu |
| `port is already allocated` | cổng 8080 / 8000 / 3100 đã bị chiếm | đặt `PROXY_PORT` / `APP_PORT` / `LANGFUSE_PORT` (+ `LANGFUSE_PUBLIC_URL`), rồi `make up` |
| DBeaver không kết nối được | cổng chưa được mở | xem mục [DBeaver](#dbeaver) |
| giá trị mới không có tác dụng | container chưa được tạo lại | `make up` hoặc `make restart`, không dùng `docker compose restart` |
| giao diện hiện dữ liệu giả / không gọi backend | frontend được build với `VITE_SERVICE_MODE=mock` | để trống biến này (`hybrid`), rồi `make up` |
| `domain <id>: unavailable` | thiếu thông tin xác thực warehouse | điền `domains/<id>/credentials/*.env`, rồi `make up`. Phần còn lại của ứng dụng vẫn chạy; chỉ người dùng của domain đó không chạy được task |
| `permission denied … docker.sock` | user chưa thuộc nhóm `docker` | `sudo usermod -aG docker $USER`, rồi đăng nhập lại |
| người dùng mới không đăng nhập được | người dùng vẫn đang `provisioning` hoặc `failed` | chờ, hoặc thử lại từ danh sách người dùng trong trang quản trị |
| người dùng `failed` kèm "network timeout" hoặc `uv add … exited -9` | tải gói từ PyPI ở lần provisioning đầu tiên quá chậm | kiểm tra mạng; chạy `make warm-cache`; tăng `UV_HTTP_TIMEOUT` / `AGENT_PACKAGE_INSTALL_TIMEOUT_S`, rồi `make up`; thử lại từ danh sách người dùng trong trang quản trị |
| người dùng `failed` kèm "provisioning interrupted by restart; retry" | backend khởi động lại khi đang provisioning | thử lại từ danh sách người dùng trong trang quản trị (agent đã tạo được giữ lại) |
| agent cứ hiện "đang làm việc…" | provider chậm hoặc hết credit; lượt xử lý sẽ báo lỗi rõ ràng sau `MODEL_TIMEOUT_S` | `make logs`; xem trace trong admin console |
| backend thoát khi khởi động với lỗi Alembic | DB có revision mới hơn code (ví dụ sau khi đổi branch) | checkout đúng phiên bản code; `SELECT version_num FROM alembic_version` |

## Lệnh hữu ích

```bash
make help        # every target
make setup | check | up | down | restart | ps | health | logs | seed-demo | psql
make warm-cache | warm-cache-status | demo-ready   # optional cache warm-up / demo preparation
make reset-dev   # DESTRUCTIVE: deletes all contoso volumes (asks you to type "delete")
```

`make help` liệt kê mọi target. **Cảnh báo:** `make reset-dev` (giống `docker compose down -v`) **xóa toàn bộ volume** của stack `contoso`: database PostgreSQL (người dùng, chat), thư mục agent, **cache uv dùng chung** (người dùng sau phải tải lại mọi gói), tệp đính kèm, báo cáo và dữ liệu Langfuse. Lệnh sẽ yêu cầu bạn gõ `delete` để xác nhận. Muốn khởi động lại mà giữ dữ liệu: `make down` rồi `make up`.

## Cấu trúc dự án

| Đường dẫn | Nội dung |
|---|---|
| `backend/` | FastAPI API, agent harness, messaging, model DB và migration Alembic |
| `workspace/` | dịch vụ sandbox `execd` và thư viện `contoso` mà agent import |
| `frontend/` | React SPA (Vite) |
| `agents/` | thành viên uv workspace cho phần Python phía agent (hiện mới có `pyproject.toml`) |
| `platform/` | quy tắc, prompt và seed của nền tảng, được mount vào backend |
| `domains/<id>/` | cấu hình, starter và template thông tin xác thực của từng domain |
| `infra/` | Dockerfile, Caddyfile |
| `deploy/` | compose của Langfuse, script khởi tạo PostgreSQL |
| `docs/` | tài liệu thiết kế; [docs/16](docs/16-configuration-and-deployment.md) nói về cấu hình và triển khai |
| `e2e/`, `eval/` | kịch bản Playwright, đánh giá agent |

## An toàn khi phát triển

- **Không bao giờ commit** `.env` hay `domains/*/credentials/*.env` (cả hai đều đã nằm trong git-ignore), và không bao giờ dán nội dung của chúng vào chat hay issue. Không commit bất kỳ secret nào.
- `make down` giữ nguyên mọi dữ liệu. Chỉ `make reset-dev` (hoặc `docker compose down -v`) mới **xóa volume**: người dùng, chat, thư mục agent, cache uv dùng chung, tệp đính kèm, báo cáo và dữ liệu Langfuse. Khởi động lại bình thường: `make down` rồi `make up`.
- Khi chạy sau HTTPS (production), đặt `COOKIE_SECURE=1`. Giữ mọi cổng được mở trên `127.0.0.1` và đặt proxy ở phía trước.
- Chi tiết hơn: [GUIDE.md](GUIDE.md) ([tiếng Việt](GUIDE.vi.md)), [docs/16](docs/16-configuration-and-deployment.md).
