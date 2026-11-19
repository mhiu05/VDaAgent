# Chạy VDaAgent

[English](GUIDE.md)

Ba bước, mỗi bước một lệnh:

```text
1. make setup     tạo .env và các file credentials, liệt kê những gì bạn cần điền
2. (sửa file)     rồi chạy make check, đến khi không còn key nào thiếu
3. make up        khởi động mọi thứ, tạo người dùng demo, in các URL
```

## Yêu cầu

| Cần                                                              | Ghi chú                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker có Compose **v2.20 trở lên** và **buildx** | macOS/Windows: Docker Desktop (có sẵn cả hai). Linux: Docker Engine + gói `docker-compose-plugin` và `docker-buildx-plugin`. macOS chỉ có CLI `docker` từ Homebrew: `brew install docker-buildx`, rồi `ln -sfn "$(brew --prefix)/opt/docker-buildx/bin/docker-buildx" ~/.docker/cli-plugins/docker-buildx` |
| `make`, `git`                                                 | macOS: `xcode-select --install`. Windows: chạy mọi thứ trong WSL 2 (Ubuntu), bật WSL integration của Docker Desktop                                                                                                                                                                                                    |
| ~6 GB RAM cho Docker                                              | stack dùng khoảng 3,7 GB khi rảnh (chủ yếu là Langfuse và ClickHouse). Trên Docker Desktop, tăng giới hạn bộ nhớ nếu đang thấp hơn                                                                                                                                                                           |
| ~10 GB ổ đĩa trống                                            | khoảng 2 GB image, cộng build cache và volume dữ liệu                                                                                                                                                                                                                                                                    |

Không cần cài Python, Node hay uv trên máy: mọi công cụ đều chạy trong container.

## 1. Setup

```bash
git clone <repo-url> VDaAgent && cd VDaAgent
make setup
```

`make setup` kiểm tra Docker, Compose và buildx hoạt động, rồi:

- tạo `.env` từ `.env.example` và điền mọi secret nội bộ (database, session, Langfuse…) bằng giá trị ngẫu nhiên;
- tạo từng `domains/<id>/credentials/<set>.env` từ `.env.example` tương ứng;
- in ra những gì bạn còn phải điền.

Lệnh không bao giờ ghi đè giá trị hay file đã có, nên chạy lại lúc nào cũng được. Ví dụ kết quả trên một bản clone mới:

```text
created .env from .env.example
filled generated keys: POSTGRES_PASSWORD, SESSION_SECRET, EXECD_TOKEN, …
created domains/fabrikam/credentials/warehouse.env
created domains/fabrikam/credentials/web-search.env

still to fill in:
  .env: OPENROUTER_API_KEY, ADMIN_USERNAME, ADMIN_PASSWORD
  domains/fabrikam/credentials/warehouse.env: WAREHOUSE_DSN, WAREHOUSE_SNAPSHOT_ID
  domains/fabrikam/credentials/web-search.env: TAVILY_API_KEY
optional: .env: DEMO_PASSWORD
next: fill these in, then run `make check` (see GUIDE.md)
```

## 2. Điền các file

Mở từng file mà `make setup` liệt kê và điền giá trị sau dấu `=`. Secret lấy từ người phụ trách dự án: hỏi riêng, không bao giờ hỏi trong nhóm chat chung hay issue.

| File                                               | Key                                          | Là gì                                                                               | Lấy ở đâu                                                                   |
| -------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `.env`                                           | `OPENROUTER_API_KEY`                       | key model duy nhất (mọi agent dùng chung)                                          | người phụ trách dự án                                                     |
| `.env`                                           | `ADMIN_USERNAME`, `ADMIN_PASSWORD`       | tài khoản admin của app; mật khẩu này cũng là mật khẩu Langfuse             | tự chọn (username: 3–32 ký tự trong `a-z`, `0-9`, `.`, `_`, `-`) |
| `.env`                                           | `DEMO_PASSWORD` (tùy chọn)               | mật khẩu của người dùng demo `alice` và `bob` (cùng miền fabrikam)    | tự chọn; để trống nếu không cần người dùng demo                      |
| `domains/fabrikam/credentials/warehouse.env`     | `WAREHOUSE_DSN`, `WAREHOUSE_SNAPSHOT_ID` | kết nối chỉ đọc tới kho dữ liệu fabrikam, và snapshot dùng để phân tích | người phụ trách dự án                                                     |
| `domains/fabrikam/credentials/web-search.env`    | `TAVILY_API_KEY`                           | tìm kiếm web cho tin tức thị trường                                             | người phụ trách dự án                                                     |

