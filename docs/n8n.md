# Prompt tạo workflow P-170 trên n8n

Tài liệu này chứa prompt để gửi cho AI Workflow Builder/AI Assistant ngay
trong n8n. Prompt yêu cầu n8n tạo lớp orchestration trực quan cho P-170, không
thay thế compute engine hoặc LangGraph backend hiện có.

## Cách sử dụng

1. Mở n8n và tạo workflow mới.
2. Mở AI Workflow Builder hoặc AI Assistant.
3. Copy toàn bộ prompt bên dưới và gửi cho AI.
4. Kiểm tra lại credential, URL backend, các expression và các node có side effect
   trước khi activate workflow.

## Prompt copy-paste

```text
Bạn là một n8n workflow architect. Hãy tạo một bộ workflow trực quan, có cấu
trúc rõ ràng để tích hợp với dự án P-170.

==================================================
1. BỐI CẢNH DỰ ÁN P-170
==================================================

P-170 là AI Data Profiling Agent gồm:

- Frontend Next.js ở port 3000.
- Backend FastAPI ở port 8000.
- API nghiệp vụ có prefix `/api/v1`.
- LangGraph profiling workflow xử lý ingest, compute metrics, propose metadata,
  HITL review, statistical test, drift và Q&A.
- Compute engine DuckDB/pandas/numpy/scipy là nguồn sự thật cho số liệu.
- LLM chỉ diễn giải evidence, phân loại câu hỏi và refine semantic type chưa
  chắc chắn dưới confidence cap; LLM không được tự tính metrics, không quyết định
  candidate key/PII và không được ghi dữ liệu.

n8n chỉ là lớp orchestration, integration và notification. Không được viết lại
profiling engine trong Code node của n8n và không được đưa raw dataset vào LLM.

==================================================
2. CẤU HÌNH KẾT NỐI
==================================================

Tạo một node cấu hình hoặc biến dùng chung:

P170_API_BASE_URL = http://localhost:8000/api/v1

Nếu n8n chạy trong Docker còn P-170 chạy trên máy host, dùng:

P170_API_BASE_URL = http://host.docker.internal:8000/api/v1

Nếu cả hai chạy trong Docker Compose, dùng tên service backend, ví dụ:

P170_API_BASE_URL = http://backend:8000/api/v1

Không hard-code API key trong prompt, URL credential hoặc Code node. Nếu API
token của P-170 được bật, dùng n8n credential/header authentication.

==================================================
3. MỤC TIÊU VISUAL WORKFLOW
==================================================

Hãy tạo các workflow/sub-workflow sau. Nếu n8n AI không thể tự tạo sub-workflow,
hãy tạo workflow chính trước, đặt Sticky Note mô tả các sub-workflow cần tạo,
và liệt kê rõ phần nào cần cấu hình thủ công.

A. P170 - Chat QA Agent
B. P170 - QA Read Only Tool
C. P170 - Start Profiling
D. P170 - Profile Status and Report
E. P170 - Human Review Resume
F. P170 - Error Notification

Tổ chức canvas bằng các nhóm hoặc Sticky Note theo thứ tự:

1. INPUT / TRIGGER
2. NORMALIZE INPUT
3. AI AGENT
4. READ-ONLY TOOLS
5. P-170 API
6. HUMAN REVIEW
7. OUTPUT / NOTIFICATION
8. ERROR HANDLING

Tên node phải rõ nghĩa, ví dụ:

- `Chat Trigger - P170 QA`
- `AI Agent - P170 Analyst Assistant`
- `Tool - P170 QA Read Only`
- `HTTP - POST /qa`
- `Switch - Profile Status`
- `Human Approval - Metadata Review`

Không tạo một workflow khổng lồ không có phân vùng. Mỗi workflow phải có tên,
Sticky Note mô tả mục đích và error path.

==================================================
4. WORKFLOW A — P170 CHAT QA AGENT
==================================================

Tạo flow chính:

`Chat Trigger - P170 QA`
    -> `AI Agent - P170 Analyst Assistant`
    -> output trả về giao diện chat

Kết nối vào AI Agent:

- Một Chat Model, ví dụ OpenAI Chat Model hoặc model tương thích.
- Một Simple Memory để giữ context theo session.
- Tool `P170 QA Read Only Tool`.

System Message của AI Agent:

Bạn là P-170 Analyst Assistant.

Quy tắc bắt buộc:

1. Chỉ dùng số liệu trong output của P-170 hoặc read-only tool.
2. Không bịa số liệu và không suy luận raw row không được cung cấp.
3. Với câu hỏi quantitative, luôn gọi `P170 QA Read Only Tool` trước khi trả lời.
4. Với câu hỏi qualitative, dùng report/evidence đã lưu nếu tool trả về nguồn.
5. Nếu không có evidence, trả lời rõ: "Chưa có evidence để kết luận."
6. Không được gọi PATCH, DELETE hoặc bất kỳ tool ghi dữ liệu nào.
7. Không tự confirm, edit, reject proposal hoặc request statistical test.
8. Không hiển thị PII sample value hoặc raw dataset.
9. Trích dẫn hoặc nêu rõ source/artifact mà câu trả lời dựa trên nếu API trả về.
10. Trả lời bằng tiếng Việt, có cấu trúc:

   - Kết luận ngắn.
   - Evidence chính.
   - Giới hạn hoặc cảnh báo nếu có.

Đặt Prompt/User Message của AI Agent lấy từ Chat Trigger. Không đặt câu hỏi
người dùng cố định trong System Message.

==================================================
5. WORKFLOW B — P170 QA READ ONLY TOOL
==================================================

Tạo sub-workflow có các node:

`When Executed by Another Workflow`
    -> `Validate QA Input`
    -> `HTTP - POST P170 /qa`
    -> `Normalize QA Output`
    -> return output của sub-workflow

Input bắt buộc:

- `question`: string
- `profile_run_id`: string hoặc null

HTTP Request:

- Method: POST
- URL: `{{$json.P170_API_BASE_URL}}/qa`
- Send Body: JSON

Body:

{
  "question": "={{ $json.question }}",
  "profile_run_id": "={{ $json.profile_run_id }}",
  "stream": false
}

Tool description cho AI Agent:

Đọc aggregate metadata, report, test result và drift evidence của P-170.
Tool này chỉ đọc dữ liệu đã lưu, không trả raw row, không chạy arbitrary SQL,
không chạy Python và không thực hiện side effect.

Nếu API trả status lỗi, sub-workflow phải trả object có cấu trúc:

{
  "ok": false,
  "error": true,
  "message": "...",
  "source": "p170_qa"
}

Nếu thành công, giữ lại các field quan trọng như:

- `answer`
- `question_type`
- `answer_sources`
- `profile_run_id`
- `terminal_result` nếu có

Không đưa toàn bộ response lớn vào prompt nếu không cần thiết. Chỉ trả phần
bounded evidence cần cho câu hỏi.

==================================================
6. WORKFLOW C — P170 START PROFILING
==================================================

Tạo flow:

`Webhook hoặc Form Trigger - Dataset Upload`
    -> `Validate File Metadata`
    -> `HTTP - POST P170 /datasets/upload`
    -> `HTTP - POST P170 /profile`
    -> `Switch - Initial Profile Status`

Upload request:

- Method: POST
- URL: `{{$json.P170_API_BASE_URL}}/datasets/upload`
- Gửi file dạng multipart/form-data.
- Không đọc raw rows trong Code node.

Sau khi upload thành công, lấy `dataset_ref` từ response và gọi:

- Method: POST
- URL: `{{$json.P170_API_BASE_URL}}/profile`
- Body JSON:

{
  "dataset_ref": "={{ $json.dataset_ref }}",
  "dataset_name": "={{ $json.dataset_name }}",
  "scan_mode": "={{ $json.scan_mode || 'full' }}",
  "question": "={{ $json.question || '' }}"
}

Switch theo `status`:

- `pending_review` -> chuyển sang Human Review workflow.
- `completed` -> lấy report và trả kết quả.
- `running`, `created`, `resuming` -> polling có giới hạn hoặc trả trạng thái
  đang xử lý; không loop vô hạn.
- `failed` -> chuyển Error Notification workflow.

Không tự động confirm proposal trong workflow này.

==================================================
7. WORKFLOW D — PROFILE STATUS AND REPORT
==================================================

Tạo flow:

`Webhook - Get Profile Report`
    -> `Validate profile_run_id`
    -> `HTTP - GET P170 /profile/{run_id}`
    -> `Edit Fields - Report Response`
    -> `Respond to Webhook`

Endpoint:

`{{$json.P170_API_BASE_URL}}/profile/{{$json.profile_run_id}}`

Chỉ trả các field cần cho client hoặc notification:

- `profile_run_id`
- `dataset_name`
- `status`
- `row_count`
- `column_count`
- `pending_proposals`
- `narrative_report`
- `risk_warnings`
- `test_results`
- `answer`
- `answer_sources`

Không trả raw uploaded file hoặc raw dataset rows.

Nếu gửi qua Slack/email, format report thành Markdown dễ đọc. Giữ nguyên các
tiêu đề section như Uniqueness, Cardinality, Outlier và các mục con.

==================================================
8. WORKFLOW E — HUMAN REVIEW RESUME
==================================================

Đây là flow có side effect và bắt buộc có human approval.

`Webhook/Form - Analyst Decision`
    -> `HTTP - GET P170 Profile`
    -> `IF - status == pending_review`
    -> `Human Approval / Wait`
    -> `HTTP - PATCH P170 /profile/{run_id}/confirm`
    -> `HTTP - GET Updated Profile`
    -> output

Payload confirm:

{
  "confirmed_by": "={{ $json.confirmed_by }}",
  "action": "={{ $json.action }}",
  "decisions": "={{ $json.decisions || [] }}",
  "test_requests": "={{ $json.test_requests || [] }}",
  "resume": true
}

Chỉ cho phép action:

- `confirm`
- `edit`
- `reject`
- `request_test`

Không cho AI Agent tự chọn action cuối cùng. Analyst phải xác nhận qua UI,
form, Slack approval, email approval hoặc node Wait/Human-in-the-loop.

Với `request_test`, giữ `test_requests` ở top-level; không gắn test request
vào từng proposal.

Tôn trọng `Idempotency-Key` khi gọi PATCH để retry không áp dụng quyết định
hai lần.

==================================================
9. WORKFLOW F — ERROR NOTIFICATION
==================================================

Tạo error path dùng Error Trigger hoặc nhánh lỗi của HTTP Request.

Error output tối thiểu:

{
  "ok": false,
  "workflow": "={{ $workflow.name }}",
  "execution_id": "={{ $execution.id }}",
  "node": "={{ $json.node || '' }}",
  "message": "={{ $json.message || 'Unknown error' }}"
}

Không đưa API key, access token, raw PII hoặc raw dataset vào notification.

==================================================
10. VISUALIZATION VÀ DEBUGGING
==================================================

Canvas phải cho người mới nhìn thấy rõ:

- Main data path nối bằng dây chính.
- Chat Model, Memory và Tools nối vào cổng phụ của AI Agent.
- Read-only tools nằm trong vùng riêng.
- Human approval và side effect nằm trong vùng riêng, màu/Sticky Note khác.
- Error path đi xuống hoặc sang phải, không cắt ngang main path.

Sau mỗi lần test, hãy để workflow dễ kiểm tra trong tab Executions. Không tạo
node Code chỉ để che giấu logic; nếu dùng Code, đặt tên và thêm Sticky Note mô
tả input/output.

Nếu cần biểu đồ dữ liệu, tạo output JSON bounded để gửi sang Google Sheets,
PostgreSQL, Metabase hoặc frontend dashboard. Không coi canvas n8n là dashboard
phân tích dữ liệu.

==================================================
11. ĐIỀU KIỆN HOÀN THÀNH
==================================================

Sau khi dựng workflow, hãy trả về:

1. Danh sách workflow đã tạo.
2. Danh sách node của từng workflow.
3. Sơ đồ kết nối dạng text.
4. Các credential cần người dùng cấu hình.
5. Các URL/API expression đang dùng.
6. Các chỗ cần người dùng kiểm tra thủ công.
7. Test case để chạy thử:
   - Hỏi một câu quantitative.
   - Hỏi một câu qualitative.
   - Gọi profile với dataset hợp lệ.
   - Kiểm tra trạng thái pending_review.
   - Thử lỗi API/404.
8. Nêu rõ node nào có side effect và cách human approval bảo vệ node đó.

Nếu một node hoặc tính năng không tồn tại trong phiên bản n8n hiện tại, không
được tự bịa tên node. Hãy dùng node built-in gần nhất, ghi rõ khác biệt và
hướng dẫn cấu hình thủ công.
```

## Cấu trúc trực quan mong muốn

```text
P170 - Chat QA Agent

Chat Trigger
    │
    ▼
AI Agent ────────────────┐
    ▲                     │
    ├── Chat Model        ▼
    ├── Simple Memory   QA Read-only Tool
    │                         │
    └─────────────────────────┘
                              │
                              ▼
                    P-170 POST /api/v1/qa
```

```text
P170 - Start Profiling

Upload/Webhook
    │
    ▼
POST /datasets/upload
    │
    ▼
POST /profile
    │
    ▼
Switch status
    ├── completed      → GET report → Respond
    ├── pending_review → Human approval workflow
    ├── running        → bounded polling/status response
    └── failed         → Error Notification
```

Mục tiêu của thiết kế là để n8n hiển thị rõ agent đang nhận input, sử dụng
tool nào, gọi P-170 API ở đâu, chờ Analyst review ở đâu và trả kết quả ở đâu.
