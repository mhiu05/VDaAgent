# 04 · Thư mục agent

Những gì agent biết và có thể thay đổi đều nằm trong file. **Phụ thuộc:** [01](01-glossary.md), [11](11-sandbox.md), [12](12-auth-and-domains.md).

## Cấu trúc

```text
/data/folders/<user_id>/<slug>/
  .git/                       mỗi thư mục agent là một repo
  .gitignore                  .venv/  .contoso/outputs/  .env.d/
  .env.d/<set>.env  ->  /domains/<domain>/credentials/<set>.env    (mỗi bộ credentials được gắn là một symlink)
  pyproject.toml, uv.lock     dự án Python; agent và builder có thể thêm/gỡ package
  .venv/                      tạo bởi `uv sync`
  prompts/system.md           vai trò và sở thích (sửa ở tab "Vai trò" của builder)
  prompts/context.md          context lâu dài do agent tự duy trì
  memory/index.md             mục lục trí nhớ; được render vào system prompt
  memory/*.md                 ghi chú, đọc khi cần
  skills/<name>/SKILL.md      kỹ năng (được cài hoặc do agent tự viết)
  helpers/*.py                import được dưới dạng `helpers.<module>` (cwd nằm trong sys.path)
  routines/<name>.yaml        {prompt, cron, enabled}
  files/                      vùng nháp và output được tạo (biểu đồ, báo cáo)
  files/inbox/m_<message_id>/ bản sao các file gửi cho agent này (từ người dùng hoặc agent khác)
  .contoso/outputs/<exec_id>.txt  output đã offload (chỉ `api` ghi)
```

| Phần | Agent sửa | Người dùng sửa (builder) | Được đọc khi |
|---|---|---|---|
| `.env.d/` | Không (quy tắc trong prompt; mount chỉ đọc) | Gắn/gỡ bộ | mỗi exec |
| `pyproject.toml`, `uv.lock` | Có (`uv add`/`uv remove`) | Có (tab Thư viện) | mỗi exec |
| `prompts/system.md`, `prompts/context.md`, `memory/index.md` | Có | `system.md` | chỉ khi mở epoch mới |
| `memory/*.md`, `skills/`, `helpers/` | Có | kỹ năng (tab Kỹ năng) | khi cần, nên thay đổi có hiệu lực ngay |
| `routines/*.yaml` | Có | Có (tab Lịch) | mỗi khi chủ sở hữu chuyển sang rảnh |
| `files/` | Có | chỉ xem (trình xem) | khi cần |

Agent *dùng* thư mục (chạy helper, đọc trí nhớ và kỹ năng) và *thay đổi* nó (thêm helper, cập nhật trí nhớ, viết kỹ năng và lịch chạy). Người dùng thay đổi cùng các file đó qua builder. Mọi thay đổi đều thành một git commit, nên lịch sử cho thấy ai đã đổi gì.

## Khung nền tảng

Mọi thư mục agent bắt đầu là một bản sao của `platform/agent-skeleton/`:

```text
platform/agent-skeleton/
  .gitignore            .venv/  .contoso/outputs/  .env.d/  __pycache__/
  pyproject.toml        [project] name="agent", version="0.1.0", requires-python=">=3.12", dependencies=[]; [tool.uv] package=false
  prompts/system.md     (rỗng; được thay bằng prompt của agent mẫu, lead hoặc agent tự tạo)
  prompts/context.md    "# Context\n"
  memory/index.md       "# Memory\n\n(no notes yet)\n"
  skills/.keep  helpers/.keep  routines/.keep  files/.keep
```

## Tạo agent

`agents/folders.create(user, slug, prompt, presets, credential_sets, author)` chạy các bước sau trong một job của builder:

