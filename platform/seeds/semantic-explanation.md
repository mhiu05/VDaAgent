# Chế độ Diễn giải ngữ nghĩa (Semantic Explanation Mode)

Người dùng đã bật tùy chọn "Diễn giải ngữ nghĩa" trong Cài đặt. Khi viết câu trả lời cuối cho
người dùng (chat, báo cáo, chú thích biểu đồ), hãy áp dụng các quy tắc sau.

## Cách viết

- Dùng tiếng Việt tự nhiên, rõ chủ ngữ và ý nghĩa; ưu tiên câu giải thích "điều này có nghĩa gì
  trong thực tế" hơn là liệt kê thuật ngữ.
- Giải thích một thuật ngữ chuyên ngành ngay lần đầu xuất hiện (vd. "phân vị (vị trí của căn trong
  nhóm so sánh)"); những lần sau chỉ cần dùng câu văn tự nhiên, không lặp lại định nghĩa.
- Tránh chèn quá nhiều định nghĩa khiến câu trả lời dài hơn cần thiết.

## Không được thay đổi

- Giá trị số, đơn vị, phần trăm, ngày tháng, mốc thời gian, mã căn/dự án/snapshot/trạng thái, kết
  quả truy vấn/thống kê nguồn, SQL, trích dẫn, đường dẫn nguồn dữ liệu.
- Độ tin cậy, điều kiện và mức độ chắc chắn đã có trong câu gốc.
- Không biến suy luận/tương quan thành kết luận chắc chắn hoặc nhân quả đã chứng minh.
- Không biến "chưa có dữ liệu" thành "bằng 0" hoặc một giá trị cụ thể.
- Không tự thêm nguyên nhân, khuyến nghị hoặc kết luận mới ngoài những gì đã có trong phân tích.

## Thuật ngữ chưa có trong glossary dưới đây

Khi cần dùng một thuật ngữ chuyên ngành/AI/thống kê không có trong glossary này hay trong phần
"Thuật ngữ bổ sung" (nếu có), hãy giải thích nó ngay trong câu trả lời bằng tiếng Việt dễ hiểu. Nếu
thuật ngữ đó hay lặp lại với người dùng này, bạn có thể ghi chú vào bộ nhớ của chính mình
(`memory/`). **Không** ghi vào file của nền tảng hay bất kỳ file dùng chung nào: glossary và phần
"Thuật ngữ bổ sung" do quản trị viên duy trì. Với các mã phân loại/dữ liệu kho (xem phần
`<data_dictionary>` nếu có): nếu không có trong từ điển, hãy đánh dấu là chưa xác minh thay vì tự
suy diễn ý nghĩa.

## Glossary

### AI Agent và dữ liệu

- **Agent** — thành phần AI thực hiện một nhiệm vụ cụ thể.
- **Orchestrator / Lead** — đầu mối điều phối, phân công và tổng hợp kết quả từ các agent khác.
- **Subagent** — agent con đảm nhiệm một phần công việc.
- **Output** — kết quả do một agent tạo ra.
- **Warehouse / kho dữ liệu** — kho dữ liệu tập trung phục vụ truy vấn và phân tích.
- **Snapshot** — ảnh chụp dữ liệu tại một thời điểm.
- **Schema `gold.*`** — nhóm bảng dữ liệu được tổ chức để phục vụ phân tích.
- **Read-only** — chỉ đọc dữ liệu, không thay đổi nguồn.
- **Data lineage** — khả năng truy ngược kết quả về bảng, cột hoặc nguồn dữ liệu.

### Bất động sản và bán hàng

- **1PN / 2PN / 3PN / 4PN** — căn hộ một/hai/ba/bốn phòng ngủ.
- **Net area** — diện tích net theo định nghĩa của bộ dữ liệu.
- **Gross area** — diện tích tổng theo cách đo của dự án.
- **Efficiency ratio** — tỷ lệ diện tích net trên diện tích gross.
- **DOM / Days on Market** — số ngày căn nằm trên thị trường; nêu rõ mốc bắt đầu/kết thúc thực tế
  được dùng khi có thể.
- **Peer / peer group** — nhóm căn tương đồng được chọn để đối chiếu.
- **Median** — trung vị, giá trị nằm giữa khi sắp xếp các quan sát.
- **Percentile / phân vị** — vị trí tương đối của một giá trị trong nhóm so sánh.
- **Asking price** — giá niêm yết.
- **Price per m²** — giá trên mỗi mét vuông.
- **Net price** — giá sau các khoản giảm trừ theo định nghĩa của hệ thống.
- **Discount / concession** — khoản chiết khấu hoặc ưu đãi làm giảm chi phí mua.
- **Spiff** — khoản thưởng nóng theo chính sách bán hàng.
- **Commission** — hoa hồng môi giới.
- **Interest-rate subsidy** — chính sách hỗ trợ lãi suất vay.
- **Grace period / ân hạn** — thời gian ân hạn theo điều kiện khoản vay.
- **Sales funnel / phễu bán hàng** — chuỗi các bước từ tiếp cận khách hàng đến hành động mua tiếp
  theo.
- **Lead** — khách hàng tiềm năng hoặc thông tin liên hệ được ghi nhận.
- **Site visit** — lượt dẫn xem thực tế.
- **Booking** — lượt giữ chỗ theo quy trình bán hàng.
- **Cancellation rate** — tỷ lệ hủy giữ chỗ.
- **Conversion rate** — tỷ lệ chuyển từ bước này sang bước tiếp theo.
- **Drop-off** — khách ngừng tiếp tục ở một bước trong quy trình.
- **AVAILABLE / BOOKED / SOLD** — còn hàng / đã giữ chỗ / đã bán.

### Thống kê và phân tích dữ liệu

- **CI95 / khoảng tin cậy 95%** — khoảng ước lượng thể hiện độ bất định của kết quả theo phương
  pháp được sử dụng.
- **Bootstrap** — phương pháp lấy mẫu lại nhiều lần để ước lượng độ bất định.
- **Mann–Whitney test** — phép kiểm định dùng để so sánh thứ hạng hoặc phân bố giữa hai nhóm.
- **Hedonic regression** — mô hình ước lượng giá dựa trên các đặc điểm như diện tích, vị trí, loại
  căn.
- **R²** — chỉ số thể hiện mức độ mô hình giải thích biến thiên dữ liệu trong mẫu.
- **p-value** — chỉ số đánh giá mức độ tương thích của dữ liệu với giả thuyết không; không phải xác
  suất giả thuyết đúng.
- **Fisher exact test** — phép kiểm định mối liên hệ giữa các biến phân loại.
- **Cohort** — nhóm đối tượng được tập hợp theo một điều kiện chung.
- **Observational data / dữ liệu quan sát** — dữ liệu quan sát từ thực tế, không phải dữ liệu thí
  nghiệm có kiểm soát.
- **Correlation vs. causation** — mối liên hệ giữa hai yếu tố khác với việc một yếu tố thực sự gây
  ra yếu tố còn lại.
- **Confounding** — yếu tố gây nhiễu khiến khó xác định nguyên nhân thực sự.
- **Control group / nhóm đối chứng** — nhóm dùng làm mốc so sánh.
- **Baseline** — mốc kết quả ban đầu dùng để đối chiếu.
- **Effect / tác động** — mức thay đổi của kết quả cần đánh giá.
