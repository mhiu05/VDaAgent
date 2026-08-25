# Google Calendar MCP cho Analyst

Hướng dẫn kết nối Google Calendar vào VDaAgent để Analyst xem, tạo và hủy
lịch hẹn. Provider mặc định là Google Calendar; connection được khóa theo
workspace và user Analyst.

## 1. Kiến trúc

UI gọi FastAPI, FastAPI dùng encrypted refresh token để gọi Google Calendar.
MCP stdio expose cùng service qua list_calendar_events,
create_calendar_event và delete_calendar_event.

MCP server hiện là trusted-local stdio. Không expose file MCP ra Internet.
Streamable HTTP chỉ nên triển khai sau authentication, Origin validation và
request context cho workspace/user.

Permission:

| Permission | Ý nghĩa |
| --- | --- |
| calendar.read | Xem trạng thái kết nối và danh sách event |
| calendar.write | Kết nối OAuth, tạo, hủy, ngắt kết nối |

Workspace Analyst có cả hai quyền. System Admin không tự động xem calendar cá
nhân của Analyst khác.

## 2. Cấu hình Google Cloud Console

Mở [Google Cloud Console](https://console.cloud.google.com/) và thực hiện:

1. Tạo project riêng cho VDaAgent hoặc chọn project hiện có.
2. Vào APIs & Services -> Library, tìm Google Calendar API và bấm Enable.
3. Vào Google Auth Platform -> Branding, điền App name, support email,
   developer contact và các URL public của ứng dụng:
   - Application home page: `https://<frontend-domain>/`
   - Application privacy policy link: `https://<frontend-domain>/privacy`
   - Application terms of service link: `https://<frontend-domain>/terms`
   Các trang này không yêu cầu đăng nhập. Khi chạy local, có thể dùng
   `http://localhost:3000/privacy` và `http://localhost:3000/terms` để kiểm tra;
   khi submit production nên dùng domain HTTPS thực tế.
4. Vào Google Auth Platform -> Audience:
   - chọn Internal nếu mọi user cùng Google Workspace;
   - chọn External nếu có Gmail/domain bên ngoài;
   - khi Testing, thêm email Analyst vào Test users.
5. Vào Google Auth Platform -> Data Access và thêm:

    https://www.googleapis.com/auth/calendar.events

   Scope này đủ cho xem, tạo và xóa event. Không dùng scope calendar toàn
   quyền nếu chưa cần.
6. Vào Google Auth Platform -> Clients -> Create client:
   - Application type: Web application;
   - local redirect:

     http://localhost:8000/api/v1/calendar/callback

   - production redirect:

     https://<backend-domain>/api/v1/calendar/callback

   Redirect URI phải khớp tuyệt đối scheme, host, path và slash cuối; không
   dùng wildcard.
7. Copy Client ID và Client secret. Client secret chỉ đặt ở backend.

Tài liệu chính thức:

- [Google Calendar Python quickstart](https://developers.google.com/workspace/calendar/api/quickstart/python)
- [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies)

## 3. Tạo Fernet key

Chạy trên backend machine:

    .\.venv\Scripts\python.exe -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'

Đặt output vào GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY. Giữ key ổn định trong
suốt deployment. Nếu đổi key, token cũ không giải mã được và Analyst phải
OAuth lại. Không commit key hoặc đưa key vào frontend/log CI.

## 4. Cấu hình local

Copy .env.example thành .env và điền:

    GOOGLE_CALENDAR_CLIENT_ID=<web-client-id>
    GOOGLE_CALENDAR_CLIENT_SECRET=<web-client-secret>
    GOOGLE_CALENDAR_REDIRECT_URI=http://localhost:8000/api/v1/calendar/callback
    GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY=<fernet-key>
    GOOGLE_CALENDAR_FRONTEND_URL=http://localhost:3000
    GOOGLE_CALENDAR_DEFAULT_ID=primary
    GOOGLE_CALENDAR_TIMEZONE=Asia/Bangkok

primary là calendar chính của tài khoản đã OAuth. Calendar ID cụ thể lấy tại
Google Calendar -> Settings -> Integrate calendar.

Cài dependency và chạy migration:

    .\.venv\Scripts\python.exe -m pip install -r requirements.txt
    .\.venv\Scripts\python.exe -m alembic upgrade head

Migration 20260825_0016_google_calendar.py tạo:

- google_calendar_connections: encrypted token theo workspace/user;
- google_calendar_oauth_states: state dùng một lần có expiry chống CSRF/replay.

Khởi động backend:

    .\.venv\Scripts\python.exe -m uvicorn src.main:app --app-dir backend --reload --port 8000

Terminal khác:

    cd frontend
    pnpm dev

Đăng nhập bằng Analyst, mở /calendar, bấm Kết nối Google Calendar, chọn tài
khoản và Allow. Popup callback tự đóng; bấm Làm mới nếu cần.

## 5. Dùng UI và API

UI flow:

1. Mở /calendar và kiểm tra Connected.
2. Nhập tiêu đề, thời gian, địa điểm, mô tả và attendee.
3. Bấm Tạo lịch; kiểm tra event trên Google Calendar.
4. Bấm Hủy trên event test và xác nhận dialog.
5. Kiểm tra Analyst khác không thấy token/event của user thứ nhất.

Endpoint, đều cần bearer token và X-Workspace-Id:

    GET    /api/v1/calendar/status
    GET    /api/v1/calendar/connect
    GET    /api/v1/calendar/events?limit=50
    POST   /api/v1/calendar/events
    DELETE /api/v1/calendar/events/{event_id}
    DELETE /api/v1/calendar/connection

Payload tạo event dạng JSON:

    summary: Review profile với team
    start: 2026-08-25T09:00:00+07:00
    end: 2026-08-25T10:00:00+07:00
    time_zone: Asia/Bangkok
    description: Review quality warnings
    location: Google Meet
    attendees: analyst@example.com

start/end bắt buộc có timezone offset. Backend reject end <= start, giới hạn
50 attendee và giới hạn 100 event mỗi request.

## 6. Kết nối MCP client

P-170 MCP server chạy từ thư mục backend qua stdio. Với client hỗ trợ
mcpServers, cấu hình tương đương:

    mcpServers:
      p170-calendar:
        command: E:\VDuAgents\P-170\.venv\Scripts\python.exe
        args: [-m, src.mcp_server]
        cwd: E:\VDuAgents\P-170\backend
        env:
          PYTHONPATH: E:\VDuAgents\P-170\backend

MCP client phải spawn và sở hữu lifecycle của process; không chạy server thủ
công rồi spawn thêm process thứ hai.

| Tool | Tác dụng | Permission |
| --- | --- | --- |
| list_calendar_events | Xem event trong window, mặc định 7 ngày | calendar.read |
| create_calendar_event | Tạo event có attendee/location/description | calendar.write |
| delete_calendar_event | Hủy event theo Google event ID | calendar.write |

Mỗi call phải truyền workspace_id và actor_user_id. Server kiểm tra membership
active trước Google API. Client nên yêu cầu người dùng xác nhận trước create
và đặc biệt trước delete; annotation destructive là hint, không thay thế auth.

MCP docs:

- [MCP transports](https://modelcontextprotocol.io/specification/draft/basic/transports)
- [MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk)
- [MCP client connection](https://ts.sdk.modelcontextprotocol.io/v2/clients/connect)

## 7. Production/Azure

Google Cloud:

1. Dùng OAuth Web client cho domain HTTPS.
2. Nếu External đang Testing, thêm email Analyst vào Test users.
3. Hoàn thiện verification/privacy policy trước khi mở rộng user ngoài test.
4. Thêm đúng redirect:

    https://<api-domain>/api/v1/calendar/callback

Azure App Service settings:

    GOOGLE_CALENDAR_CLIENT_ID
    GOOGLE_CALENDAR_CLIENT_SECRET
    GOOGLE_CALENDAR_REDIRECT_URI
    GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY
    GOOGLE_CALENDAR_FRONTEND_URL
    GOOGLE_CALENDAR_DEFAULT_ID
    GOOGLE_CALENDAR_TIMEZONE

GOOGLE_CALENDAR_FRONTEND_URL là origin frontend, không phải backend URL.
CORS phải cho phép frontend origin. Chạy migration trước khi restart API:

    .\.venv\Scripts\python.exe -m alembic upgrade head

Callback phải đi vào backend để consume state, exchange code và mã hóa refresh
token; không chuyển OAuth callback qua Next.js.

Rollout:

1. Deploy migration và backend.
2. Check /health.
3. OAuth bằng một Analyst test.
4. Tạo, list, hủy một event test.
5. Kiểm tra log không có token.
6. Mở dần cho nhóm Analyst nhỏ.

## 8. Bảo mật và troubleshooting

- Refresh token chỉ lưu dạng Fernet ciphertext, key chỉ ở backend.
- Token bị khóa theo workspace_id + user_id.
- calendar.read không tạo/hủy; calendar.write vẫn yêu cầu membership active.
- Không đưa access token vào Agent context hoặc frontend.
- Không log description/attendee nếu không cần.
- Hủy event là destructive action; UI đã hỏi xác nhận.
- Refresh token có thể bị revoke/expire; OAuth lại khi gặp invalid_grant.
- Local stdio là trusted-local; không bind MCP HTTP vào 0.0.0.0 khi chưa có
  authentication và Origin validation.

redirect_uri_mismatch: so sánh chính xác biến redirect URI với Google Cloud,
kể cả scheme và slash cuối.

access_denied: thêm email vào Test users hoặc hoàn thiện consent verification.

not configured: kiểm tra đủ client ID, secret, redirect URI và Fernet key rồi
restart backend vì settings được cache trong process.

not connected: mở /calendar, connect đúng user/workspace và kiểm tra
X-Workspace-Id.

invalid_grant: revoke app tại [Google third-party connections](https://myaccount.google.com/connections),
xóa connection cũ rồi OAuth lại.

MCP không thấy tools: kiểm tra command, cwd, PYTHONPATH, virtualenv và stderr;
stdio server không được ghi log vào stdout.

## 9. Validation

    .\.venv\Scripts\python.exe -m ruff check backend/src/api/calendar_routes.py backend/src/services/google_calendar.py backend/src/mcp_server.py
    .\.venv\Scripts\python.exe -m pytest -q tests/test_permissions.py
    cd frontend
    pnpm typecheck
    pnpm lint
    pnpm build

CI không gọi Google Calendar thật. Integration test production dùng account và
calendar test riêng, prefix event là P170-E2E-, sau test luôn hủy event.
