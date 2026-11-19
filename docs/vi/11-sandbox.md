# 11 · Sandbox: `workspace`, `execd`, `contoso`

Code của agent chạy ở đâu và thế nào. **Phụ thuộc:** [02](02-architecture.md), [04](04-agent-folder.md).

## Mức cô lập (PoC)

Mọi thư mục agent của mọi người dùng nằm trong một container, `workspace`. Code từ agent A chạy trong container đó với `cwd` là thư mục của A ([quyết định 0007](decisions/0007-shared-workspace-container-for-agent-code.md)).

| Ranh giới | PoC | Cưỡng chế bởi |
|---|---|---|
| Code agent không tới được DB ứng dụng hay Langfuse | có | `workspace` chỉ nằm trên mạng `exec` |
| Code agent không sửa được credentials của miền | có | `/domains` mount chỉ đọc |
| Agent chỉ nhận các bộ credential được gắn cho mình | có; giá trị được ghi vào `.env.d/` riêng và nạp vào biến môi trường. Agent đọc được bản sao của mình; trình xem thư mục che giá trị | backend giải mã credential từ DB; Landlock chặn thư mục của agent khác và `/domains` |
| Agent A không liệt kê, đọc hay ghi được thư mục của agent B hay của người dùng khác (đường dẫn tuyệt đối, `..`, symlink) | có, khi kernel có Landlock (`GET /health` → `fs_isolation`) | Landlock, theo từng exec (xem bên dưới) |
| Giới hạn CPU, bộ nhớ và thời gian cho mỗi exec | có | rlimit + giết theo thời gian thực |
| Mạng ra ngoài | mở | cần cho kho dữ liệu, GitHub, PyPI |

### Sandbox hệ thống tệp (Landlock)

Thư mục của mọi người dùng dùng chung một volume và một uid, nên quyền tệp không tách được họ. Mỗi tiến trình exec tự giới hạn mình bằng Landlock sau fork, trước khi chạy code (`workspace/execd/landlock.py`); tiến trình con thừa hưởng giới hạn, còn execd thì không bị giới hạn.

| Đường dẫn | Quyền |
|---|---|
| thư mục của chính agent, `UV_CACHE_DIR`, `/tmp`, `/dev/shm` | đọc, ghi, thực thi |
| `/usr`, `/lib*`, `/bin`, `/sbin`, `/etc`, `/opt`, `/proc`, `/sys`, `/var/cache` | đọc, thực thi |
| `/dev` | đọc và ghi tệp thiết bị |
| mọi thứ khác — thư mục gốc folders, thư mục của agent và người dùng khác, `/domains` | bị từ chối |

`EXEC_FS_ISOLATION` trên backend và workspace: `auto` (mặc định; áp dụng với Landlock ABI ≥ 2, Linux ≥ 5.19), `required` (exec thất bại thay vì chạy không sandbox) hoặc `off`. `GET /health` báo `fs_isolation`. Chưa bao phủ: cache uv dùng chung và ghi được; mạng ra ngoài vẫn mở; agent có thể đoán tên thư mục khác (`stat` không bị chặn) nhưng không liệt kê, đọc hay ghi được.

Snapshot Git và thao tác thư mục từ backend dùng `workspace/execd/git_sandbox.py`: tắt hook/fsmonitor, bỏ cấu hình Git global/system, và áp dụng cùng ranh giới Landlock cho Git lẫn tiến trình con. Mỗi lệnh có timeout 30 giây và dọn cả nhóm tiến trình khi kết thúc.