**Khuyến nghị: dùng model rẻ hơn.** Nếu thiếu các dòng này, agent dùng `anthropic/claude-haiku-4.5`, tốn hơn nhiều trên key dùng chung. Đặt trong `.env`:

```text
AGENT_MODEL=deepseek/deepseek-v4.1-flash
COMPACTION_MODEL=deepseek/deepseek-v4.1-flash
```

Để trống `JEV_MODEL`; giá trị mặc định là đúng.

Sau đó kiểm tra:

```bash
make check
```

Lần đầu sẽ build image backend (vài phút); các lần sau chỉ vài giây. Kết quả tốt:

```text
platform: ok
domain fabrikam: available
```

- `platform: missing required keys: …` → điền các key đó trong `.env`; `make check` và `make up` sẽ dừng cho đến khi bạn điền.
- `domain <id>: unavailable` kèm lý do → file credentials của miền đó còn thiếu key. Phần còn lại của app vẫn chạy; chỉ người dùng của miền đó không chạy được tác vụ.

## 3. Khởi động

```bash
make up
```

Lệnh chạy `make check`, build và khởi động mọi service (lần đầu mất vài phút), chờ đến khi tất cả healthy, tạo `alice` và `bob` nếu có `DEMO_PASSWORD`, rồi in:

```text
VDaAgent is up
  app       http://localhost:8080   (login: admin, alice, bob)
  api       http://127.0.0.1:8000/api/health
  langfuse  http://localhost:3100   (admin@contoso.local / ADMIN_PASSWORD)
  stop: make down    logs: make logs
```

Mở URL app và đăng nhập. Chạy lại `make up` luôn an toàn: sau khi `git pull`, lệnh build lại phần đã đổi và giữ nguyên người dùng đã có.

| Lệnh               | Làm gì                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `make down`        | dừng mọi thứ; dữ liệu (database, thư mục agent, cache uv dùng chung) được giữ lại                                    |
| `make demo-ready`  | tùy chọn, trước buổi demo hoặc khi onboarding nhiều người dùng: làm nóng cache uv, rồi `make up` và `make health`     |
| `make logs`        | theo dõi log của backend và workspace                                                                                |
| `make help`        | liệt kê mọi lệnh                                                                                                     |

Để khởi động lại, dùng `make down` rồi `make up`. **Đừng** chạy `docker compose down -v` hay `make reset-dev` nếu không thật sự muốn: chúng xóa mọi volume — database (người dùng, chat), thư mục agent, cache uv dùng chung (người dùng sau phải tải lại mọi gói), tệp đính kèm, báo cáo và dữ liệu Langfuse.

## Xử lý sự cố

**Cổng đã bị dùng.** Đặt cổng khác trong `.env`, rồi chạy lại `make up`:

- app (8080): `PROXY_PORT=8081`
- API (8000): `APP_PORT=8010` và `APP_URL=http://localhost:8010`

**`docker buildx is missing`** hoặc lỗi build nhắc tới `--mount`. Cài buildx (xem [Yêu cầu](#yêu-cầu)).

**Một miền bị `unavailable`.** Chạy `make check` để xem thiếu key nào, điền vào, rồi `make up`.

**Một tác vụ "đang chạy" mãi không xong.** Thường là key OpenRouter đã hết credit. Đăng nhập bằng admin và mở trace của agent đó trong trang quản trị: lỗi `model_unavailable` (thường kèm HTTP 402) xác nhận điều này. Báo cho người phụ trách dự án.

**Docker chạy trên máy khác.** Đừng trỏ laptop tới máy đó bằng `DOCKER_HOST=ssh://…`: Compose mount `./domains`, `./platform` và `./deploy` theo đường dẫn trên *laptop của bạn*, vốn không tồn tại trên server, nên stack khởi động mà không có miền nào. Hãy clone repo **trên server** và chạy ba bước ở đó, rồi mở tunnel từ laptop:

```bash
ssh -L 8080:127.0.0.1:8080 -L 8000:127.0.0.1:8000 -L 3100:127.0.0.1:3100 <user>@<server>
```

**Gọi API bằng tay bị 403 `csrf`.** Mọi request `/api` không phải GET đều cần header `X-Contoso-Client: web`.

## Quy tắc

- Không bao giờ commit `.env` hay `domains/*/credentials/*.env` (cả hai đã nằm trong git-ignore) và không dán nội dung của chúng vào chat hay issue.
- Chi tiết hơn: [docs/vi/16 Cấu hình và triển khai](docs/vi/16-configuration-and-deployment.md).
