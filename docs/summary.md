# VDaAgent — Technical Summary

Tài liệu này mô tả kiến trúc và các contract đang dùng của VDaAgent. Hướng dẫn cài đặt và luồng sử dụng nhanh nằm tại [README.md](../README.md).

## 1. Mô hình sản phẩm

VDaAgent là workspace phân tích dữ liệu theo quy trình evidence-first:

1. Người dùng tải dữ liệu lên và tạo Profile Run.
2. Hệ thống profile schema, chất lượng, quyền riêng tư và insight ban đầu.
3. Sau khi xác nhận hồ sơ, người dùng làm việc trong Command Center với bốn tab: Tổng quan, Khám phá, Hỏi Agent và Báo cáo.
4. Kết quả Explorer chính thức, câu trả lời Agent có minh chứng và nội dung trong Report Draft có thể được chụp thành snapshot để xuất PDF.

`/analyses` và `/notebooks` không còn là route hoặc workflow công khai. Các session thực thi chỉ còn là chi tiết nội bộ phục vụ Explorer theo từng Profile Run.

### Invariant chính

- Mọi truy cập được giới hạn theo workspace và Profile Run.
- Không hiển thị hoặc xuất giá trị PII thô.
- Explorer và Agent chỉ mở sau khi Profile Run đã được xác nhận.
- Preview là kết quả bị giới hạn thời gian/dữ liệu; chỉ kết quả chính thức được dùng làm bằng chứng bền vững.
- Nội dung PDF đến từ Report Snapshot bất biến, không dựng lại từ trạng thái đang thay đổi trên màn hình.

## 2. Kiến trúc runtime

| Thành phần | Trách nhiệm |
| --- | --- |
| Next.js / React | UI, xác thực phía trình duyệt, Command Center và Report Draft |
| FastAPI | API profile, Explorer, Agent, báo cáo, RBAC và policy che dữ liệu |
| PostgreSQL | Workspace, Profile Run, Explorer result/evidence, report draft/snapshot và audit |
| Object storage | Tệp tải lên, artifact profile và artifact báo cáo |
| Worker/service nội bộ | Profiling, quality gate, thực thi Explorer, Agent và render PDF |

Frontend gọi backend qua `NEXT_PUBLIC_API_URL`. Backend nhận context xác thực/workspace, sau đó tự kiểm tra quyền trước khi đọc hoặc ghi dữ liệu.

## 3. Vòng đời Profile Run

```text
Upload dataset
  → Profile Run
  → Review & confirm
  → Command Center
      ├─ Explorer: preview → promote thành kết quả chính thức
      ├─ Agent: câu trả lời có evidence khi khả dụng
      └─ Report Draft: bố cục/note → snapshot → PDF
```

Profile Run là đơn vị ngữ cảnh chính. Mỗi explorer context, agent run, report item, snapshot và export đều phải liên hệ với cùng một Profile Run trong workspace của người dùng.

## 4. Explorer

Explorer hỗ trợ phân tích có ràng buộc thay vì truy vấn SQL tùy ý:

- UI tạo hoặc khôi phục context Explorer cho Profile Run.
- Chạy xem trước dùng ngân sách thời gian và kích thước dữ liệu giới hạn; timeout được trả về như một kết quả có thể hiểu được.
- Chạy kết quả chính thức chỉ thực hiện từ preview/context mới nhất; backend kiểm tra context stale trước khi chạy.
- Kết quả chính thức đi qua quality gate và tạo evidence hash/provenance bền vững.
- Cùng một kết quả được tái sử dụng theo hash khi phù hợp; không ghi lặp nhật ký preview vào báo cáo.

Các API profile-scoped chính:

| Method | Endpoint | Mục đích |
| --- | --- | --- |
| POST | `/profile/{run_id}/explorer/session` | Lấy hoặc tạo context Explorer |
| POST | `/profile/{run_id}/explorer/previews` | Chạy preview có giới hạn |
| POST | `/profile/{run_id}/explorer/previews/{preview_id}/promote` | Xác nhận/chạy kết quả chính thức |

Các lỗi `explorer_timeout` và `context_stale` là trạng thái nghiệp vụ có chủ đích. Frontend đặt lỗi ngay trong vùng kết quả có cùng chiều rộng với vùng preview/kết quả, đồng thời cung cấp hành động thử lại hoặc tải lại context.

## 5. Agent và evidence

Agent trả lời trong phạm vi Profile Run hiện tại. Mỗi câu trả lời có thể liên kết tới execution/evidence do Explorer tạo ra.

- `agent_trace_mode` mặc định là `shadow`: vẫn ghi nhận trace cần thiết nhưng không làm UI chờ vô hạn để giải thích execution.
- Một câu trả lời chỉ được đánh dấu có minh chứng khi evidence hash tồn tại bền vững, thuộc đúng Profile Run và truy xuất được theo quyền hiện tại.
- Câu trả lời không có evidence phải hiển thị rõ giới hạn và không được ghim vào báo cáo như một kết luận đã xác thực.
- Composer của Agent dùng `Enter` để gửi; `Shift+Enter` để xuống dòng.