Cách khắc phục các dòng chưa cưỡng chế nằm ở [99](99-risks-and-future-work.md#chỗ-làm-tắt-của-poc-và-việc-sau-này).

## Image

`workspace/Dockerfile`:
- `python:3.12-slim-bookworm` với `git`, `uv` (chép từ `ghcr.io/astral-sh/uv`), `tini`, `fonts-noto-core` (để biểu đồ hiện chữ tiếng Việt), `libpq5`.
- Package `contoso` nằm ở `/opt/contoso` (chỉ thư viện chuẩn, có trong `PYTHONPATH`). `execd` nằm ở `/opt/execd`, có venv riêng cho FastAPI và uvicorn.
- **Làm nóng cache uv (tùy chọn).** Image không cài gói preset nào, nên `make up` vẫn nhẹ. Cache dùng chung `UV_CACHE_DIR=/data/folders/.uv-cache` nằm trên volume `folders`, cùng filesystem với mọi venv (uv hardlink thay vì sao chép). Provisioning nạp vào cache những gì mỗi agent cần, agent sau dùng lại. `make warm-cache` (`workspace/prewarm.py warm` trong một container workspace chạy một lần) nạp trước mọi gói của `platform/seeds/library_presets.yaml` và `domains/*/seeds/library_presets.yaml`: khóa bằng `--generate-hashes` và cài bằng `--require-hashes`, vì thư mục agent là uv project, `uv add`/`uv sync` chỉ dùng lại wheel trong cache khi sha256 của nó đã được ghi lại. `make warm-cache-status` báo dung lượng cache và đã có đủ preset hay chưa. Cài gói trong thư mục agent dùng `AGENT_PACKAGE_INSTALL_TIMEOUT_S` (mặc định 1200 s) thay cho giới hạn 600 s của system exec.
- **Tiến trình.** Chạy bằng user không phải root `agent` (uid 1000) với `tini -- uvicorn execd.app:app --host 0.0.0.0 --port 7000`.
- **Biến môi trường.** `UV_CACHE_DIR=/data/folders/.uv-cache`, `UV_LINK_MODE=hardlink` (các venv dùng chung file trong cache, nên 50 venv vẫn rẻ), `UV_PYTHON_DOWNLOADS=never`. Các lần build sau không làm mới cache trong volume đã có; package preset mới sẽ được tải ở lần dùng đầu.

## API của `execd`

Mọi request trừ `GET /health` cần header `Authorization: Bearer $EXECD_TOKEN`.

### `POST /exec`

```jsonc
// request
{"folder": "/data/folders/<user_id>/<slug>", "exec_id": "x_01J…",
 "code": "print(1)",              // exec của agent; hoặc:
 "argv": ["uv", "add", "pandas"], // system exec (đúng một trong code/argv)
 "timeout_s": 120, "author": "agent:data", "env_extra": {"CONTOSO_API_URL": "...", "CONTOSO_EXEC_TOKEN": "...", "CONTOSO_DEFAULT_THREAD": "direct:data"}}
// response
{"exit_code": 0, "stdout": "...", "stderr": "...", "duration_ms": 1400, "timed_out": false, "truncated": false,
 "head": "3f2c…", "changed": [{"path": "...", "status": "M"}], "snapshot_error": null}
```

Một request chạy thế nào:
1. **Kiểm tra thư mục.** Đường dẫn thật của `folder` (đã phân giải symlink) phải nằm hẳn bên trong `/data/folders/` và có `.git`; nếu không thì 400 `invalid_folder`. Body thiếu hoặc có cả `code` lẫn `argv` là 400 `invalid_request`; thiếu hoặc sai token là 401 `unauthenticated`. Lỗi dùng dạng `{error, message}` của doc 15.
2. **Lệnh.** `code` chạy dạng `[<folder>/.venv/bin/python, -c, code]`, hoặc `[python3, -c, code]` nếu chưa có `.venv`. `argv` chạy đúng như truyền vào, với `PATH` là `<folder>/.venv/bin:/usr/local/bin:/usr/bin:/bin`.
3. **Biến môi trường**, dựng từ đầu. Không bao giờ kế thừa môi trường của tiến trình cha:
   - `PATH`, `HOME=<folder>`, `LANG=C.UTF-8`, `TZ=Asia/Ho_Chi_Minh`, `PYTHONPATH=/opt` (cho `contoso`; `python -c` đã đặt cwd lên đầu `sys.path`, nên import `helpers.*` vẫn được), `PYTHONUNBUFFERED=1`, `UV_CACHE_DIR`, `UV_LINK_MODE`;
   - rồi mọi `KEY=VALUE` từ `<folder>/.env.d/*.env` theo thứ tự tên, parse theo ngữ nghĩa `python-dotenv` (không nội suy; file sau thắng khi trùng khóa, link hỏng thì bỏ qua);
   - rồi `env_extra`.
4. **Tiến trình.** `subprocess.Popen(..., cwd=folder, start_new_session=True)`. `preexec_fn` đặt `RLIMIT_AS = EXEC_MEM_MB` (mặc định 2048) và `RLIMIT_FSIZE = 1 GB`. Không có `RLIMIT_NPROC`: nó sẽ đếm mọi tiến trình của uid dùng chung. Thay vào đó, `pids_limit: 4096` của container trong compose chặn việc fork mất kiểm soát.
5. **Output.** `stdout` và `stderr` được đọc đồng thời, mỗi luồng giới hạn `EXEC_MAX_OUTPUT_BYTES` (10 MB). Phần vượt bị bỏ, `truncated=true` được đặt, và dấu `\n[... truncated by execd at 10 MB]` được nối thêm.
6. **Thời gian thực.** Khi tới `timeout_s`, cả nhóm tiến trình nhận `os.killpg(pgid, SIGKILL)`, và `timed_out=true`. Khi tiến trình chính thoát bình thường, nhóm tiến trình cũng bị giết, nên không tiến trình nền nào sống lâu hơn exec.
7. **Snapshot** ([04](04-agent-folder.md#snapshot-git)) với `author`.

Các lời gọi cho cùng một thư mục không bao giờ chồng nhau, vì `api` giữ job lock của agent. `execd` còn giữ một `asyncio.Lock` riêng cho mỗi thư mục làm lớp bảo vệ thứ hai.

### `GET /health`

Không cần xác thực. Trả `{"ok": true}`. Healthcheck của compose dùng endpoint này, và `/api/health` của `api` cũng gọi nó.

## Exec token

```text
token   = "v1." + agent_id + "." + exec_id + "." + exp + "." + b64url(HMAC_SHA256(SESSION_SECRET, "v1|agent_id|exec_id|exp"))
exp     = now + timeout_s + 10 (giây unix)
```

`api:8001` chỉ chấp nhận token khi đủ cả ba điều kiện:
- chữ ký hợp lệ;
- `exp` chưa qua;
- `running_exec[agent_id] == exec_id`, hoặc exec đó kết thúc chưa quá 5 s.

Vì vậy helper không thể hành động thay agent khác, hay sau khi exec của nó đã xong. `final=True` được ghi theo `exec_id` và áp dụng khi exec trả về.

## Thư viện helper `contoso`

`/opt/contoso/__init__.py` chỉ dùng thư viện chuẩn (`urllib.request`, `json`). Nó đọc `CONTOSO_API_URL` và `CONTOSO_EXEC_TOKEN` từ môi trường và gửi JSON tới `/internal/v1/<helper>`. Khi response không phải 2xx, nó raise `contoso.ContosoError(code, message)`, để model thấy lý do trong stderr. Mã 400, 404 hoặc 422 raise lớp con `ContosoValueError` (cũng là `ValueError`, như doc 08 hứa với tham số sai), còn 409 raise `ContosoConflictError` (cũng là `RuntimeError`, ví dụ khi đang nén ngữ cảnh). Gọi ngoài một exec (không có `CONTOSO_API_URL`/`CONTOSO_EXEC_TOKEN`) thì helper raise `ContosoError('not_in_exec', …)`. `send_to_user` lấy `thread` từ `CONTOSO_DEFAULT_THREAD` khi không truyền; `send_to_agent` thì không.

| Helper | Endpoint internal | Trả về |
|---|---|---|
| `send_to_user(text=None, *, files=(), choices=None, reports=(), thread=None, reply_to=None, final=False)` | `POST /internal/v1/send_to_user` | id tin nhắn |
| `send_to_agent(receivers, content, *, files=(), thread=None, reply_to=None)` | `POST /internal/v1/send_to_agent` | id tin nhắn |
| `end_task(outcome, status="done")` | `POST /internal/v1/end_task` | id task |
| `queue_task(description)` | `POST /internal/v1/queue_task` | id task |
| `write_summary(text)` | `POST /internal/v1/write_summary` | `None` |
| `start_report(title, type, *, projects=(), markets=(), report_id=None)` | `POST /internal/v1/reports/start` | `{"report_id", "attempt_id"}` |
| `publish_report(attempt_id, schema_path, *, artifacts=(), evidence=(), source=None)` | `POST /internal/v1/reports/publish` | id phiên bản |
| `fail_report(attempt_id, reason)` | `POST /internal/v1/reports/fail` | `None` |
| `publish_dataset(kind, path)` | `POST /internal/v1/datasets/publish` | id dataset |

Ngữ nghĩa của các helper nhắn tin nằm ở [08](08-communication.md); các helper báo cáo và dataset nằm ở [19](19-reports-dashboard-notifications.md). `api` đọc `files`, `schema_path`, `artifacts` và `path` từ volume `folders` dùng chung.

`contoso.skills` (trình cài kỹ năng) nằm trong cùng package ([05](05-agent-builder.md#trình-cài-contososkills)).

## Giới hạn

| Key | Mặc định |
|---|---|
| `EXEC_TIMEOUT_S` | 120 (system exec: 600) |
| `EXEC_MEM_MB` | 2048 |
| `EXEC_MAX_OUTPUT_BYTES` | 10,485,760 |
| Kích thước / số tệp đính kèm | 20 MB / 10 mỗi tin |
