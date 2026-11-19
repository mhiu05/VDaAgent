# 17 · Kiểm thử

**Phụ thuộc:** mọi tài liệu khác. Các test kiểm tra những bất biến và hành vi mô tả ở [03](03-agent-loop.md)–[15](15-api.md).

## Hiện trạng

| Ở đâu | Chạy gì hôm nay |
|---|---|
| `make test` (compose, xem bên dưới) | `pytest` của backend (unit test cho settings, preflight, `setup` (`backend.init_env`), `/api/health` và thứ tự khởi động; test schema và bất biến trong `backend/tests/db` với `postgres` thật; kiểm tra tích hợp với `postgres` và `workspace` thật), test `execd`, và bộ Vitest + bộ test domain cũ của frontend |
| CI, job Python (`.github/workflows/ci-cd.yml`) | `uv run pytest -v` với `MODEL_BACKEND=fake` và `DATABASE_URL` trỏ tới service `postgres:17` (`contoso_test`), rồi test `execd` trong môi trường uv riêng. Không có key OpenAI |
| CI, job frontend | `npm ci`, `npm run lint`, `npm run build`, `npm test`, `npm run test:domain` trên Node 24 |
| Máy local, `frontend/` | `npm test` (Vitest, `src/**/*.test.{ts,tsx}` và `tests/**/*.test.{ts,tsx}`, jsdom); `npm run test:domain` (chỉ bộ test cũ `src/**/*.test.mjs`); `npm run test:browser` (hành trình Playwright trong `frontend/tests/*.spec.ts`, chạy Vite riêng trên cổng 5179). Xem [14g](14g-frontend-development.md). |

## Test chạy ở đâu

**Trạng thái:** Đã triển khai (mọi dòng). Mọi thứ chạy trong compose, nên test thấy cùng Postgres, mạng và filesystem như production:

| Lệnh | Chạy |
|---|---|
| `docker compose -f docker-compose.yml -f compose.test.yaml run --rm backend pytest` | unit + integration của backend (DB `contoso_test` mới, `MODEL_BACKEND=fake`, không đặt key Langfuse) |
| `docker compose ... run --rm workspace pytest /opt/execd/tests` | test `execd` và `contoso` |
| `docker compose ... run --rm frontend-test` | Vitest (image node, `frontend/`) |
| `make e2e` | Playwright trên một stack chế độ giả mới |
| `make test-live` (`pytest -m live`, tự chọn) | test hợp đồng live với OpenRouter; cần `OPENROUTER_API_KEY` |

`make test` xóa project test còn sót, chạy ba dòng đầu, rồi xóa lại (volume `folders` mới bắt đầu với cache uv trống; không có gì được nạp sẵn). `compose.test.yaml` đặt tên project `contoso-test`, nên test không bao giờ đụng tới container hay volume của stack dev. Nó build stage `test` của image backend và workspace (thư viện dev và test), cho `postgres` thư mục dữ liệu tmpfs với DB `contoso_test` (`deploy/postgres/test-init/`), và thêm `frontend-test` (stage `source` của image frontend, profile `test`). Service `fixtures` (`python -m http.server` trên mạng `exec`) phục vụ volume `fixtures`: test ghi tarball kỹ năng vào `/fixtures/<owner>/<repo>/tar.gz/<sha>` và trỏ `SKILLS_CODELOAD_URL` tới `http://fixtures:8080` (`CONTOSO_TEST_FIXTURES_URL`).

**Fixture database** (`backend/tests/conftest.py`, S1). Mỗi lần chạy, `migrated_url` xoá và tạo lại database mà `DATABASE_URL` trỏ tới (nó từ chối tên không chứa `_test`) rồi chạy `alembic upgrade head`. `engine` dùng chung cho cả lần chạy; `conn` cho mỗi test một kết nối trong một transaction được rollback sau đó, nên các test không thấy dòng của nhau. Test chờ một vi phạm sẽ chạy câu lệnh trong một savepoint (`backend/tests/dbutil.py`) và kiểm tra tên ràng buộc. `backend/tests/db/test_schema.py` kiểm tra migration và `tables.py` khớp nhau: autogenerate không thấy khác biệt, và catalog sau migration (cột, ràng buộc, index, trigger, function) bằng với `metadata.create_all` trong một database nháp.