1. Kiểm tra `slug` theo `^[a-z0-9][a-z0-9-]{1,31}$`, kiểm tra slug chưa có ở người dùng này, và kiểm tra `MAX_AGENTS_PER_USER`.
2. Sao chép `platform/agent-skeleton/` sang `/data/folders/<user_id>/<slug>/`.
3. Ghi `prompts/system.md` từ prompt được truyền vào.
4. Với mỗi bộ credentials, tạo symlink `.env.d/<set>.env` → `/domains/<domain>/credentials/<set>.env`. Bộ đó phải có trong miền của người dùng.
5. Chạy `git init -b main`, rồi commit toàn bộ với tác giả `contoso-harness`, message `create <slug>`.
6. Chạy system exec `uv sync`, rồi `uv add <packages>` một lần cho mỗi preset ([05](05-agent-builder.md#thư-viện)). Mỗi lần chạy để lại một snapshot.
7. Ghi dòng `agents` (`state='active'`, `baseline_commit` = HEAD lúc này), epoch 0 ([06](06-context-and-compaction.md)) và hội thoại trực tiếp. Khởi động runner.

Nếu một bước lỗi, job bị đánh dấu `failed` và thư mục dở dang được chuyển sang `/data/folders/.trash/<user_id>-<slug>-<ts>/`. Dòng `agents` chỉ được ghi ở bước cuối, nên không để lại gì dở dang.

| Nguồn gốc | Prompt | Preset | Bộ credentials |
|---|---|---|---|
| `lead` | `domains/<d>/starters/lead/prompt.md` nếu có, nếu không thì `platform/lead/prompt.md` | không | không |
| `starter` | `starters/<slug>/prompt.md` | theo `agent.yaml` | theo `agent.yaml` |
| `custom` | nội dung nhập trong builder (có thể rỗng) | chọn trong hộp thoại tạo | chọn trong hộp thoại tạo |

Khi được tạo tài khoản, người dùng nhận lead cộng mọi agent mẫu của miền ([12](12-auth-and-domains.md#cấp-phát-người-dùng)).

## Khôi phục ("Khôi phục bản gốc")

1. Lấy job lock. Từ chối với 409 nếu agent đang tham gia task đang chạy.
2. `git restore --source=<baseline_commit> --staged --worktree :/`. Lệnh này cũng xoá những file được theo dõi mà baseline không có. Rồi `git clean -fd -e .venv -e .env.d -e .contoso` xoá các file không được theo dõi. Agent lead hoặc starter sau đó nhận `prompts/system.md` từ template hiện tại của miền (prompt lead hoặc starter), để bản sửa template tới được cả agent tạo trước đó; agent tự tạo giữ prompt của nó. Commit với tác giả `contoso-harness`, message `reset`.
3. `.env.d/` bị git bỏ qua, nên khôi phục để nguyên. Liên kết credentials là lựa chọn trong builder, không phải thứ agent học được.
4. Chạy `uv sync`.
5. Mở epoch mới với lý do `reset` và tóm tắt rỗng. Các delivery đang chờ được giữ lại.
6. Dựng lại `routine_state` từ `routines/`.

`baseline_commit` là thư mục đúng như khi job tạo agent để lại, kể cả preset, nên khôi phục hoạt động giống nhau với mọi nguồn gốc.

## Xoá

- Không xoá được lead. Agent khác xoá được, trừ khi nó đang tham gia task đang chạy (409).
- Xoá sẽ dừng runner và đặt `agents.state='deleted'`. Hội thoại trực tiếp chuyển sang chỉ đọc, và agent bị bỏ khỏi các nhóm và khỏi danh sách nhóm trong `current_state`.
- Thư mục vẫn giữ trên đĩa, nên chế độ xem trace của admin vẫn hoạt động.

## Snapshot git

Mỗi exec để lại bản ghi trạng thái thư mục mà nó tạo ra ([quyết định 0012](decisions/0012-git-snapshot-per-exec.md)). `execd` chụp snapshot sau khi toàn bộ nhóm tiến trình của exec đã thoát:

1. `git add -A`
2. `git diff --cached --quiet`. Mã thoát 0 nghĩa là không có gì thay đổi; 1 là có thay đổi.
3. Nếu có thay đổi: `git -c user.name=<author> -c user.email=<author>@contoso.local commit -q -m "exec <exec_id>"`.
4. `head = git rev-parse HEAD`
5. `changed = git diff --name-status <old_head> <head>`. Rỗng khi không có gì thay đổi.

| Trường hợp | `head` | `changed` |
|---|---|---|
| Có file thay đổi | commit mới | danh sách `{path, status}` (`A`, `M`, `D`, `R`) |
| Không có gì thay đổi | HEAD trước đó | `[]` |
| Snapshot lỗi (vd `index.lock` cũ) | `null`, kèm `snapshot_error` | `null` |

- **Snapshot lỗi không bao giờ làm exec lỗi.** Kết quả vẫn tới model, và chế độ xem trace hiện cảnh báo. Snapshot thành công kế tiếp gom luôn các thay đổi bị sót.
- **Tác giả.** Exec của chính agent commit dưới tên `agent:<slug>`. System exec commit dưới tên tác giả do `api` truyền: `user:<username>` cho thao tác builder, `contoso-harness` cho tạo, khôi phục và notice có sao chép file.
- **Commit do chính `api` tạo** (ghi file từ builder như prompt hay lịch chạy, sao chép inbox) dùng cùng quy tắc tác giả, dưới cùng job lock.

## Trình xem thư mục

Trình xem chỉ đọc. Người dùng mở được thư mục agent của chính mình; admin mở được mọi thư mục. `api` đọc volume trực tiếp.

| Endpoint | Trả về |
|---|---|
| `GET /api/agents/{id}/tree?path=&at=` | Một cấp thư mục: `[{name, type, size, mtime, items, symlink_target}]`, trong đó `type` là `file`, `dir` hoặc `symlink`. Với thư mục, `items` và `size` được tính lúc liệt kê |
| `GET /api/agents/{id}/file?path=&at=` | Text tối đa 1 MB dạng `text/plain; charset=utf-8`, ảnh dạng byte gốc, file khác dạng `Content-Disposition: attachment` |
| `GET /api/agents/{id}/archive?path=&at=` | File `.zip` của một thư mục hoặc cả thư mục agent. Luôn bỏ `.venv/` |
| `GET /api/agents/{id}/log?path=&limit=` | Các commit chạm vào một đường dẫn: `[{commit, author, message, at, exec_id}]` |
| `GET /api/agents/{id}/diff?commit=` | Unified diff của một commit (file nhị phân chỉ liệt kê tên) |

Quy tắc:
- **An toàn đường dẫn.** Mọi đường dẫn được phân giải bên trong thư mục; `..`, đường dẫn tuyệt đối và symlink trỏ ra ngoài bị từ chối (400). Symlink được liệt kê nhưng không đi theo, trừ trường hợp ngay dưới đây.
- **`.env.d/*.env` chỉ hiện tên key**, giá trị bị che (`WAREHOUSE_DSN=••••`), với mọi vai trò, kể cả admin. File nén chứa cùng nội dung đã che. Chỉ hiện các dòng `KEY=••••`: bỏ chú thích và giá trị. Link hỏng hiện rỗng.
- **`.venv/`** hiện thành một mục thu gọn (`items` và `size` là `null`) và không mở được (400 `not_expandable`). **`.contoso/outputs/`** duyệt được. `.git/` không bao giờ được liệt kê hay đọc.
- **Lỗi.** 400 `invalid_path` cho đường dẫn không an toàn, `not_a_directory` / `not_a_file` khi sai loại, `invalid_commit` khi `at` hoặc `commit` không phải mã hex 7–40 ký tự; 404 `not_found` khi không có đường dẫn hoặc commit. File nén bỏ qua các link trỏ ra ngoài thư mục hoặc link hỏng.
- **`at=<commit>`** đọc từ git (`git show <commit>:<path>`, `git ls-tree`) thay vì cây làm việc. `.contoso/outputs/` không có ở commit cũ, vì git bỏ qua nó.
- **Hiển thị trong UI.** Markdown được render; `.py`, `.yaml`, `.toml` và `.json` được tô màu cú pháp; CSV hiện bảng xem trước 200 dòng; ảnh hiện ngay.

## Tự cải thiện

Agent cải thiện bằng cách sửa chính thư mục của mình, trong lúc làm việc hoặc trong lúc compaction:

- File đọc khi cần (helper, kỹ năng, ghi chú trí nhớ) có hiệu lực ngay.
- System prompt (`prompts/system.md`, `prompts/context.md`, `memory/index.md`, danh sách kỹ năng) chỉ được render lại khi mở epoch mới. Điều đó giữ context chỉ nối thêm trong lúc task chạy ([quyết định 0005](decisions/0005-append-only-context-during-a-task.md)).
- `platform/rules.md` chỉ cho agent nơi cất từng thứ: sở thích ở `memory/preferences.md`, quy trình thành kỹ năng, code tái sử dụng ở `helpers/`, và sự thật lâu dài ở `prompts/context.md`.
