# 99 · Rủi ro, câu hỏi mở và việc sau này

## Rủi ro

| Rủi ro | Hậu quả | Giảm thiểu trong PoC |
|---|---|---|
| **Lịch chạy bị bỏ đói** | Lịch chạy không bao giờ chạy nếu chủ sở hữu không bao giờ rảnh; lead là trường hợp dễ gặp nhất | Trang tổng quan hiện `routine_state.next_fire_at` đã qua; lịch chạy nên ngắn |
| **Lịch chạy dài làm chậm task** | Lịch đang chạy khi có việc con tới sẽ giữ phần việc của chủ sở hữu tới khi khối công việc hiện tại xong | `platform/rules.md` yêu cầu lịch ngắn; `EXEC_TIMEOUT_S` chặn độ dài mỗi bước |
| **jev gắn nhãn nhầm yêu cầu giúp đỡ thành task** | Yêu cầu bị xếp hàng sau chính task cần nó: deadlock | lựa chọn có độ tin cậy thấp bị ép về `side_question` (`JEV_CONFIDENCE_FLOOR`); lead có thể `end_task` hoặc tự xử lý; admin đánh dấu nhãn sai |
| **Giới hạn kích thước task** | Task vẫn vượt ngưỡng cứng sau offload hàng loạt sẽ thất bại | compaction theo ngưỡng mềm giữa các task; output được offload sớm |
| **Lượng tin tới lead** | Mỗi tin tới lead tốn một lần gọi jev và làm context của lead lớn thêm | `JEV_K` chặn input của jev; nhóm không có lead thì không qua jev |
| **Agent nói qua lại trong nhóm** | Agent trả lời tin trong nhóm của nhau và tạo vòng lặp | quy tắc im lặng mặc định; `MAX_STEPS_PER_ACTIVATION`; chi phí từng agent trên trang tổng quan |
| **Secret lọt vào output** | Code in một credential sẽ đưa nó vào `events` và Langfuse | chỉ có quy tắc trong prompt; giá trị `.env.d` bị che trong trình xem và nền tảng không bao giờ ghi log chúng |
| **Dùng chung uid trong `workspace`** | Code agent đọc được mọi thư mục, kể cả của người dùng khác | tách mạng khỏi DB; PoC coi mọi người dùng là cùng mức tin cậy |
| **Code của kỹ năng bên thứ ba** | Kỹ năng đã cài có thể chứa script mà agent chạy | ref được ghim, xem trước khi cài kèm cảnh báo có code, kho được chọn lọc |
| **Dùng chung key OpenRouter** | Một người dùng dùng nhiều sẽ tiêu ngân sách của mọi người; 429 khi dồn dập | thử lại có backoff; chi phí từng agent trên trang tổng quan |
| **Snapshot bị lỡ** | Snapshot lỗi khiến thay đổi bị ghi cho một exec sau | `snapshot_error` hiện trong chế độ xem trace |
| **Một tiến trình `api`** | Lỗi sập làm dừng mọi agent; không mở rộng ngang | mọi trạng thái nằm trong Postgres và thư mục; xử lý khởi động lại ([03](03-agent-loop.md#khởi-động-lại)) |
| **Tài nguyên của Langfuse** | ClickHouse và MinIO cần vài GB RAM và đĩa | input dạng phần chênh lệch thay vì toàn bộ context; `LANGFUSE_INIT_PROJECT_RETENTION` tuỳ chọn |
| **Dataset dashboard trong trình duyệt** | Toàn bộ dataset được gửi tới trình duyệt và tính ở đó ([19](19-reports-dashboard-notifications.md#cách-tính)); miền lớn làm dashboard chậm | giới hạn 20 MB cho mỗi dataset; agent publish có thể chỉ đưa vào đúng phạm vi dashboard cần |
| **Hai bản quy tắc schema báo cáo** | Phần kiểm tra của `api` và bộ decode của frontend có thể lệch nhau, nên một phiên bản đã lưu có thể không render được | trình xem hiện chẩn đoán thay vì lỗi; cả hai phía được test với cùng fixture |
| **Dashboard cũ** | Dataset chỉ thay đổi khi một agent publish nó; nếu không ai yêu cầu làm mới và người dùng không tạo lịch chạy, số liệu cũ đi mà không ai biết | mọi KPI hiện `dataThrough` và nguồn |

## Câu hỏi mở

Các câu hỏi từ ghi chú kiến trúc gốc và tình trạng hiện tại:

| Câu hỏi | Tình trạng |
|---|---|
| Chọn lead thế nào, và nếu lead lỗi thì sao | **Đã giải quyết:** mỗi người dùng có lead có sẵn ([0011](decisions/0011-built-in-lead-and-user-created-agents.md)); lỗi được xử lý khi khởi động lại ([03](03-agent-loop.md#khởi-động-lại)) |
| `SendToUser` và `SendToAgent` là tool call hay hàm Python? | **Đã giải quyết:** helper Python trong `contoso` ([11](11-sandbox.md#thư-viện-helper-contoso)) |
| Agent nào nhận "người dùng mở app"? | **Đã giải quyết:** chỉ lead, tối đa 30 phút một lần ([07](07-routing-and-queue.md#người-dùng-mở-app)) |
| Giới hạn cho thư mục agent (dung lượng, …) | **Còn mở.** PoC chưa có hạn mức |
| Thay đổi của người dùng và của agent trên cùng thư mục tương tác thế nào | **Đã giải quyết cho PoC:** một job lock, mọi lần ghi được commit kèm tác giả, ghi sau thắng |
| File output đã offload giữ bao lâu, ai dọn | **Còn mở.** PoC giữ mãi |
| Nhiều miền ánh xạ thế nào sang agent và thư mục | **Đã giải quyết:** miền = bộ credentials + agent mẫu; mỗi người dùng có nhóm riêng ([0010](decisions/0010-per-user-agent-teams.md)) |
| Đo độ chính xác của jev thế nào | **Đã giải quyết cho PoC:** `jev_decisions` + đánh dấu "gắn nhãn sai" của admin; so sánh các chính sách là việc sau này |
| Agent có nên tự cài kỹ năng từ kho không? | **Còn mở.** Agent viết được kỹ năng nhưng không truy vấn được kho |
| Báo cáo có nên chia sẻ giữa các người dùng của một miền? | **Còn mở.** Trong PoC báo cáo thuộc về một người dùng ([19](19-reports-dashboard-notifications.md#nguyên-tắc)) |
| `api` có nên tính dashboard thay cho trình duyệt? | **Còn mở.** Tạm thời tính ở trình duyệt, để quy tắc nằm ở một chỗ đã được test |

## Chỗ làm tắt của PoC và việc sau này

| Phần | PoC | Sau này |
|---|---|---|
| Cô lập exec | một container, một uid, chỉ có `cwd` | bubblewrap hoặc container cho mỗi lần chạy, mỗi người dùng một uid, chỉ bind chỉ-đọc đúng thư mục đó |
| Bảo vệ `.env` | quy tắc trong prompt; mount chỉ đọc chặn việc sửa | đưa secret qua broker hoặc proxy để code agent không thấy giá trị thô; che output |
| Mạng ra ngoài | mở | danh sách cho phép theo miền (host kho, GitHub, PyPI) |
| Chi phí LLM | dùng chung key, không giới hạn | ngân sách theo người dùng, giới hạn `MAX_CONCURRENT_LLM`, cảnh báo |
| BYOK | không có | key nhà cung cấp theo người dùng (OpenAI, Anthropic, OpenRouter) với dự phòng cho jev |
| Mở rộng | một tiến trình `api` | tách worker `harness` khỏi `api` (Postgres `LISTEN/NOTIFY`, lease cho session) |
| Nâng cấp template | agent mẫu chỉ sao chép một lần | merge ba chiều thay đổi của agent mẫu vào thư mục đã có, dùng `baseline_commit` |
| Lịch sử thư mục | mỗi exec có thay đổi một commit | gộp commit khi compaction; hạn mức dung lượng |
| Output đã offload | giữ mãi | xoá output cũ hơn epoch trước |
| Xác thực | tên + mật khẩu, session bằng cookie | SSO (OIDC) dùng chung với Langfuse, admin theo miền, nhật ký kiểm toán |
| Đổi miền cho người dùng | bị từ chối | dựng lại nhóm kèm chuyển trí nhớ |
| Quan sát | `docker compose logs` | gom log tập trung; điểm Langfuse từ nhãn sai của jev; dashboard |
| UI | tiếng Việt và tiếng Anh; không giọng nói, thông báo đẩy hay tìm kiếm | tìm kiếm tin nhắn, thông báo đẩy, giọng nói, sửa file trong trình xem |
| Frontend chỉ có mock | mọi trang chạy trên mock service; chat khác UX đích ([14](14-frontend.md#hiện-trạng-so-với-mục-tiêu)) | adapter API cho mọi port, sau đó là chat, builder và màn hình admin theo đích |
| Kênh gửi | chỉ web | email, Zalo OA, Slack qua cùng `send_to_user` |