## FakeModel

Với `MODEL_BACKEND=fake`, `harness/model.py` dùng một `httpx.MockTransport` trả lời các request chat completion theo một file **kịch bản**:

```yaml
# backend/tests/scenarios/golden.yaml
agents:
  lead:
    - match: {input_contains: "<begin_task"}
      reply: {tool: "from contoso import send_to_agent\nsend_to_agent(['data'], 'Lấy số liệu căn MAS-U03832 và 20 căn cùng phân khu')"}
    - reply: {text: "Đã giao việc."}                       # Done
    - match: {input_contains: "from=\"agent:data\""}
      reply: {tool: "from contoso import send_to_user, end_task\nsend_to_user('Kết quả…', files=['files/chart.png'], final=True)\nend_task('đã trả lời')"}
  data:
    - reply: {tool: "open('files/units.csv','w').write('unit,price\\nMAS-U03832,52\\n')\nprint('ok')"}
    - reply: {tool: "from contoso import send_to_agent\nsend_to_agent(['lead'], 'Xong: files/units.csv')"}
    - reply: {text: "done"}
jev:
  - match: {message_contains: "Vì sao"}
    label: task
  - label: side_question
usage: {prompt_tokens: 1000, completion_tokens: 50, cached_tokens: 900, cost: 0.0001}
```

