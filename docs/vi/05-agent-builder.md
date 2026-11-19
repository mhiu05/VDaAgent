# 05 · Builder agent

Người dùng tạo và tuỳ biến agent thế nào mà không cần viết code. **Phụ thuộc:** [04](04-agent-folder.md), [06](06-context-and-compaction.md), [11](11-sandbox.md).

## Nguyên tắc

1. **Thư mục là nguồn sự thật duy nhất.** Builder đọc và ghi file trong thư mục: prompt, `skills/`, `pyproject.toml`, `routines/` và `.env.d/`. Không bảng DB nào sao chép những gì agent đã cài.
2. **Mọi thay đổi từ builder là một commit của `user:<username>`**, nên lịch sử tách được thay đổi của người dùng khỏi tự cải thiện của agent.
3. **Mọi thay đổi từ builder đều báo cho agent.** Một delivery notice mô tả thay đổi, để agent hành động ngay mà không làm hỏng prompt cache ([quyết định 0016](decisions/0016-builder-edits-notify-then-apply-at-a-safe-point.md)).
4. **Mỗi lúc chỉ một bên ghi.** Job của builder lấy job lock của agent, cùng khoá với các exec của chính agent. Lưu lúc agent đang giữa một exec sẽ chờ exec đó xong. UI hiện "Đang cài…" cho tới khi lưu xong. Job tạo agent khoá theo `(user_id, slug)`, vì agent chưa tồn tại.

## Các tab

