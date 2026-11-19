# 12 · Xác thực, vai trò và miền

**Phụ thuộc:** [04](04-agent-folder.md), [10](10-data-model.md).

**Trạng thái:** Đã làm ở S2 (`backend/auth/`, `backend/api/`, `backend/accounts.py`, `backend/domains/`), trừ phần việc của job cấp phát và retry (S9), dừng và khởi động runner (S5b) và đăng nhập Langfuse (compose của S0).

## Đăng nhập (mức PoC)

- **Không tự đăng ký.** Admin tạo tài khoản với tên đăng nhập và mật khẩu.
- **Băm mật khẩu.** Mật khẩu được băm bằng argon2id (mặc định của `argon2-cffi`, tức tham số của OWASP).
- **`POST /api/auth/login {username, password}`.** Đăng nhập bằng tên đăng nhập. Bản mock frontend hiện tại vẫn hỏi email ([14](14-frontend.md#hiện-trạng-so-với-mục-tiêu)).
  - **Thành công:** sinh 32 byte ngẫu nhiên (`secrets.token_bytes`), lưu SHA-256 của chúng vào `auth_sessions`, và đặt cookie `contoso_session=<token b64url>` với `HttpOnly; SameSite=Lax; Path=/`, thêm `Secure` khi `COOKIE_SECURE=1`, và `Max-Age` 7 ngày. TTL là 7 ngày và trượt theo lần dùng: `last_seen_at` và `expires_at` được cập nhật tối đa mỗi phút một lần, và mỗi lần chúng dịch chuyển thì cookie được gửi lại với `Max-Age` mới. Tên đăng nhập được chuyển chữ thường và bỏ khoảng trắng hai đầu trước khi tra.
  - **Thất bại:** trả 401 `invalid_credentials`, cùng một response cho tên không tồn tại và mật khẩu sai.
  - **Người dùng bị vô hiệu hoá** nhận 403 `user_disabled`, nhưng chỉ khi đúng mật khẩu; sai mật khẩu vẫn là 401 `invalid_credentials`.
  - **Giới hạn:** 10 lần sai cho mỗi tên đăng nhập (chữ thường) trong cửa sổ trượt 15 phút, lưu trong bộ nhớ, sau đó 429 `rate_limited` kèm `Retry-After`, kể cả khi đúng mật khẩu. Đăng nhập thành công xoá bộ đếm.
- **`POST /api/auth/logout`** xoá dòng session và xoá cookie; trả 204 cả khi không có session. **`GET /api/auth/me`** trả `{id, username, display_name, role, domain: {id, name, status} | null}`.
- **CSRF.** Mọi request `/api` khác GET, HEAD và OPTIONS phải có `X-Contoso-Client: web`; nếu không thì 403 `csrf`, kiểm tra trước cả định tuyến và xác thực. Header tuỳ biến cộng `SameSite=Lax` là đủ cho PoC.
- **Admin đầu tiên.** Khi khởi động, nếu chưa có admin nào, một admin được tạo từ `ADMIN_USERNAME` (chữ thường) và `ADMIN_PASSWORD`. Mật khẩu không bao giờ được ghi log. Admin đã có thì giữ nguyên, nên đổi `ADMIN_PASSWORD` sau đó không đổi mật khẩu của admin. Nếu tên không hợp lệ hoặc đã là của một người dùng, khởi động dừng với lỗi nêu tên `ADMIN_USERNAME`.

## Vai trò và phân quyền

| Vai trò | Miền | Thấy | Route |
|---|---|---|---|
| `user` | đúng một | agent, hội thoại, task, thư mục của chính mình | `/api/*` trừ `/api/admin/*` |
| `admin` | không có | mọi miền, người dùng, agent, hội thoại, event và thư mục | `/api/admin/*` cộng các route thư mục và kho; không có route chat (admin không có nhóm agent) |

([quyết định 0018](decisions/0018-single-global-admin-role.md))

- **Quyền sở hữu.** Mọi truy vấn theo người dùng đều lọc `user_id = current_user.id`. Hỏi tài nguyên của người khác trả **404 `not_found`**, nên không bao giờ xác nhận nó có tồn tại.
- **Route admin** trả **403 `forbidden`** cho người dùng thường, và các route chỉ dành cho người dùng (chat, nhóm agent, builder) trả 403 `forbidden` cho admin. Không có session thì mọi nơi đều là 401 `unauthenticated`.
- **Route internal** (`:8001/internal/v1/*`) chỉ nhận exec token ([11](11-sandbox.md#exec-token)). Cổng 8001 không được compose publish.

## Miền

Miền là một thư mục trong bản checkout của repo, mount chỉ đọc ở `/domains` trong cả `api` lẫn `workspace`:

```text
domains/<id>/
  domain.yaml                         {id, name}
  credentials/<set>.env.example       được commit; dòng đầu "# description: …", sau đó các dòng KEY=
  credentials/<set>.env               giá trị thật, git bỏ qua, do người vận hành ghi
  starters/lead/prompt.md             tuỳ chọn: vai trò cho lead có sẵn
  starters/<slug>/agent.yaml          {display_name, avatar: {emoji, color}, description, presets: [...], credentials: [...]}
  starters/<slug>/prompt.md
  seeds/skills.yaml                   tuỳ chọn: các dòng kho của miền
  seeds/library_presets.yaml          tuỳ chọn: preset của miền
```

```yaml
# domains/fabrikam/domain.yaml
id: fabrikam
name: Fabrikam Sales Ops
```

([quyết định 0009](decisions/0009-domain-credentials-as-files.md), [quyết định 0010](decisions/0010-per-user-agent-teams.md))

### Kiểm tra khi khởi động

`domains/validate.py` kiểm tra từng miền và upsert `domains` với `available` hoặc `unavailable` kèm lý do:

1. `domain.yaml` parse được, và `id` trùng tên thư mục.
2. Mỗi `credentials/<set>.env.example` có `<set>.env` tương ứng, và mọi key trong file mẫu đều có và không rỗng trong file thật.
3. **Không tên key nào xuất hiện ở hai bộ credentials của cùng miền.** Nhờ vậy thứ tự nạp `.env.d/` không bao giờ quan trọng.
4. Mỗi agent mẫu có `prompt.md`, và mỗi `agent.yaml` parse được, có `display_name`, và `presets`, `credentials` là danh sách tên. `presets` của nó phải tồn tại (toàn cục trong `platform/seeds/library_presets.yaml`, hoặc trong seed của miền này), `credentials` phải là các bộ có thật, và slug phải hợp lệ ([04](04-agent-folder.md)) và khác `lead`. `starters/lead/` chỉ chứa `prompt.md`.
5. Các file seed parse được thành danh sách và qua kiểm tra kho ([05](05-agent-builder.md#kho)). Id skill và preset của miền còn phải khác id toàn cục và khác id của mọi miền khác (chúng là khoá chính).

`status_reason` chứa các lý do, mỗi dòng một lý do. Dòng `domains` mà thư mục không còn thì thành `unavailable` (`domains/<id>: missing directory`); không bao giờ xoá dòng. Khi một miền chuyển từ khả dụng sang không khả dụng, mỗi người dùng của miền nhận một thông báo `system` ([19](19-reports-dashboard-notifications.md#thông-báo-người-dùng)).

**Lý do chỉ được ghi log bằng tên key hoặc tên file, không bao giờ bằng giá trị.** Người dùng của miền không khả dụng vẫn đăng nhập được và thấy banner ("Miền dữ liệu đang lỗi cấu hình, liên hệ quản trị viên"). Runner của họ không khởi động, và `POST` vào hội thoại của họ trả 503 `domain_unavailable`. Các miền khác không bị ảnh hưởng. `make check` chạy cùng các kiểm tra đó từ dòng lệnh.

### Luồng credentials

1. Người vận hành sao chép mỗi `credentials/<set>.env.example` thành `<set>.env` và điền giá trị.
2. Compose mount `./domains` chỉ đọc. `api` chỉ đọc các file `.env.example` và tên key, và không bao giờ parse giá trị. Ngoại lệ duy nhất là bước kiểm tra, chỉ xem giá trị có rỗng hay không.
3. Agent nhận một bộ credentials khi `agent.yaml` của agent mẫu hoặc builder gắn nó: một symlink `.env.d/<set>.env` trong thư mục của agent.
4. `execd` nạp các file đó vào môi trường của mỗi exec ([11](11-sandbox.md#post-exec)). Code của agent dùng `os.environ["WAREHOUSE_DSN"]`.
5. **Đổi credentials** chỉ là sửa một file. Thay đổi có hiệu lực ở exec kế tiếp của mọi agent, không cần khởi động lại.

## Cấp phát người dùng

`POST /api/admin/users {username, password, domain_id, display_name?}` ghi `users(status='provisioning')` và xếp một job cấp phát (`jobs.kind='user_provision'`, `request={domain_id}`). Tên đăng nhập được chuyển chữ thường và phải khớp `^[a-z0-9._-]{3,32}$`; tên đã có là 409 `username_taken`, miền không tồn tại là 400 `invalid_request`. Job:

1. Tạo lead ([04](04-agent-folder.md#tạo-agent)).
2. Tạo mọi agent mẫu của miền, theo thứ tự slug a-z.
3. Đặt `status='active'`.

Nếu một bước lỗi, nó đặt `status='failed'` với `status_detail` ghi tên bước đó. `POST /api/admin/users/{id}/retry` bỏ qua các agent đã có và làm tiếp (chỉ cho người dùng `failed`: nếu không thì 409 `invalid_state`, và 409 `job_running` khi đang có một job chờ hoặc chạy). Lead được tạo với tên `Điều phối` và avatar 🧭.

## Quản lý người dùng (trang admin "Người dùng")

| Thao tác | Tác động |
|---|---|
| Tạo | như trên |
| Vô hiệu hoá | `status='disabled'`; xoá mọi session của người đó; dừng runner của họ. Task của họ giữ nguyên trạng thái |
| Kích hoạt | `status='active'` (chỉ từ `disabled`); khởi động runner của họ. Người dùng bị vô hiệu hoá trước khi tạo xong lead thì chuyển sang `failed` ("provisioning did not finish; use retry") |
| Đặt lại mật khẩu | băm argon2id mới; xoá mọi session của người đó |
| Khôi phục agent | [04](04-agent-folder.md#khôi-phục-khôi-phục-bản-gốc) |
| Đổi miền | **không hỗ trợ trong PoC** (409 `domain_change_unsupported`) |

Các sự kiện tài khoản (tạo, đặt lại mật khẩu, vô hiệu hoá) cũng tạo một thông báo người dùng cho người bị ảnh hưởng, hiện trong hộp thư tại `/notifications` ([19](19-reports-dashboard-notifications.md)): `account-created` cho tài khoản mới (luôn gửi), `system` cho đặt lại mật khẩu hoặc vô hiệu hoá (bỏ qua khi người dùng đã tắt nhóm `system`). Vô hiệu hoá hay kích hoạt lặp lại không đổi gì và không gửi thông báo. Tài khoản admin không được quản lý ở trang này: các route quản lý người dùng chỉ liệt kê và thay đổi tài khoản `user`.

## Đăng nhập Langfuse

Langfuse có đăng nhập riêng, tách khỏi của chúng ta. Headless init tạo người dùng đầu tiên của nó từ `LANGFUSE_INIT_USER_EMAIL` (mặc định `admin@contoso.local`) và `LANGFUSE_INIT_USER_PASSWORD`. Compose đặt mật khẩu đó bằng `${ADMIN_PASSWORD}`, nên admin dùng cùng mật khẩu ở cả hai nơi. SSO giữa hai bên là việc sau này.
