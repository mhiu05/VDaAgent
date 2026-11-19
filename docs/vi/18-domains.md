# 18 · Các miền đi kèm PoC

Hai miền chứng minh các miền được tách biệt. Mỗi miền có bộ credentials riêng và agent mẫu riêng. **Phụ thuộc:** [12](12-auth-and-domains.md), [04](04-agent-folder.md), [05](05-agent-builder.md).

Agent mẫu là **tối thiểu**: một prompt, preset thư viện và bộ credentials. Chúng không kèm kỹ năng hay lịch chạy; người dùng và agent bổ sung dần theo thời gian. Dưới đây, mỗi agent chỉ được mô tả bằng mục tiêu của nó. Đạt mục tiêu bằng cách nào là việc của agent, prompt và thư mục của nó; code thì giống nhau cho mọi agent.

## `fabrikam`: Fabrikam Sales Ops

**Ai dùng.** Nhân viên Sales Ops phân tích vì sao căn bán chậm, so với các căn tương tự thế nào, và cần báo cáo gì lên quản lý.

**Dữ liệu.** Kho dữ liệu bất động sản của team DATA: database PostgreSQL `cdw`, đọc qua một role chỉ đọc. Agent chỉ làm việc trên dữ liệu role đó nhìn thấy; miền quyết định phạm vi.

**Câu hỏi chuẩn.** *"Vì sao căn MAS-U03832 bán chậm? So sánh với các căn tương đồng, vẽ biểu đồ và xuất báo cáo."*

### Bộ credentials

| Bộ | Key | Dùng bởi |
|---|---|---|
| `warehouse` | `WAREHOUSE_DSN` (`postgresql://<role đọc>:<mật khẩu>@<host>:<port>/cdw`), `WAREHOUSE_SNAPSHOT_ID` (vd `SNAP-20260630-01`) | data, compare |
| `web-search` | `TAVILY_API_KEY` | data (tin thị trường, tuỳ chọn) |

### Agent mẫu

| Slug | Tên hiển thị | Mục tiêu | Preset | Credentials |
|---|---|---|---|---|
| `lead` (ghi đè) | Điều phối | Hiểu câu hỏi của người dùng, chia việc cho nhóm, gộp kết quả thành một câu trả lời rõ ràng bằng tiếng Việt, và gửi kèm biểu đồ và báo cáo. Nói rõ phần còn thiếu thay vì đoán | — | — |
| `data` | Data | Lấy dữ kiện từ kho: thuộc tính, lịch sử bán và trạng thái của căn, dự án và phân khu của nó, các căn ứng viên tương đồng, và bối cảnh thị trường. Giá trị thiếu thì báo là thiếu, không bao giờ là 0 | `data`, `postgres` | `warehouse`, `web-search` |
| `insight` | Insight | Giải thích vì sao căn bán chậm từ dữ liệu được cung cấp: vị thế giá, thuộc tính, các điểm cản trở bán hàng. Trình bày phát hiện là tương quan, không phải nguyên nhân | `data`, `stats` | — |
| `compare` | Compare | Chọn nhóm so sánh công bằng (cùng dự án/phân khu, diện tích thông thuỷ và loại căn tương tự, ít nhất 5 căn), so sánh căn với nhóm, và báo "không đủ dữ liệu so sánh" thay vì bịa nhóm | `data`, `stats`, `postgres` | `warehouse` |
| `chart` | Chart | Biến phát hiện thành biểu đồ PNG rõ ràng, nhãn và đơn vị tiếng Việt (vd giá/m² so với căn tương đồng) | `data`, `charts` | — |
| `report` | Report | Viết bản nháp báo cáo (DOCX và PDF) gồm câu hỏi, phát hiện, biểu đồ và lưu ý về dữ liệu; mọi con số lấy từ các file nhóm đã tạo. Đăng báo cáo vào thư viện báo cáo của người dùng bằng `contoso.start_report` / `contoso.publish_report` (payload schema v1 cùng các artifact DOCX/PDF, [19](19-reports-dashboard-notifications.md)) | `documents` | — |

### Dòng kho của miền

Kho của miền chưa có kỹ năng riêng. Nó dùng các kỹ năng toàn cục `xlsx`, `docx`, `pdf` và `pptx`. Sau này có thể thêm một kỹ năng `fabrikam` là từ điển dữ liệu của các bảng trong kho; nó sẽ là một repo GitHub liệt kê trong `domains/fabrikam/seeds/skills.yaml`.

## Thêm một miền

1. Tạo `domains/<id>/domain.yaml` với `{id, name}`.
2. Thêm các file `credentials/<set>.env.example` (dòng đầu `# description: …`). Người vận hành viết `<set>.env` tương ứng.
3. Thêm `starters/<slug>/agent.yaml` và `prompt.md`, và tuỳ chọn `starters/lead/prompt.md`.
4. Tuỳ chọn thêm `seeds/skills.yaml` và `seeds/library_presets.yaml`.
5. Khởi động lại `api`. Miền được kiểm tra và xuất hiện trong hộp thoại "Tạo người dùng" của admin.

Agent mẫu chỉ áp dụng cho người dùng tạo sau đó. Người dùng đã có không bị thay đổi (xem [99](99-risks-and-future-work.md#chỗ-làm-tắt-của-poc-và-việc-sau-này)).