| Tab | Người dùng làm gì | Ghi vào | Notice gửi agent |
|---|---|---|---|
| **Thông tin** | slug (chỉ khi tạo), tên hiển thị, avatar (emoji + màu), mô tả | dòng `agents` | không |
| **Vai trò** | sửa vai trò và sở thích dạng markdown | `prompts/system.md`, đồng thời compaction chuyển sang chờ | `Người dùng đã cập nhật vai trò của bạn:` kèm unified diff |
| **Kỹ năng** | duyệt kho, cài hoặc gỡ kỹ năng, cài từ link GitHub, xem mọi kỹ năng trong `skills/` | `skills/<name>/` | `Kỹ năng mới: <name> — đọc skills/<name>/SKILL.md` / `Đã gỡ kỹ năng: <name>` |
| **Thư viện** | áp dụng preset, thêm/gỡ từng package, xem package đã cài | `pyproject.toml`, `uv.lock`, `.venv/` | `Thư viện đã thay đổi: +pandas, +pyarrow` / `-seaborn` |
| **Lịch** | tạo, sửa, bật/tắt, xoá lịch chạy | `routines/<name>.yaml` | `Lịch "<name>" đã được tạo/cập nhật/xóa: <cron>` |
| **Dữ liệu** | gắn hoặc gỡ các bộ credentials của miền | symlink trong `.env.d/` | `Quyền dữ liệu thay đổi: +warehouse (WAREHOUSE_DSN, WAREHOUSE_SCHEMA)`. Chỉ tên key |
| **Thư mục** | duyệt thư mục và lịch sử ([04](04-agent-folder.md#trình-xem-thư-mục)) | — | — |

**Lead** có cùng các tab, với ba ngoại lệ: slug cố định, không xoá được, và `platform/rules.md` (chứa nhiệm vụ quản lý hàng đợi) không sửa được.

**Tạo agent** (`/agents/new`) hỏi slug, tên hiển thị, avatar và mô tả, rồi cho chọn **"Bắt đầu từ mẫu"** (sao chép một agent mẫu của miền với slug mới) hoặc **"Trống"** (prompt rỗng, cộng preset và bộ credentials chọn ngay trong hộp thoại). Nó chạy job tạo agent ở [04](04-agent-folder.md#tạo-agent).

## Sửa prompt

- **Lưu** sẽ ghi `prompts/system.md`, commit, và nối notice chứa diff. Đồng thời compaction chuyển sang chờ.
- Hành vi của agent đổi ngay khi nó đọc notice. Ở điểm an toàn kế tiếp, compaction mở epoch mới, và system prompt được render lại với vai trò mới ([06](06-context-and-compaction.md#compaction)).
- Trình soạn thảo cảnh báo trước khi lưu nếu prompt dài quá 8.000 ký tự.
- Quy tắc nền tảng của lead được render phía trên `prompts/system.md` và không hiện dưới dạng text sửa được.

## Kỹ năng

### Kho

Bảng `skill_catalog` ([10](10-data-model.md)) được seed khi khởi động từ `platform/seeds/skills.yaml` cộng `domains/<id>/seeds/skills.yaml` (tuỳ chọn), upsert theo `id`. Người dùng thấy các dòng toàn cục (`domain_id IS NULL`) cộng các dòng của miền mình.

```yaml
# platform/seeds/skills.yaml
- id: xlsx
  name: xlsx                       # tên thư mục trong skills/
  title_vi: Đọc & tạo file Excel
  description_vi: Đọc bảng tính khách gửi, xuất báo cáo .xlsx có công thức và định dạng.
  tags: [Báo cáo, Excel]
  install_cmd: [python, -m, contoso.skills, install, anthropics/skills, skills/xlsx, --ref, dbd4588f9e1033efb41dad4bef2f7947c8993d44]
```

- **`install_cmd`** là mảng argv, không bao giờ là chuỗi shell. Nó chạy như một system exec với `cwd` là thư mục agent.
- **Seed ban đầu** ghim `anthropics/skills` ở `dbd4588f9e1033efb41dad4bef2f7947c8993d44` và cung cấp `xlsx`, `docx`, `pdf`, `pptx`. Seed của miền thêm dòng riêng ([18](18-domains.md)).
- **Kiểm tra seed** khi khởi động: `id` duy nhất, `name` duy nhất trong tập dòng toàn cục cộng dòng của một miền bất kỳ, `--ref` được ghim đủ 40 ký tự hex, và `install_cmd[0:3] == [python, -m, contoso.skills]`. `id` của skill là duy nhất trên các dòng toàn cục và của mọi miền (nó là khoá chính). Các kiểm tra nằm ở `backend/catalog/validate.py`; seed của miền không qua thì miền đó thành không khả dụng ([12](12-auth-and-domains.md#kiểm-tra-khi-khởi-động)). Nếu kiểm tra toàn cục không qua, marketplace bị tắt (và lý do được ghi log); mọi thứ khác vẫn chạy.

### Trình cài `contoso.skills`

`python -m contoso.skills install <owner/repo> <path> --ref <sha> [--name <dir>]`. Chỉ dùng thư viện chuẩn, đóng sẵn trong image workspace ([11](11-sandbox.md)).

1. Tải `https://codeload.github.com/<owner>/<repo>/tar.gz/<sha>`, gửi kèm `Authorization: Bearer $GITHUB_TOKEN` nếu biến đó được đặt. Giới hạn tải là 50 MB.
2. Chỉ giải nén các mục nằm dưới `<repo>-<sha>/<path>/`. Từ chối đường dẫn tuyệt đối, `..` và link trỏ ra ngoài thư mục.
3. Yêu cầu có `SKILL.md` ở gốc thư mục giải nén, với frontmatter YAML chứa `name` và `description`.
4. Ghi kết quả vào `skills/<name hoặc --name>/`, thay thư mục cũ (nếu có) một cách nguyên tử (giải nén vào `skills/.tmp-<name>`, rồi đổi tên).
5. In ra JSON `{"installed": "skills/<dir>", "files": N, "has_code": bool}`. `has_code` là true nếu có file đuôi `.py`, `.sh` hoặc `.js`, hoặc file có quyền thực thi.

Tên thư mục (`--name`, nếu không thì `name` trong frontmatter) phải khớp `[A-Za-z0-9][A-Za-z0-9._-]*`. Link phải nằm trong skill; hard link bị từ chối. Khi lỗi, trình cài in lý do ra stderr, thoát mã khác 0 và giữ nguyên bản cài cũ. Khi test, `CONTOSO_SKILLS_CODELOAD_URL` thay cho `https://codeload.github.com` (server `fixtures` trong [17](17-testing.md)).

**Cài từ link** chuyển `https://github.com/<owner>/<repo>/tree/<ref>/<path>` thành cùng lệnh đó. Nếu `<ref>` là một nhánh, `api` phân giải nó thành commit SHA trước qua `GET https://api.github.com/repos/<owner>/<repo>/commits/<ref>`, nên mọi lần cài đều được ghim.

**Xem trước khi cài.** `GET /api/catalog/skills/{id}/preview` trả `SKILL.md` đã render và danh sách file. `api` lấy chúng từ `raw.githubusercontent.com` và danh sách trong tarball, và cache trên đĩa tại `/data/cache/skills/<sha>/`. Hộp thoại cài hiện nguồn, danh sách file và, khi `has_code` là true, cảnh báo: "Kỹ năng này chứa mã chạy trong thư mục agent".

**"Đã cài"** nghĩa là đã có thư mục `skills/<catalog.name>/`. Bấm cài lần nữa sẽ cài lại và ghi đè. **Gỡ** một kỹ năng sẽ xoá `skills/<name>/` và commit.

**Kỹ năng do agent tự viết** là mọi thư mục khác trong `skills/`. Chúng hiện y như vậy; lịch sử commit cho biết ai đã tạo.

## Thư viện

Bảng `library_presets` được seed từ `platform/seeds/library_presets.yaml` và seed của miền. Preset là trình cài một lần ([quyết định 0015](decisions/0015-library-presets-are-one-shot-installers.md)). Kiểm tra seed đòi `id` duy nhất (trên các dòng toàn cục và của mọi miền, vì nó là khoá chính) và `packages` là danh sách chuỗi không rỗng.

```yaml
- id: data
  title_vi: Phân tích dữ liệu
  description_vi: Đọc, lọc, gộp bảng lớn.
  packages: ["pandas>=2.2", "numpy>=2.0", "pyarrow>=17"]
- id: postgres
  title_vi: Kết nối PostgreSQL
  packages: ["psycopg[binary]>=3.2", "sqlalchemy>=2.0"]
- id: charts
  title_vi: Vẽ biểu đồ
  packages: ["matplotlib>=3.9", "seaborn>=0.13"]
- id: stats
  title_vi: Thống kê
  packages: ["scipy>=1.14", "statsmodels>=0.14", "scikit-learn>=1.5"]
- id: documents
  title_vi: Tài liệu Word/Excel/PDF
  packages: ["python-docx>=1.1", "openpyxl>=3.1", "reportlab>=4.2", "markdown>=3.7"]
- id: web
  title_vi: Truy cập web
  packages: ["httpx>=0.27", "beautifulsoup4>=4.12"]
```

- **Áp dụng preset** chạy system exec `uv add <packages…>` một lần. Không có gì ghi nhớ rằng preset đã được dùng. Áp dụng lại không làm thay đổi gì.
- **Package đã cài** được đọc trực tiếp từ `[project].dependencies` trong `pyproject.toml`. Mỗi package có nút gỡ (`uv remove <name>`). Một ô nhập cho phép thêm một package (`uv add <spec>`), được kiểm tra theo PEP 508 trước khi job chạy.
- **Lỗi.** `uv add` và `uv remove` là nguyên tử. Nếu một lệnh lỗi (package không tồn tại, xung đột phiên bản), thư mục không đổi, và job kết thúc `failed`, UI hiện 4 KB cuối output của `uv`.
- **Tốc độ.** Image workspace nạp sẵn cache uv với mọi package của mọi preset được seed, nên áp dụng preset chạy được khi offline và mất vài giây ([11](11-sandbox.md#image)).

## Lịch chạy

- **Tab Lịch** sửa `routines/<name>.yaml` ([09](09-routines.md)). `name` khớp `^[a-z0-9-]{2,32}$`.
- **Bộ chọn lịch.** "Hằng ngày lúc HH:MM", "Hằng tuần vào <ngày> lúc HH:MM" và "Mỗi N giờ" mỗi loại tạo ra một biểu thức cron. "Nâng cao" nhận cron 5 trường dạng thô, kiểm tra bằng `croniter`. Mọi thời gian theo `Asia/Ho_Chi_Minh`.
- **Hiển thị.** Tab hiện ba lần chạy kế tiếp và lần chạy gần nhất (`routine_state.last_started_at` / `last_ended_at`).

## Bộ credentials

- Tab liệt kê các bộ của miền (`GET /api/catalog/credential-sets`), mỗi bộ hiện tên, mô tả (lấy từ dòng đầu `# description:` của `.env.example`) và tên các key.
- **Gắn** một bộ tạo symlink `.env.d/<set>.env`; **gỡ** sẽ xoá nó. Thay đổi có hiệu lực ở exec kế tiếp. Không có commit nào, vì `.env.d/` bị git bỏ qua; thay đổi được ghi lại trong notice và trong log có cấu trúc.
