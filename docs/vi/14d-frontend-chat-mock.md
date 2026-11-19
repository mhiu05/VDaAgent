# 14d · Chat mock và kịch bản Riverside

**Phụ thuộc:** [14](14-frontend.md), [14c](14c-frontend-adapters.md), [14e](14e-report-viewer.md)

**Trạng thái:** Đã có (mock)

> Trang này mô tả màn hình chat mock hiện tại ("Agent Fleet") tại `/chat`. UX chat mục tiêu nằm trong [14](14-frontend.md) và khác ở các điểm: 6 agent cố định gồm `orchestrator` so với lead + starter + agent người dùng tạo; inspector so với info pane; content block so với Markdown, attachment, choice chip và `report_refs`; bỏ lệnh `/report` và @mention; `?conversation=` so với `/chat/:threadId`. Xem [hiện trạng so với mục tiêu](14-frontend.md#hiện-trạng-so-với-mục-tiêu).

Runtime mặc định dùng mock: catalog năng lực, câu trả lời và kết quả Riverside là dữ liệu mô phỏng. Các trường `tools`/`mcp` trong inspector mô tả cấu hình công khai, không xác nhận kết nối hoặc thực thi công cụ thật.

## Sáu agent

| ID | Vai trò trình bày |
| --- | --- |
| `orchestrator` | Điều phối và tổng hợp. |
| `data` | Kiểm tra dữ liệu và chất lượng. |
| `compare` | Đối chiếu snapshot. |
| `chart` | Trực quan hóa. |
| `insight` | Nhận định và ưu tiên. |
| `report` | Báo cáo điều hành. |

Model nằm trong [`chat/model/types.ts`](../../frontend/src/features/chat/model/types.ts); catalog mock nằm trong [`mocks/chat/fixtures.ts`](../../frontend/src/mocks/chat/fixtures.ts). Capability có bốn giá trị `available`, `demo`, `unsupported`, `unknown`. `canUse` chỉ bật hành vi cho hai giá trị đầu.

## Bố cục và điều hướng

Sidebar tìm agent/hội thoại, chọn trao đổi riêng, nhóm demo và lịch sử. Timeline là vùng nội dung trung tâm. Inspector hiển thị tổng quan, skill, tool, MCP, nguyên tắc công khai và capability; các vùng phụ trở thành drawer trên màn hình hẹp theo CSS của chat.

Query `conversation` giữ thread được chọn, ví dụ:

```text
/chat?conversation=riverside-r010-group
```

Chọn thành viên trong nhóm Riverside mở thread riêng cùng scenario. Action quay lại nhóm mở hội thoại nhóm tương ứng. Việc chọn agent không khởi động một worker backend.

## Nguồn dữ liệu Riverside

| Nguồn | Vai trò |
| --- | --- |
| [`report.json`](../../frontend/src/mocks/reports/data/riverside-r010-v2/report.json) | Snapshot chuẩn, KPI, biểu đồ, findings, actions và metadata báo cáo. |
| [`riverside-adapter.ts`](../../frontend/src/mocks/reports/riverside-adapter.ts) | Ánh xạ fixture sang schema được kho báo cáo sử dụng. |
| [`riverside-scenario.json`](../../frontend/src/mocks/chat/data/riverside-scenario.json) | Kịch bản hội thoại khai báo, gồm nhóm và sáu thread riêng. |
| [`riverside-selectors.ts`](../../frontend/src/mocks/chat/riverside-selectors.ts) | Projection chỉ đọc từ report fixture/schema; cung cấp số liệu và binding văn bản cho chat. |
| [`riverside-scenario.ts`](../../frontend/src/mocks/chat/riverside-scenario.ts) | Chuyển narrative thành conversation/message/block của ứng dụng. |

Scenario ID nội bộ là `riverside-inventory-r010-agent-demo-v2`, nhóm là `riverside-r010-group`, report reference của ứng dụng là `{ reportId: 'R010', versionId: 'R010-v2' }`. ID gốc trong JSON báo cáo là `riverside-inventory-r010`; mock adapter ánh xạ nó vào registry `R010` hiện có.

Trong mock scenario mặc định `success`, `withRiversideConversations` bổ sung thread Riverside còn thiếu vào bundle đã lưu. Nó giữ nguyên thread cùng ID đã tồn tại. Vì vậy dữ liệu đã chỉnh/lưu từ một phiên trước có thể khác lần khởi tạo mới; reset demo khi cần trở về fixture.

`scenarioId` của hội thoại không phải giá trị query `scenario` được bootstrap chấp nhận. Không dùng `?scenario=riverside` để chọn kịch bản này; dùng URL `conversation` ở trên trong runtime mặc định.

## Những invariant của số liệu

Snapshot Riverside chốt tại `2026-10-15T23:59:00+07:00`. Đây là thời gian dữ liệu mẫu, không phải thời gian tác vụ vừa chạy.

| Chỉ tiêu | Mốc trước | Mốc hiện tại |
| --- | --- | --- |
| Căn khả dụng | 66 | 60 |
| Căn đủ dữ liệu tuổi tồn | 64 | 56 |
| Căn chưa rõ tuổi | 2 | 4 |
| Căn tồn từ 180 ngày | 18 | 20 |
| Tỷ lệ tồn lâu trên tập đủ tuổi | 28,1% | 35,7% |

Tỷ lệ tồn lâu hiện tại là `20/56`, tăng khoảng 7,6 điểm phần trăm so với `18/64`. Độ đầy đủ tuổi tồn là `56/60 = 93,3%`. Bốn căn chưa rõ tuổi vẫn thuộc tổng tồn; không được gán tuổi bằng 0. Tỷ trọng `20/60` trên toàn bộ tồn là một chỉ tiêu khác.

Không có ngày chốt mốc trước; hai snapshot không được xem như cùng một tập căn cố định. Fixture không có đủ giá, CRM hay giao dịch để kết luận nguyên nhân. Các action P0–P2 là đề xuất, chưa được phê duyệt hoặc giao việc.

## Nội dung tin nhắn

`Message` giữ ID, author, timestamp, state, sequence và có thể có `blocks`, `surface`, `source`, `dataThrough`, evidence, artifact hoặc contributions. Với Riverside, message được project thành kết quả công khai, `source: 'mock_fixture'`, trạng thái hoàn tất.

`AgentContentBlock` tái sử dụng `SchemaBlock` của reports và bổ sung:

| Kind | Hành vi |
| --- | --- |
| `details` | Disclosure chứa các block con. |
| `report-ref` | Thẻ tham chiếu đúng report/version. |
| `action` | Đi tới report hoặc nhóm. |

KPI và chart dùng component dùng chung với reports; cùng nguồn số liệu phục vụ chat và viewer. `ReportReferenceCard` vẫn đọc `ReportsService.detail` để lấy status, metadata và nội dung thẻ; không suy ra trạng thái báo cáo từ câu chữ của narrative.

Markdown và liên kết đi qua renderer/policy của ứng dụng. Decoder/validator chỉ nhận nội dung trình bày công khai; không đưa private trace hoặc raw agent-to-agent payload vào timeline.

## Gửi tin và `/report`

Trong hội thoại Riverside, nhập câu hỏi mới hiển thị thông báo rằng chưa có model trả lời, giữ draft và không đi vào đường trả lời cố định của hội thoại thông thường.

[`resolveMockCommand`](../../frontend/src/features/chat/model/commands.ts) chỉ nhận `/report` khi conversation có đúng scenario/reference Riverside. `/report` không có nội dung hoặc yêu cầu phù hợp Riverside/R010 được xử lý như sau:

1. Xóa draft lệnh đã xử lý.
2. Nếu thread có tin chứa `report-ref`, cuộn và focus tin đó.
3. Nếu không có tin tham chiếu nhưng có `reportRef`, mở viewer của bản đã lưu.

Lệnh không tạo báo cáo mới, không phát generation event và không chạy lại phân tích. Yêu cầu không khớp report được hỗ trợ hoặc lệnh dùng trong thread khác hiển thị thông báo chưa hỗ trợ.

Thẻ và nút báo cáo trỏ tới `/reports?report=R010&version=R010-v2&view=dashboard` (tổng quan báo cáo), giữ query `scenario` nếu có. Navigation state lưu chat origin và message focus để đóng viewer có thể quay lại đúng ngữ cảnh. Khi mở URL trong tab mới hoặc reload mất navigation state, report/version vẫn được xác định từ URL; luồng đóng có fallback về kho báo cáo.

## Hội thoại demo thông thường

Thread mới không có `scenarioId` dùng `ChatService.send` và câu trả lời cố định. Mock có các scenario replay, duplicate, out-of-order, interrupted, unknown acknowledgement và offline để kiểm tra vòng đời. Đó không phải bằng chứng đã tích hợp stream/backend thật.

Attachment chỉ giữ metadata và file trong bộ nhớ của phiên; sau khi khôi phục draft từ storage cần đính kèm lại. File không được upload hay phân tích. Retry/cancel phụ thuộc capability; abort subscription và yêu cầu cancel là hai hành động khác nhau. Hợp đồng transport nằm trong [14c](14c-frontend-adapters.md).

## Kiểm tra liên quan

[`riverside-fleet.test.ts`](../../frontend/src/features/chat/tests/riverside-fleet.test.ts) và [`riverside-ui.test.tsx`](../../frontend/src/features/chat/tests/riverside-ui.test.tsx) kiểm tra projection và UI. [`agent-fleet.spec.ts`](../../frontend/tests/agent-fleet.spec.ts) và [`riverside.spec.ts`](../../frontend/tests/riverside.spec.ts) kiểm tra các hành trình browser, gồm liên kết tới report viewer. Xem [14g](14g-frontend-development.md) để chọn lệnh chạy.
