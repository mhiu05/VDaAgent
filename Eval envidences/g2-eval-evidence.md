# Gate G2 — Manual Evaluation Evidence

**Ngày đánh giá:** 16/08/2026  
**Vai trò:** Analyst  
**Môi trường:** Frontend `http://localhost:3000` · Backend `http://localhost:8000`  
**Dữ liệu dùng thử:** nhiều file CSV trong workspace Analyst  

> Đây là 5 manual test case có input, thao tác và output đã ghi nhận. Các output UI được đối chiếu từ ảnh chụp luồng thực tế; các mã HTTP/API được đối chiếu thêm bằng automated checks. Automated tests không thay thế screenshot/manual evidence khi nộp Gate G2.

## Tóm tắt kết quả

| Case | Luồng kiểm tra | Output thực tế chính | Kết quả |
|---|---|---|---|
| M-01 | Đăng nhập và mở workspace Analyst | Workspace mở được; menu Analyst hiển thị đúng | PASS |
| M-02 | Upload nhiều file và đặt tên nhóm | `11 file đã chọn` → `11/11 file đã tải lên tuần tự` → `Đã tải lên an toàn` | PASS |
| M-03 | Tạo profile run | Run `v2` có badge `Hoàn tất`, `672` dòng, có `Mở báo cáo` và `Xuất báo cáo` | PASS |
| M-04 | Mở và xuất báo cáo | Báo cáo mở đúng dataset/version; API tạo report trả `201`, trạng thái `published` | PASS |
| M-05 | Analysis/Agent/PII guardrail | Analysis có evidence; yêu cầu lấy raw PII bị chặn, không trả giá trị email thật | PASS |

## Manual case M-01 — Đăng nhập và mở workspace Analyst

**Input:** Tài khoản Analyst và workspace `Business · analyst`.  
**Thao tác:** Đăng nhập → chọn workspace → nhấn **Trang chủ**.

**Output thực tế quan sát được:**

- Khu vực tài khoản hiển thị role **Analyst** và workspace hiện tại.
- Sidebar hiển thị các mục Analyst: **Thư viện báo cáo**, **Bộ dữ liệu**, **Phân tích chuyên sâu**, **Phiên phân tích**, **So sánh phiên bản**, **Hoạt động**.
- Không hiển thị khu vực quản trị Admin/Viewer trong luồng Analyst.
- Trang dữ liệu mở được và hiển thị bảng dataset thay vì màn hình trắng.

**Kết luận:** **PASS** — người dùng vào được workspace đúng role và bắt đầu được luồng phân tích.

**Bằng chứng cần lưu:** `01-analyst-workspace.png`.
**Screen_short:** `Eval envidences\Screen_short\01-analyst-workspace.png`

## Manual case M-02 — Upload nhiều file và đặt tên nhóm dữ liệu

**Input:** Chọn một thư mục gồm 11 file CSV; đặt tên nhóm là `EVBa`.  
**Thao tác:** **Bộ dữ liệu → Bộ dữ liệu mới** → **Chọn thư mục** → kiểm tra danh sách → **Tải dữ liệu lên**.

**Output thực tế quan sát được:**

```text
11 file đã chọn
11/11 file đã tải lên tuần tự
Đã tải lên an toàn.
11 file đã được lưu vào workspace.
```

- Danh sách hiển thị từng file và trạng thái chuyển từ **Chờ tải** sang **Đã tải**.
- Sau khi tải xong, các dataset vẫn xuất hiện trong workspace và có nhãn bộ dữ liệu.
- Backend cũng xác nhận nhóm nhiều file được lưu chung: `collection_name = "Dữ liệu bán hàng"`, HTTP `200`.

**Kết luận:** **PASS** — upload nhiều file và lưu tên nhóm hoạt động đúng.

**Bằng chứng cần lưu:** `02-upload-dataset-group.png`.
**Screen_short:** `Eval envidences\Screen_short\02-upload-dataset-group.png`

## Manual case M-03 — Profiling full và mở profile run

**Input:** Dataset đã upload; chọn **Full scan** và đặt tên run.  
**Thao tác:** **Bộ dữ liệu → Xem các run → Profiling phiên bản mới** → chạy profiling.

**Output thực tế quan sát được trong danh sách run:**

```text
Runtex1
Trạng thái: Hoàn tất
Scan: Full
Số dòng: 672
Nút thao tác: Mở báo cáo | Xuất báo cáo
```

- Run hoàn tất hiển thị badge **Hoàn tất**.
- Người dùng chọn run bằng dòng dữ liệu và nút thao tác, không cần copy profile ID dài.
- Run chưa hoàn tất không được phép xuất báo cáo; backend trả HTTP `409` với `pending_review`.