API Agent được phục vụ theo Profile Run, gồm endpoint hỏi/stream câu trả lời và endpoint đọc evidence liên kết với agent run. Không trả raw rows hoặc PII cho Agent/UI.

## 6. Report Draft, Snapshot và PDF

Report Draft là vùng biên tập của người dùng. Khi xuất PDF, backend lấy snapshot mới nhất của Draft thay vì tái dựng từ dữ liệu live.

Nguồn PDF bao gồm các section theo thứ tự:

1. Tổng quan dataset
2. Hồ sơ kỹ thuật
3. Chất lượng, quyền riêng tư và giới hạn
4. Tóm tắt từ Agent
5. So sánh dữ liệu
6. Snapshot báo cáo
7. Kết quả Explorer liên quan

Section `Kết quả Explorer liên quan` chỉ trình bày kết quả chính thức có liên quan, gộp theo evidence/result hash và diễn giải bằng ngôn ngữ tự nhiên. Không đưa ID execution kỹ thuật, lịch sử preview lặp lại hoặc mục kiểm định thống kê vào PDF.

Các section key trong report source:

```text
overview
technical_profile
quality
agent_summary
drift
analysis
report_snapshot
```

Những API báo cáo cần chú ý:

| Method | Endpoint | Mục đích |
| --- | --- | --- |
| GET | `/profile/{run_id}/report-draft` | Đọc cấu hình Draft hiện tại |
| POST | `/reports/{report_id}/items` | Thêm nội dung vào Draft |
| POST | `/reports/{report_id}/snapshots` | Lưu snapshot bất biến |
| GET | `/api/reports/profile/{run_id}?reportId={report_id}` | Tải PDF từ snapshot mới nhất |

## 7. Xác thực, workspace và quyền

Backend áp dụng workspace scope cho tất cả route nhạy cảm. Một request phải xác định người dùng, workspace và quyền thích hợp trước khi truy cập Profile Run hoặc artifact liên quan.

Ứng dụng hỗ trợ cấu hình local/development và Supabase theo biến môi trường. Luồng đăng nhập phải chờ session được khôi phục, provisioning workspace hoàn tất rồi mới chuyển người dùng khỏi trang đăng nhập; không để màn hình đang mở workspace chờ vô hạn.

Không đặt secret vào biến `NEXT_PUBLIC_*`. Frontend chỉ nhận URL public và key public cần thiết; service key, database URL và storage secret chỉ ở backend/runtime server.

## 8. Cấu hình và vận hành

| Biến | Ý nghĩa |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | Base URL FastAPI dùng bởi frontend |
| `NEXT_PUBLIC_UX_COMMAND_CENTER_ENABLED` | Bật Command Center ở frontend; đây là biến build-time nên cần build/deploy lại frontend sau khi thay đổi. |
| `UX_COMMAND_CENTER_ENABLED` | Bật contract/router Command Center ở backend. |
| `AGENT_TRACE_MODE` | `shadow` mặc định; dùng `off` chỉ khi cần vô hiệu trace có chủ đích |
| `DATABASE_URL` | Kết nối PostgreSQL của backend |
| `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` | Cấu hình Supabase phía backend; frontend dùng `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. |

Sau khi đổi config backend, restart service nếu môi trường không tự reload. Migration chạy từ thư mục `backend` bằng `alembic upgrade head`; chỉ thực hiện với database đã được xác nhận là đúng môi trường.

## 9. Route frontend hiện hành

| Route | Mục đích |
| --- | --- |
| `/login` | Đăng nhập và khởi tạo session/workspace |
| `/` | Trang chủ/workspace |
| `/profiles/{run_id}` | Command Center của Profile Run |
| `/guide` | Hướng dẫn sản phẩm hiện hành |

Không thêm lại liên kết hoặc điều hướng tới `/analyses` hay `/notebooks`.

## 10. Kiểm thử

Từ thư mục `frontend`:

```bash
pnpm typecheck
pnpm test:e2e -- report-markdown.spec.ts
```

Từ thư mục `backend`, dùng database test riêng trước khi chạy pytest tích hợp:

```bash
$env:P170_TEST_DATABASE_URL = postgresql+psycopg://...
pytest
```

Không chạy test ghi dữ liệu vào database production. Với thay đổi backend nhỏ, tối thiểu xác nhận Python compile/import; với thay đổi UI, chạy typecheck và test e2e liên quan.

## 11. Giới hạn có chủ đích

- Không cho phép raw SQL hoặc tải raw rows qua UI Explorer/Agent.
- Không mặc định dùng preview như bằng chứng cho báo cáo.
- Không xuất PII thô, kể cả trong snapshot/PDF.
- Không coi câu trả lời Agent thiếu evidence là kết luận đã kiểm chứng.

Tài liệu chi tiết hơn theo lĩnh vực nằm trong thư mục [`docs/`](.).
