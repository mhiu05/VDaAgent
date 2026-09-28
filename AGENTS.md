## Luồng sản phẩm chính

VDaAgent giúp người dùng theo dõi và phân tích tình trạng tồn kho bất động sản từ dữ liệu có sẵn trong hệ thống.

Hệ thống có hai luồng sử dụng chính:

### 1. Phân tích tự động hàng ngày

Hệ thống tự động lấy dữ liệu của ngày hoặc kỳ tương ứng, phân tích tình trạng tồn kho và tạo báo cáo định kỳ.

Người dùng không cần tự chạy từng bước phân tích.

Kết quả cần giúp người dùng nhanh chóng hiểu:

- tình trạng tồn kho hiện tại;
- khu vực hoặc nhóm sản phẩm đang có vấn đề;
- xu hướng tăng hoặc giảm;
- những thay đổi đáng chú ý so với kỳ trước;
- nguyên nhân hoặc giả thuyết có thể giải thích cho biến động;
- bằng chứng và số liệu dùng để đưa ra nhận định.

Báo cáo phải có thể xem lại sau này và phải gắn với đúng dữ liệu đã được dùng để phân tích.

### 2. Phân tích theo câu hỏi của người dùng

Ngoài báo cáo tự động, người dùng có thể tự tạo một phiên phân tích.

Luồng mong muốn:

1. Chọn phạm vi dữ liệu cần phân tích.
2. Chọn ngày hoặc khoảng thời gian.
3. Đặt câu hỏi bằng ngôn ngữ tự nhiên.
4. Hệ thống tự xác định các bước phân tích cần thiết.
5. Các agent phối hợp để truy vấn, tính toán, so sánh và giải thích dữ liệu.
6. Người dùng có thể theo dõi quá trình xử lý.
7. Kết quả hiển thị câu trả lời, số liệu và bằng chứng liên quan.
8. Nếu cần, người dùng có thể tạo báo cáo từ kết quả phân tích đó.

Người dùng không cần hiểu cấu trúc database hoặc cách các agent bên trong phối hợp với nhau.

---

## Hành vi sản phẩm cần giữ

Khi thay đổi hệ thống, ưu tiên giữ các hành vi sau.

### Kết quả phải dựa trên dữ liệu thật của phiên phân tích

Không được tạo kết luận hoặc số liệu không có nguồn.

Nếu hệ thống không đủ dữ liệu để trả lời chắc chắn, phải thể hiện rõ giới hạn đó thay vì đoán.

### Người dùng phải biết kết luận đến từ đâu

Các nhận định quan trọng cần có số liệu hoặc bằng chứng hỗ trợ.

Người dùng phải có khả năng đi từ:

`Kết luận → số liệu → nguồn dữ liệu`

mà không cần hiểu implementation bên trong.

### Một phiên phân tích phải nhất quán

Khi một phiên phân tích đã bắt đầu với một tập dữ liệu cụ thể, các bước tiếp theo của phiên đó phải tiếp tục dựa trên cùng phạm vi dữ liệu, trừ khi người dùng chủ động thay đổi phạm vi.

Không để cùng một phiên phân tích vô tình dùng dữ liệu từ các thời điểm hoặc nguồn khác nhau.

### Công việc đang chạy không phụ thuộc vào việc người dùng giữ trang web mở

Nếu người dùng refresh, đóng tab hoặc mất kết nối tạm thời, các phân tích đã được gửi thành công vẫn phải có thể tiếp tục xử lý.

Khi người dùng quay lại, hệ thống nên cho phép xem lại trạng thái hoặc kết quả hiện có thay vì bắt đầu lại từ đầu.

### Không công khai kết quả chưa hoàn chỉnh

Kết quả trung gian, draft hoặc phân tích chưa qua các bước kiểm tra cần thiết không được xuất hiện như một báo cáo chính thức.

Người dùng cần phân biệt rõ:

- kết quả đang xử lý;
- draft;
- kết quả đã hoàn tất;
- báo cáo đã được xuất bản.

### Quyền truy cập của người dùng phải được giữ đúng

Người dùng chỉ được xem và thao tác trên dữ liệu mà họ có quyền truy cập.

Không để thay đổi giao diện, API hoặc agent workflow vô tình làm lộ dữ liệu của tổ chức khác.

---

## Quy tắc khi thay đổi tính năng

Trước khi sửa một tính năng, xác định tính năng đó thuộc luồng sử dụng nào và người dùng kỳ vọng điều gì từ nó.

Ưu tiên duy trì trải nghiệm hiện tại nếu task không yêu cầu thay đổi hành vi.

Không tạo thêm bước thủ công cho người dùng nếu hệ thống hiện tại có thể tự động thực hiện bước đó.

Không yêu cầu người dùng hiểu các khái niệm nội bộ như:

- queue;
- worker;
- agent invocation;
- snapshot;
- semantic layer;
- database schema.

Các khái niệm kỹ thuật này có thể xuất hiện trong màn hình dành cho developer hoặc observability, nhưng không nên trở thành yêu cầu để người dùng sử dụng sản phẩm.

Khi một thay đổi làm ảnh hưởng tới một trong các luồng chính, kiểm tra tối thiểu:

- người dùng có còn bắt đầu được phiên phân tích không;
- hệ thống có dùng đúng phạm vi dữ liệu không;
- kết quả có bằng chứng không;
- người dùng có xem lại trạng thái và kết quả không;
- báo cáo có phản ánh đúng kết quả của phiên phân tích không.

---

## API, dữ liệu và implementation

Chi tiết implementation của frontend, backend, database, worker và agent runtime được mô tả trong `ARCHITECTURE.md` và `docs/`.

Khi task chỉ thay đổi trải nghiệm hoặc hành vi sản phẩm, không cần đọc toàn bộ tài liệu kỹ thuật.

Chỉ đọc tài liệu kỹ thuật tương ứng khi thay đổi chạm tới khu vực đó.

Ví dụ:

- thay đổi giao diện → đọc hướng dẫn trong `src/frontend/`;
- thay đổi agent → đọc tài liệu agent;
- thay đổi dữ liệu hoặc quyền → đọc tài liệu data model và security;
- thay đổi background execution → đọc execution model;
- thay đổi API → đọc tài liệu API.

Ưu tiên sử dụng abstraction và luồng hiện có thay vì tạo một hệ thống song song chỉ để hoàn thành task.
