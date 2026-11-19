# 01 · Thuật ngữ

| Thuật ngữ | Định nghĩa |
|---|---|
| Activation | Một lượt chạy của agent, từ lúc thức dậy đến khi rảnh trở lại. Là một trace Langfuse với một `trace_id`. Xem [03](03-agent-loop.md). |
| Trang tổng quan admin (admin overview) | Trang admin `/admin`: mỗi agent một dòng với trạng thái, hàng đợi, lỗi và chi phí. Xem [13](13-observability.md). Không nhầm với dashboard nghiệp vụ. |
| Agent | Một phiên chính cộng một thư mục agent, thuộc về một người dùng. Mọi agent chạy cùng code harness; chúng chỉ khác nhau ở thư mục và cờ `is_lead`. |
| Agent Fleet | Tên của màn hình chat mock hiện tại với sáu agent cố định ([14d](14d-frontend-chat-mock.md)). Đích là app chat ở [14](14-frontend.md); các agent của một người dùng là *nhóm* của họ. |
| Thư mục agent (agent folder) | `/data/folders/<user_id>/<slug>/`. Chứa prompt, trí nhớ, kỹ năng, helper, lịch chạy, môi trường Python và liên kết credentials của agent. Đây là một git repository. Xem [04](04-agent-folder.md). |
| Hội thoại agent (agent thread) | Hội thoại chỉ có agent là thành viên. Người dùng không bao giờ thấy; admin thấy trong chế độ xem trace. |
| Artifact | File gắn với một phiên bản báo cáo (HTML, CSV, DOCX, PDF hoặc XLSX). Còn gọi là file báo cáo. Xem [19](19-reports-dashboard-notifications.md#kho-báo-cáo). |
| Khối công việc (block of work) | Một chuỗi suy luận và lời gọi Python mà agent chọn làm xong trước khi xử lý thông báo. Agent tự quyết độ dài; harness không bao giờ ngắt. |
| Builder | Giao diện nơi người dùng tạo và tuỳ biến agent. Xem [05](05-agent-builder.md). |
| Dashboard nghiệp vụ (business dashboard) | Trang `/`, với các KPI về tồn kho, tồn kho chậm bán và giao dịch, tính từ dataset mới nhất của người dùng. Xem [19](19-reports-dashboard-notifications.md#dashboard-nghiệp-vụ). |
| Lead có sẵn (built-in lead) | Agent lead mà mỗi người dùng nhận khi được tạo tài khoản. Không xoá được. Slug `lead`, tên hiển thị "Điều phối". |
| Bộ credentials (credential set) | Một file `.env` có tên trong miền, `domains/<domain>/credentials/<set>.env`, gắn vào agent bằng symlink trong `.env.d/`. Xem [12](12-auth-and-domains.md). |
| `current_state` | Khối do harness render và nối kèm mỗi input mới: thời gian, danh tính và nhóm của agent, task hiện tại, trạng thái, việc đang chờ. Xem [06](06-context-and-compaction.md). |
| Dataset | File JSON mà agent xuất bản bằng `publish_dataset`; dashboard nghiệp vụ đọc dataset `dashboard` mới nhất. |
| Delivery | Một tin nhắn (hoặc notice hệ thống) đang chờ một agent: một dòng trong `deliveries`. Delivery `pending` là thông báo agent chưa tiêu thụ. |
| Hội thoại trực tiếp (direct thread) | Hội thoại 1-1 giữa người dùng và một agent của họ; mỗi agent có đúng một. |
| Miền (domain) | Công ty hoặc nhóm dùng nền tảng, như `fabrikam`. Miền cung cấp bộ credentials, agent mẫu và (tuỳ chọn) mục trong kho. Mỗi người dùng thuộc đúng một miền. |
| Epoch | Một đoạn context của agent giữa hai lần compaction, với system prompt và tóm tắt cố định. Epoch mới bắt đầu khi compaction hoặc khôi phục. |
| Exec | Một lần chạy code Python của agent trong `execd`, có `exec_id` riêng. |
| Exec token | Token HMAC ngắn hạn cấp cho mỗi exec, để các helper `contoso` gọi ngược về `api` với danh nghĩa agent đó, chỉ trong exec đó. |
| `execd` | Daemon HTTP trong container `workspace`, chạy Python trong thư mục agent. Xem [11](11-sandbox.md). |
| Task toàn cục (global task) | Một đơn vị công việc lấy từ hàng đợi task toàn cục của người dùng. Mỗi người dùng có tối đa một task chạy tại một thời điểm. |
| Hàng đợi task toàn cục | Hàng đợi FIFO các task toàn cục của một người dùng; chỉ lead của người đó điều khiển. |
| Hội thoại nhóm (group thread) | Hội thoại do người dùng tạo với từ hai agent của họ trở lên. |
| Rảnh (idle) | Vòng lặp model của agent không chạy. Harness quan sát được. |
| Tham gia (involved) | Agent tham gia task toàn cục đang chạy khi nó đã gửi hoặc nhận một tin trong lúc task đó chạy. |
| jev | Bộ phân loại cho mỗi tin gửi đến lead, gắn nhãn `task` hoặc `side_question`. Đặt theo tên và dùng chính model Jev của TypeSafe AI, một model quyết định "System One" không sinh văn bản, gọi qua Decisions API của OpenRouter. Xem [07](07-routing-and-queue.md). |
| Lead | Agent duy nhất của mỗi người dùng sở hữu hàng đợi task toàn cục của người đó. |
| Preset thư viện (library preset) | Danh sách package Python có tên. Áp dụng một lần sẽ chạy `uv add`; sau đó không còn ghi nhận nào rằng preset đã được dùng. Xem [05](05-agent-builder.md). |
| Mock scenario | Giá trị `?scenario=` chọn hành vi của mock service trong frontend, như `offline` hoặc `report-showcase`. Xem [14g](14g-frontend-development.md#mock-scenario). Không nhầm với scenario của FakeModel ([17](17-testing.md)). |
| Notice | Thông báo do hệ thống tạo, không có tin nhắn đứng sau, ví dụ "đã cài một kỹ năng" hoặc "harness đã khởi động lại". |
| Thông báo (notification) | Input được nối vào cuối context của một **agent**. Người nhận tự quyết khi nào xử lý. Các mục trong hộp thư của người dùng là *thông báo người dùng (user notification)*. |
| Offload | Ghi output Python lớn ra file, chỉ giữ đầu, đuôi và đường dẫn file trong context. |
| Quy tắc nền tảng (platform rules) | `platform/rules.md`. Chỉ dẫn cố định mở đầu mọi system prompt; người dùng không sửa được. |
| Báo cáo (report) | Một bản ghi trong thư viện báo cáo của người dùng, có id `R<n>`, các lần thử và các phiên bản bất biến. Xem [19](19-reports-dashboard-notifications.md#kho-báo-cáo). |
| Lần thử báo cáo (report attempt) | Một lần thử tạo phiên bản mới cho một báo cáo, từ `start_report` đến `publish_report` hoặc `fail_report`. |
| Tổng quan báo cáo (report overview) | Chế độ `dashboard` gọn của trình xem báo cáo cho một phiên bản đã lưu ([14e](14e-report-viewer.md)). Không liên quan đến dashboard nghiệp vụ. |
| Phiên bản báo cáo (report version) | Một trạng thái đã xuất bản, không bao giờ thay đổi, của báo cáo: nội dung schema v1, evidence và artifact. Id là `<report id>-v<n>`. |
| Lịch chạy (routine) | Một prompt cộng một lịch cron, lưu tại `routines/<name>.yaml` trong thư mục agent. Chạy khi chủ sở hữu rảnh. |
| Điểm an toàn (safe point) | Agent rảnh và không tham gia task toàn cục đang chạy. Chỉ lúc đó compaction mới được chạy. |
| Câu hỏi phụ (side question) | Tin gửi lead không cần task toàn cục riêng. Được chuyển thành thông báo. |
| Kỹ năng (skill) | Thư mục `skills/<name>/` có `SKILL.md` với frontmatter YAML (`name`, `description`). Agent đọc khi cần. |
| Kho kỹ năng (skill catalog) | Danh sách kỹ năng được chọn lọc để cài, nằm trong bảng `skill_catalog`, seed từ YAML. |
| Slug | Định danh cố định của agent trong nhóm của người dùng, `[a-z0-9-]{2,32}`; dùng trong đường dẫn và `send_to_agent`. |
| Snapshot | Git commit mà `execd` tạo sau một exec khi có file thay đổi. |
| Agent mẫu (starter) | Định nghĩa agent mà miền cung cấp (prompt, preset thư viện, bộ credentials). Được sao chép cho mỗi người dùng mới của miền. |
| Nhãn trạng thái (status label) | Dấu gắn trên mọi tính năng frontend: *Đã có (mock)*, *Đã có (API)* hoặc *Dự kiến*. Xem [14](14-frontend.md). |
| System exec | Lần chạy `execd` do `api` khởi động thay vì model, ví dụ `uv add` hay cài kỹ năng. |
| Hội thoại (thread) | Cuộc trò chuyện với tập thành viên cố định: người dùng và/hoặc agent. Loại `direct`, `group` hoặc `agent`. |
| Trigger | Bất cứ thứ gì tạo input cho agent: tin của người dùng, tin của agent, người dùng mở app, lịch chạy, notice hệ thống. |
| Thông báo người dùng (user notification) | Một mục trong hộp thư của người dùng tại `/notifications`: báo cáo đã sẵn sàng, task thất bại, một lựa chọn đang chờ, hoặc sự kiện tài khoản hay hệ thống. Xem [19](19-reports-dashboard-notifications.md#thông-báo-người-dùng). |
| `workspace` | Container chứa mọi thư mục agent và chạy `execd`. |