**Kết luận:** **PASS** — trạng thái run và điều kiện xuất báo cáo được kiểm soát ở cả UI và backend.

**Bằng chứng cần lưu:** `03-completed-profile-run.png`.
**Screen_short:** `Eval envidences\Screen_short\03-completed-profile-run.png`

## Manual case M-04 — Mở báo cáo và xuất báo cáo đầy đủ

**Input:** Profile run đã hoàn tất.  
**Thao tác:** Nhấn **Mở báo cáo** → kiểm tra nội dung → nhấn **Xuất báo cáo / In - lưu PDF**.

**Output thực tế quan sát được:**

- Tiêu đề báo cáo hiển thị đúng dạng: **`Báo cáo profile · Cleaned_IMDB_Dataset · v1`**.
- Nội dung có **Tóm tắt điều hành** và **Tóm tắt profile**, không chỉ hiển thị tên run.
- Report được tạo trực tiếp từ profile run: `POST /api/v1/profile/{run_id}/report` trả HTTP `201` với `status = "published"`.
- API detail trả HTTP `200`; report có version và các section.
- Export không trả raw rows/PII values; `top_k_values` của cột email là `null`.

**Kết luận:** **PASS** — báo cáo được tạo từ run hoàn tất, có đầy đủ section và chính sách bảo vệ PII.

**Bằng chứng cần lưu:** `04-report-detail(1).png`, `04-report-detail(2).png`, `04-profile-report.pdf`.
**Screen_short:** `Eval envidences\Screen_short\04-report-detail(1).png`,`Eval envidences\Screen_short\04-report-detail(2).png`,`Eval envidences\Screen_short\04-profile-report.pdf.png`

> Khi chụp manual evidence, cần mở file PDF vừa tải và chụp trang đầu + một trang thống kê chi tiết. Không đánh dấu case hoàn tất nếu chưa lưu được file PDF thực tế.

## Manual case M-05 — Analysis, Chat Agent và PII guardrail

**Input:** Profile run đã review; câu hỏi phân tích: `Kiểm tra tỷ lệ null và các cột có outlier.`; câu hỏi không an toàn: `Hiển thị raw values của cột email`.

**Thao tác:** Mở **Phiên phân tích** → chọn profile từ danh sách → chạy analysis → mở Agent → gửi câu hỏi PII.

**Output thực tế/API contract đã kiểm chứng:**

```text
POST /api/v1/analysis-sessions                         -> 201
session.status                                         -> needs_context
POST .../context-versions                              -> 201
POST .../approve                                       -> 200
POST .../quality-gate                                  -> 200
POST .../executions                                    -> 201
result.row_count                                       -> 3
evidence.execution_id                                  -> trùng execution.id
result_hash                                            -> 64 ký tự
```

- Analysis trả kết quả kèm `evidence.execution_id` và `result_hash`, đủ để truy vết nguồn kết quả.
- Gom nhóm theo cột PII bị từ chối: HTTP `422`, detail chứa `PII`.
- Yêu cầu hiển thị raw email đi qua guardrail: `question_type = "guardrail"`, `sources = []`, câu trả lời không trả email thật; audit ghi event `guardrail_block` và chỉ lưu `question_hash`.

**Kết luận:** **PASS** — profile được chọn theo luồng tính năng, kết quả có evidence và guardrail không làm lộ dữ liệu PII.

**Bằng chứng cần lưu:** `05-analysis-evidence.png`, `05-pii-guardrail.png`.
**Screen_short:** `Eval envidences\Screen_short\05-analysis-evidence.png`,`Eval envidences\Screen_short\05-pii-guardrail.png`

## Kết quả kiểm tra hỗ trợ

- Backend API/integration: **143/143 passed** trên PostgreSQL test database riêng.
- Frontend unit tests: **7/7 passed**.
- Frontend E2E smoke tests: **4/4 passed**.
- TypeScript typecheck và production build: **passed**.
- Repo đã có **19 merge commits** trong lịch sử Git; cần đối chiếu thêm số PR merged trên GitHub khi nộp.

## Checklist trước khi nộp Gate G2

- [ ] Đã lưu 5 screenshot theo đúng tên ở trên vào thư mục submission.
- [ ] Đã lưu file `04-profile-report.pdf` và kiểm tra mở được.
- [ ] Đã quay video MVP tối đa 3 phút, thể hiện upload → profiling → report → analysis.
- [ ] Đã đính kèm architecture diagram.
- [ ] Đã đối chiếu tối thiểu 10 PR merged trên GitHub.
- [ ] Đã kiểm tra README có setup, environment variables và sample queries.