- **Chọn phản hồi.** Phản hồi của mỗi agent được dùng theo thứ tự. Phản hồi có `match` sẽ chờ tới khi message user/tool cuối cùng thoả điều kiện. Trước đó (và khi kịch bản đã hết) agent nhận một lượt rỗng không có tool call, khiến activation kết thúc. Agent được xác định bằng header `X-Contoso-Agent` ([03](03-agent-loop.md#gọi-model)). File kịch bản là `MODEL_SCENARIO` (mặc định `backend/tests/scenarios/golden.yaml`).
- **jev và usage.** Lời gọi jev đi qua một route riêng dạng Decisions API (`X-Contoso-Purpose: jev`), được `match` so khớp với `state` đã render thay vì một message chat; `confidence:` theo từng rule (tuỳ chọn, mặc định `1.0`) dùng để kiểm tra `JEV_CONFIDENCE_FLOOR`. Chat completion mang `usage` đã cấu hình; route Decisions ánh xạ cùng `prompt_tokens`/`completion_tokens`/`cost` thành `input_tokens`/`output_tokens`/`cost`.
- **Ghi lại.** Transport ghi lại mọi request, để test kiểm tra được `messages` đã render, kể cả việc tiền tố ổn định từng byte.

## Unit test (`backend/tests/unit`)

| Phần | Hành vi được kiểm tra |
|---|---|
| Render | ánh xạ event → message; tiền tố cũ giống hệt từng byte sau khi nối thêm; chuỗi `tool` → `user`; điểm cache Anthropic chỉ cho `anthropic/*` |
| `current_state` | dòng cho lead và cho agent khác; `task: none`; số lượng việc đang chờ |
| Offload | biên ngưỡng (8.000 so với 8.001 ký tự); kích thước đầu/đuôi; file được ghi; offload hàng loạt bỏ qua kết quả mới nhất và đánh dấu `batch_offloaded_at` |
| Giới hạn context | ngưỡng mềm → compaction chờ; ngưỡng cứng → offload hàng loạt; tràn → `error` + task `failed` + tin hệ thống tới người dùng |
| jev | câu trả lời `choice` có kiểu; ngưỡng confidence ép về `side_question`; hết giờ / response hỏng / lỗi model → `side_question` + `fallback`; `task` ghi một task queued lấy tiêu đề từ văn bản tin nhắn; context chỉ dùng message event (không có output tool) và tuân theo `JEV_K` |
| Hàng đợi | tối đa một task chạy cho mỗi người dùng (unique index báo lỗi); FIFO; notice huỷ và hết giờ tới lead và mọi agent đã tham gia |
| Điểm an toàn | compaction bị từ chối khi đang tham gia task đang chạy; được phép sau `end_task` |
| Lịch chạy | parse cron; lần chạy kế tiếp theo `Asia/Ho_Chi_Minh`; tới hạn nhiều lần gộp thành một; lần lỡ khi khởi động → một lần chờ |
| Exec token | sai agent, sai exec, hết hạn, sau 5 s ân hạn → 401 |
| Cờ final | `final=True` + exit 0 → rảnh mà không gọi model; `final=True` + exception → vòng lặp tiếp tục |
| Trình xem thư mục | `..`, đường dẫn tuyệt đối, symlink trỏ ra ngoài → 400; giá trị `.env.d` bị che trong file, cây và file nén |
| Kiểm tra miền | thiếu `.env`, key rỗng, key trùng giữa các bộ, agent mẫu ghi preset không tồn tại → `unavailable` chỉ kèm tên |
| Xác thực | kiểm tra argon2; hết hạn trượt; tài nguyên của người khác → 404; người dùng vào route admin → 403; thiếu `X-Contoso-Client` → 403 |
| Kho | kiểm tra seed (ref không ghim, argv không phải `contoso.skills`) tắt marketplace |

## Test tích hợp harness (`backend/tests/integration`)

Dùng Postgres thật, `execd` thật (service `workspace`) và kịch bản FakeModel:

1. **Luồng chuẩn:** người dùng → lead (jev `task`) → `begin_task` → `send_to_agent(data)` → Data ghi file và trả lời → lead `send_to_user(..., files, final=True)` → `end_task`. Kiểm tra: tin nhắn, delivery, involvement, bản sao và sha256 của tệp đính kèm, task `done`, trace id trên mọi dòng.
2. **Hội thoại nhóm:** tin của người dùng trong nhóm có lead, data, chart tới cả ba (bản của lead qua jev); trả lời của một agent trong nhóm tới các agent khác và người dùng.
3. **Lịch chạy giữa task:** agent không tham gia chạy lịch của nó trong lúc task của người dùng chạy; lịch của agent đang tham gia chờ tới khi khối công việc hiện tại kết thúc.
4. **Compaction ở điểm an toàn:** vượt ngưỡng mềm giữa task → chờ; chỉ chạy sau `end_task`; epoch mới có `start_seq` sau các event compaction; system prompt đọc lại `memory/index.md`.
5. **Khởi động lại giữa activation:** giết runner trong lúc exec; khi khởi động, `tool_result` ghi `lost`, notice được gửi, task đang chạy vẫn chạy.
6. **Chống deadlock:** trong lúc T1 chạy, Data nhờ lead giúp; kịch bản jev trả `side_question`; không có gì được xếp hàng.
7. **Builder:** áp dụng preset (`uv add`, tải vào cache uv dùng chung), cài kỹ năng từ server fixtures, sửa prompt. Mỗi thao tác tạo một commit `user:<name>` và một notice; sửa prompt → compaction chờ.
8. **Cấp phát:** tạo người dùng `fabrikam` sinh ra lead cộng năm agent mẫu, mỗi agent có liên kết `.env.d`, `baseline_commit` và hội thoại trực tiếp.

## Test `execd` (`workspace/tests`)

- Hết giờ giết cả nhóm tiến trình (một tiến trình con `sleep` chạy nền cũng biến mất).
- `RLIMIT_AS` làm một lần cấp phát lớn thất bại; output quá 10 MB bị cắt kèm dấu cắt.
- Môi trường có key từ `.env.d` và `env_extra`, và không kế thừa môi trường của tiến trình cha.
- Snapshot: có thay đổi → commit mới với tác giả; không thay đổi → head giữ nguyên và `changed: []`; chỉ đụng đường dẫn bị bỏ qua → `[]`; `index.lock` cũ → `snapshot_error`, và kết quả exec vẫn được trả về.
- Trình cài `contoso.skills`: chỉ giải nén đúng đường dẫn, từ chối `..`/tuyệt đối/symlink trỏ ra ngoài, yêu cầu frontmatter `SKILL.md`, thay thư mục một cách nguyên tử.

## Test hợp đồng live (`-m live`)

**Trạng thái:** Đã triển khai (`make test-live`, bị loại khỏi `make test`; `backend/tests/live/`). Dùng key OpenRouter thật:
- Một activation với `openai/gpt-4o-mini` và một với `anthropic/claude-haiku-4.5`, mỗi cái kết thúc bằng một message tool `final` rồi tới một message user mới. Nhà cung cấp chấp nhận cấu trúc này.
- Có `usage.cost` và `usage.prompt_tokens_details.cached_tokens`.
- jev với `JEV_MODEL` trả về câu trả lời Decisions API đúng schema: `choice in {"task", "side_question"}`, `confidence` trong `[0, 1]`.

## End-to-end (Playwright, chế độ giả)

**Trạng thái:** Đã triển khai (`make e2e`: mỗi lần chạy một stack chế độ giả mới, server `fixtures` được seed tarball kỹ năng từ catalog, Playwright headless trong `e2e/`; khi lỗi, screenshot, video và trace nằm trong `e2e-results/`).

1. Đăng nhập admin → tạo người dùng `alice` (fabrikam) → cấp phát hoàn tất.
2. Đăng nhập `alice` → lead được ghim → gửi câu hỏi chuẩn → trả lời kèm tệp đính kèm `units.csv` (file của golden scenario, hiện xem trước CSV) xuất hiện; banner task hiện đang chạy, rồi biến mất.
3. Tạo nhóm "Nhóm báo cáo Q3" với data và report → gửi tin → trạng thái của cả hai agent thay đổi.
4. Builder: áp dụng preset "Phân tích dữ liệu" → toast xong → bảng package có `pandas`; cài kỹ năng `xlsx` từ server fixtures → "Đã cài".
5. Trình xem thư mục: `.env.d/warehouse.env` chỉ hiện tên key (giá trị `••••`); đổi "Phiên bản" sang phiên bản trước khi áp preset thì thấy `pyproject.toml` cũ (kèm diff lịch sử).
6. Đăng nhập admin → trace của lead của alice hiện các lời gọi Python và link "Mở trong Langfuse"; trace của agent data hiện `files/units.csv` đã thay đổi kèm diff (harness tự commit bản sao inbox, nên exec của lead không đổi file); đánh dấu một quyết định jev là gắn nhãn sai.
7. Nút đổi giao diện chuyển qua lại giữa token sáng và tối.

## Nghiệm thu live thủ công

Trên kho `fabrikam` thật với key thật: câu hỏi chuẩn *"Vì sao căn MAS-U03832 bán chậm? So sánh với các căn tương đồng, vẽ biểu đồ và xuất báo cáo."* cho ra câu trả lời có ít nhất một biểu đồ và một file báo cáo. Trace hiện trong Langfuse kèm chi phí. Task của lead kết thúc `done`.

## Test frontend (Vitest)

**Trạng thái:** Đã có (mock) với các bộ test hiện có. Test component và tích hợp hiện tại (Vitest, TS/TSX, jsdom), bộ test domain `.test.mjs` cũ và các hành trình Playwright được giữ lại khi adapter API ra đời ([14g](14g-frontend-development.md)).

**Trạng thái:** Dự kiến. Test logic thuần mục tiêu, thêm cùng adapter API: reducer cập nhật cache từ event SSE, đếm chưa đọc, chuyển đổi bộ chọn lịch → cron, quy tắc khoá lựa chọn, phân giải giao diện (`system` → `prefers-color-scheme`).
