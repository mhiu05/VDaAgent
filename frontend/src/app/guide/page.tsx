import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { PublicNavbar } from "@/components/public-navbar";

type GuideStep = {
  title: string;
  purpose: string;
  action: string;
  result: string;
  note?: string;
};

type GuideWorkflow = {
  id: string;
  number: string;
  label: string;
  title: string;
  summary: string;
  entry: string;
  steps: GuideStep[];
  outcome: string;
  links?: Array<{ href: string; label: string }>;
};

const entryRoutes: GuideWorkflow[] = [
  {
    id: "guest-trial", number: "01", label: "CHƯA CÓ TÀI KHOẢN", title: "Dùng thử bằng Guest Analyst",
    summary: "Phù hợp để xem giao diện và thử trọn luồng với dữ liệu demo hoặc dữ liệu không cần giữ lâu dài.",
    entry: "Từ Trang chủ hoặc Hướng dẫn, tìm nút Analyst trên thanh điều hướng phía trên.",
    steps: [
      { title: "Chọn Analyst", purpose: "Tạo một phiên dùng thử có quyền Analyst mà không cần email hay mật khẩu.", action: "Nhấn Analyst trên thanh điều hướng.", result: "Ứng dụng chuyển tới Trang chủ workspace, tạo guest token và một workspace tạm riêng cho tab trình duyệt hiện tại." },
      { title: "Kiểm tra đúng phiên guest", purpose: "Tránh nhầm dữ liệu dùng thử với workspace cá nhân.", action: "Quan sát sidebar: tài khoản hiển thị “Phiên khách”, trạng thái “Đang dùng thử” và workspace “Phiên dùng thử · dữ liệu mẫu” bằng cách mở Dashboard.", result: "Bạn có thể dùng Bộ dữ liệu, profiling, review, Explorer, Agent và report với quyền Analyst." },
      { title: "Kết thúc dùng thử", purpose: "Xóa token guest khỏi browser và yêu cầu backend dọn phiên tạm.", action: "Nhấn Kết thúc dùng thử trên thanh điều hướng phía trên.", result: "Ứng dụng quay về Trang chủ. Cleanup backend chạy best-effort; phần còn lại được dọn theo retention.", note: "Không tải dữ liệu production hoặc dữ liệu cần lưu lâu dài vào guest workspace." },
    ],
    outcome: "Bạn đã vào được workspace thử nghiệm và biết cách kết thúc phiên an toàn.",
    links: [{ href: "/", label: "Mở Trang chủ" }],
  },
  {
    id: "signup-login", number: "02", label: "TÀI KHOẢN MỚI", title: "Đăng ký và xác nhận email",
    summary: "Dùng khi cần giữ dataset, profile, report và lịch sử làm việc lâu dài trong personal workspace.",
    entry: "Từ thanh điều hướng công khai, nhấn Đăng ký.",
    steps: [
      { title: "Tạo tài khoản Analyst", purpose: "Tạo danh tính Supabase và chuẩn bị personal workspace.", action: "Nhập email, mật khẩu tối thiểu 8 ký tự, nhập lại mật khẩu rồi nhấn Đăng ký.", result: "Nếu hợp lệ, màn hình hiện thông báo Kiểm tra email. Role được cố định là Analyst.", note: "Nếu nút bị khóa hoặc hiện “Đăng ký công khai đang tắt”, cần nhận lời mời hoặc nhờ quản trị bật self-signup." },
      { title: "Xác nhận email", purpose: "Kích hoạt tài khoản và cho phép hệ thống provision workspace.", action: "Mở email xác nhận trên cùng browser/device đã đăng ký và nhấn liên kết mới nhất.", result: "Trang callback hoàn tất phiên đăng nhập, tạo hoặc lấy lại personal workspace rồi chuyển tới Quản lý Workspace." },
      { title: "Gửi lại email khi cần", purpose: "Nhận liên kết mới nếu thư cũ hết hạn hoặc không đến.", action: "Sau khi bộ đếm 120 giây kết thúc, nhấn Gửi lại email xác nhận; kiểm tra Inbox, Spam, Promotions và thread Gmail cũ.", result: "Thông báo ghi thời điểm Supabase nhận yêu cầu gửi lại. Rate limit vẫn có thể áp dụng." },
    ],
    outcome: "Tài khoản được xác nhận, personal workspace được tạo và dữ liệu có thể lưu lâu dài.",
    links: [{ href: "/signup", label: "Mở trang Đăng ký" }],
  },
  {
    id: "account-access", number: "03", label: "ĐÃ CÓ TÀI KHOẢN", title: "Đăng nhập, khôi phục mật khẩu và đăng xuất",
    summary: "Dùng để trở lại workspace đã lưu hoặc xử lý khi không nhớ mật khẩu.",
    entry: "Từ thanh điều hướng công khai, nhấn Đăng nhập.",
    steps: [
      { title: "Đăng nhập", purpose: "Mở đúng workspace và quyền đã gắn với membership.", action: "Nhập email, mật khẩu rồi nhấn Đăng nhập.", result: "Ứng dụng chuyển tới trang được yêu cầu trước đó hoặc Trang chủ workspace; sidebar hiển thị email, workspace và trạng thái Đang hoạt động." },
      { title: "Đặt lại mật khẩu", purpose: "Khôi phục quyền truy cập khi quên mật khẩu.", action: "Nhấn Quên mật khẩu? → nhập email → Gửi liên kết. Mở liên kết trong email, nhập mật khẩu mới tối thiểu 8 ký tự rồi nhấn Lưu mật khẩu.", result: "Nếu cập nhật thành công, ứng dụng chuyển về Dashboard." },
      { title: "Đăng xuất", purpose: "Kết thúc phiên Supabase trên thiết bị hiện tại mà không xóa dữ liệu.", action: "Nhấn Đăng xuất ở cuối sidebar hoặc trên thanh điều hướng công khai.", result: "Session cục bộ và cache được xóa, sau đó ứng dụng quay về Trang chủ. Dataset/report trong workspace vẫn còn nguyên." },
    ],
    outcome: "Bạn kiểm soát được vòng đời phiên đăng nhập mà không ảnh hưởng dữ liệu workspace.",
    links: [{ href: "/login", label: "Mở trang Đăng nhập" }, { href: "/forgot-password", label: "Quên mật khẩu" }],
  },
];

const workspaceAndProfileWorkflows: GuideWorkflow[] = [
  {
    id: "workspace", number: "04", label: "WORKSPACE", title: "Chọn, tạo và cấu hình workspace",
    summary: "Workspace là ranh giới chứa dataset, profile, report, thành viên và audit. Hãy luôn kiểm tra workspace trước khi tải dữ liệu.",
    entry: "Trong sidebar, mở danh sách Workspace của bạn hoặc nhấn Quản lý Workspace →.",
    steps: [
      { title: "Đổi workspace đang làm việc", purpose: "Đưa mọi request tiếp theo vào đúng phạm vi dữ liệu.", action: "Chọn tên workspace trong hộp Workspace của bạn trên sidebar.", result: "Ứng dụng nạp lại session theo workspace mới, xóa cache cũ; nếu đang Chat, ứng dụng quay về Dashboard." },
      { title: "Tạo workspace mới", purpose: "Tách một dự án, nhóm dữ liệu hoặc ngữ cảnh nghiệp vụ mới.", action: "Ở Quản lý Workspace, nhập tên → chọn preset Business, Marketing, IT hoặc Education → chỉnh lĩnh vực, mục tiêu, người đọc, màu sắc → nhấn Tạo workspace.", result: "Workspace mới xuất hiện trong danh sách với context/theme đã chọn và có thể mở ngay." },
      { title: "Mở workspace", purpose: "Đặt workspace đó thành nơi làm việc hiện tại.", action: "Nhấn Mở workspace trên thẻ tương ứng.", result: "Workspace được chọn và ứng dụng chuyển tới Trang chủ workspace với các số đếm, báo cáo và dữ liệu của riêng workspace đó." },
      { title: "Cập nhật Context & Theme", purpose: "Cho Agent biết lĩnh vực, mục tiêu, đối tượng đọc và cách trình bày mặc định.", action: "Mở Context & Theme → chỉnh các trường → nhấn Lưu version mới.", result: "Màn hình hiện “Đã lưu version cấu hình mới”. Context định hướng diễn giải; theme không thay đổi metric." },
      { title: "Quản lý thành viên và lời mời", purpose: "Thêm Analyst hoặc tạm ngừng quyền của thành viên hiện có.", action: "Mở Quản lý workspace → nhập email → Gửi lời mời; dùng hộp Trạng thái để cập nhật thành viên hoặc nhấn Hủy lời mời.", result: "Danh sách member/invitation được tải lại; mọi thành viên mới đều dùng role Analyst." },
      { title: "Lưu trữ, khôi phục hoặc xóa", purpose: "Ngừng sử dụng tạm thời hoặc loại bỏ hẳn một workspace.", action: "Nhấn Lưu trữ để giữ dữ liệu; trong Kho lưu trữ nhấn Khôi phục để dùng lại. Chỉ nhấn Xóa workspace/Xóa vĩnh viễn khi muốn xóa toàn bộ, rồi nhập chính xác XÓA.", result: "Lưu trữ chỉ ẩn workspace đang hoạt động; xóa vĩnh viễn loại bỏ dataset, profile, report và file đã upload.", note: "Không thể lưu trữ/xóa workspace hiện tại nếu đó là workspace hoạt động duy nhất; hãy tạo hoặc mở workspace khác trước." },
    ],
    outcome: "Mọi dữ liệu và thao tác tiếp theo được gắn đúng workspace, context và thành viên.",
    links: [{ href: "/workspaces", label: "Quản lý Workspace" }, { href: "/settings", label: "Context & Theme" }, { href: "/workspaces/manage", label: "Thành viên & lời mời" }],
  },
  {
    id: "upload-profile", number: "05", label: "DỮ LIỆU & PROFILING", title: "Tải dữ liệu và tạo profile run",
    summary: "Đây là điểm bắt đầu của luồng evidence. Compute engine tạo metric; Agent chỉ đề xuất metadata và diễn giải kết quả.",
    entry: "Từ Dashboard nhấn Tải dữ liệu lên, hoặc vào Bộ dữ liệu → + Bộ dữ liệu mới.",
    steps: [
      { title: "Chọn nguồn dữ liệu", purpose: "Đưa một file, nhiều file hoặc cả thư mục vào hàng chờ upload.", action: "Kéo thả hoặc nhấn Chọn file/Chọn thư mục. Định dạng hỗ trợ: CSV, TSV, Parquet và JSON.", result: "Danh sách file hiện tên, kích thước và trạng thái Chờ tải; file không hỗ trợ bị bỏ qua kèm cảnh báo." },
      { title: "Kết nối Google Drive nếu được yêu cầu", purpose: "Cấp storage provider quyền lưu file của workspace.", action: "Nhấn Kết nối Google Drive, hoàn tất cửa sổ Google rồi quay lại trang upload.", result: "Thông báo đổi thành “Google Drive đã kết nối” và nút upload được mở." },
      { title: "Tải file lên workspace", purpose: "Lưu source trước khi profiling.", action: "Nhấn Tải dữ liệu lên. Theo dõi phần trăm; có thể nhấn Hủy tải lên khi request đang chạy.", result: "Mỗi file chuyển sang Đã tải. Khi tất cả hoàn tất, màn hình hiện “Đã tải lên an toàn”." },
      { title: "Đặt tên bộ dữ liệu", purpose: "Giúp nhận biết nguồn trong danh sách, Chat Agent và các profile run sau này.", action: "Nhập Tên bộ dữ liệu. Với nhiều file, nhấn Lưu tên bộ dữ liệu nếu muốn gộp chúng dưới cùng một collection name.", result: "Tên được lưu; tên file gốc vẫn giữ nguyên." },
      { title: "Chọn chế độ scan", purpose: "Cân bằng tốc độ và độ đầy đủ của metric.", action: "Chọn Sample — nhanh, có uncertainty; hoặc Full scan — quét toàn bộ và chính xác hơn.", result: "Profile run mang nhãn sample/approximate hoặc full/exact để người đọc biết phạm vi tính." },
      { title: "Bắt đầu profiling", purpose: "Tạo schema, missingness, cardinality, uniqueness, duplicate, outlier, top values, correlation và proposal metadata.", action: "Nhấn Bắt đầu profiling hoặc Bắt đầu profiling N file.", result: "Một file chuyển thẳng tới Profile Run Command Center; nhiều file chạy lần lượt rồi quay về Bộ dữ liệu." },
      { title: "Tạo phiên bản profiling mới", purpose: "Đo lại cùng dataset sau khi source thay đổi và tạo baseline cho drift.", action: "Bộ dữ liệu → Xem các run → Profiling phiên bản mới → nhập tên phiên → chọn Sample/Full → Bắt đầu profiling.", result: "Phiên mới có version riêng và được mở trong Command Center; phiên cũ vẫn được giữ để so sánh." },
    ],
    outcome: "Bạn có ít nhất một profile run có nguồn, version, scan mode và provenance rõ ràng.",
    links: [{ href: "/datasets/new", label: "Tải bộ dữ liệu" }, { href: "/datasets", label: "Danh sách bộ dữ liệu" }],
  },
  {
    id: "review-overview", number: "06", label: "REVIEW & TỔNG QUAN", title: "Duyệt metadata và đọc profile đúng cách",
    summary: "Proposal còn pending sẽ chặn Explorer. PII pending vẫn được xem là nhạy cảm cho tới khi Analyst quyết định.",
    entry: "Mở một profile run. Nếu thấy cảnh báo Cần review metadata, nhấn Review proposals/Xem xét đề xuất.",
    steps: [
      { title: "Đọc evidence của từng proposal", purpose: "Hiểu vì sao hệ thống đề xuất semantic type, candidate key hoặc PII.", action: "Xem tên cột, loại đề xuất, confidence, detection method và evidence trong từng nhóm.", result: "Bạn có đủ ngữ cảnh để chọn quyết định thay vì xác nhận tự động." },
      { title: "Chọn quyết định", purpose: "Chốt metadata chính thức dùng cho báo cáo và phân tích.", action: "Chọn Xác nhận đề xuất, Từ chối đề xuất hoặc Chỉnh sửa phân loại. Khi chỉnh sửa, chọn Giá trị chính thức và nhập Lý do chỉnh sửa bắt buộc.", result: "Bộ đếm phía cuối trang tăng. Nút lưu chỉ mở khi tất cả proposal pending đã có quyết định." },
      { title: "Dùng thao tác hàng loạt khi phù hợp", purpose: "Xử lý nhanh một tập proposal đã kiểm tra và có cùng quyết định.", action: "Nhấn Xác nhận tất cả hoặc Từ chối tất cả, sau đó rà lại từng lựa chọn.", result: "Mọi proposal được điền quyết định tương ứng nhưng chưa gửi cho tới khi nhấn nút lưu." },
      { title: "Lưu quyết định", purpose: "Ghi reviewer/audit và cho pipeline tiếp tục.", action: "Nhấn Lưu quyết định & tiếp tục pipeline.", result: "Proposal chuyển khỏi trạng thái chờ; profile tiếp tục tới completed và quay về màn hình trước đó hoặc báo cáo." },
      { title: "Đọc tab Tổng quan", purpose: "Kiểm tra sức khỏe và provenance trước khi đi sâu.", action: "Mở Tổng quan; đọc status, scan mode, số dòng/cột, cảnh báo privacy, narrative, hồ sơ cột, null/unique chart, distribution, correlation và Nguồn & cách tạo báo cáo.", result: "Bạn biết số liệu nào exact/approximate, cột nào bị mask và profile đã sẵn sàng cho Explorer hay chưa." },
    ],
    outcome: "Profile đạt trạng thái completed, metadata ổn định và sẵn sàng làm evidence.",
  },
];

const evidenceWorkflows: GuideWorkflow[] = [
  {
    id: "explorer", number: "07", label: "COMMAND CENTER · KHÁM PHÁ", title: "Tạo Preview, xác nhận Official và ghim evidence",
    summary: "Explorer chỉ nhận bounded aggregate; không nhận SQL và không trả raw row. Preview dùng để thử, Official mới được ghim vào report.",
    entry: "Trong Profile Run Command Center, nhấn tab Khám phá.",
    steps: [
      { title: "Chọn phép tổng hợp", purpose: "Xác định câu hỏi định lượng cần trả lời.", action: "Chọn Aggregate: count, count distinct, sum, mean hoặc median. Với phép khác count, chọn Measure.", result: "Dòng tóm tắt truy vấn cập nhật và nút Chạy preview mở khi cấu hình hợp lệ." },
      { title: "Chia nhóm và lọc", purpose: "So sánh kết quả theo phân khúc thay vì chỉ xem tổng toàn bảng.", action: "Chọn Group by; nếu cần, chọn Filter column và nhập Filter value.", result: "Truy vấn vẫn bị giới hạn tối đa 50 nhóm và chỉ dùng dimension/measure an toàn trong semantic context." },
      { title: "Chạy Preview", purpose: "Kiểm tra nhanh cấu hình trước khi tạo evidence chính thức.", action: "Nhấn Chạy preview; khi request lâu có thể nhấn Hủy request.", result: "Màn hình hiện Preview result gồm biểu đồ, bảng dữ liệu, limitations, execution ID, result hash và thời gian chạy." },
      { title: "Điều chỉnh hoặc xác nhận kết quả", purpose: "Thử một truy vấn khác hoặc chuyển kết quả đúng thành Official.", action: "Sửa Aggregate, Group by hoặc Filter ở panel bên trái rồi nhấn Chạy preview. Khi hài lòng, nhấn Chạy kết quả chính thức.", result: "Backend chạy quality gate và chạy lại trên nguồn được pin. Kết quả chuyển thành Official nếu không bị blocked.", note: "Nếu blocked, đọc issue/limitation, hoàn tất review metadata hoặc sửa context rồi chạy lại." },
      { title: "Giải thích bằng Agent", purpose: "Yêu cầu Agent diễn giải đúng execution đang xem.", action: "Nhấn Giải thích trên kết quả.", result: "Command Center chuyển sang tab Hỏi Agent và bind execution ID/result hash vào câu hỏi tiếp theo." },
      { title: "Ghim vào báo cáo", purpose: "Đưa aggregate evidence đã xác nhận vào Report Draft.", action: "Trên Official result, nhấn Pin vào báo cáo.", result: "Nhãn Đã ghim vào Report Draft xuất hiện; Preview không thể ghim." },
    ],
    outcome: "Bạn có Official execution có hash/provenance và có thể dùng trong báo cáo.",
  },
  {
    id: "agent", number: "08", label: "HỎI AGENT", title: "Hỏi trên profile evidence hoặc execution cụ thể",
    summary: "Agent chỉ diễn giải metric/evidence đã tính, không đọc raw rows và không tự tạo số liệu.",
    entry: "Dùng tab Hỏi Agent trong Command Center, hoặc nhấn + Chat mới trong sidebar để mở Chat Agent toàn workspace.",
    steps: [
      { title: "Chọn đúng nguồn", purpose: "Khóa câu trả lời vào dataset và profile run mong muốn.", action: "Trong Chat Agent, chọn Dataset trong workspace rồi chọn Phiên profiling đã hoàn tất. Trong Command Center, profile hiện tại được chọn sẵn.", result: "Tên nguồn/phiên xuất hiện ở header. Nếu còn proposal pending, composer bị khóa và hiện nút Xem xét proposals." },
      { title: "Đặt câu hỏi", purpose: "Nhận diễn giải về quality, schema, PII, metric hoặc rủi ro.", action: "Nhập câu hỏi rồi nhấn Gửi câu hỏi/Gửi; trong Chat Agent có thể nhấn câu hỏi gợi ý. Enter để gửi, Shift + Enter để xuống dòng.", result: "Câu trả lời stream vào màn hình cùng nguồn evidence; có thể nhấn Dừng khi đang chạy." },
      { title: "Giải thích Official execution", purpose: "Tránh câu trả lời chung chung khi cần giải thích một bảng/biểu đồ cụ thể.", action: "Từ tab Khám phá, nhấn Giải thích rồi đặt câu hỏi trong tab Hỏi Agent.", result: "Notice hiển thị execution ID và hash đang được bind; câu trả lời truy nguyên đúng kết quả đó." },
      { title: "Ghim câu trả lời đã xác minh", purpose: "Thêm insight của Agent vào Report Draft với provenance.", action: "Khi thấy Evidence verified, nhấn Pin câu trả lời vào báo cáo.", result: "Nút đổi thành Đã ghim vào báo cáo. Câu trả lời không có verified agent run sẽ không có thao tác ghim." },
      { title: "Quản lý lịch sử chat", purpose: "Mở lại hoặc xóa hội thoại lưu cục bộ theo workspace.", action: "Nhấn tên chat gần đây, nút × để xóa một chat, hoặc Lịch sử → Xóa tất cả.", result: "Xóa một chat yêu cầu xác nhận; xóa tất cả đưa bạn về Dashboard nếu đang ở Chat. Lịch sử được ghi chú lưu trong 30 ngày." },
      { title: "Upload nhanh từ Chat", purpose: "Bắt đầu profile mà không rời màn hình hội thoại.", action: "Nhấn dấu + cạnh composer → chọn file → chọn Sampling hoặc Full scan → Tải lên và bắt đầu profiling.", result: "File được upload/profile; sau đó bạn cần review proposal trước khi hỏi Agent." },
    ],
    outcome: "Bạn nhận câu trả lời có nguồn rõ ràng và chỉ ghim insight đã được xác minh.",
    links: [{ href: "/chat", label: "Mở Chat Agent" }],
  },
  {
    id: "report", number: "09", label: "REPORT & EXPORT", title: "Sắp xếp Report Draft, tạo snapshot và xuất file",
    summary: "Report Draft thay đổi theo evidence đang ghim; snapshot đóng băng một phiên bản để xuất và kiểm tra lại.",
    entry: "Trong Command Center, nhấn tab Báo cáo sau khi đã ghim ít nhất một Official result hoặc câu trả lời verified.",
    steps: [
      { title: "Kiểm tra các mục đã ghim", purpose: "Bảo đảm report chỉ chứa evidence cần thiết.", action: "Đọc từng chart/insight, query summary, result hash và limitations.", result: "Draft cho biết mục nào là chart, mục nào là giải thích Agent và bằng chứng tương ứng." },
      { title: "Sắp xếp hoặc bỏ mục", purpose: "Tạo thứ tự kể chuyện phù hợp cho người đọc.", action: "Nhấn Lên/Xuống để đổi vị trí; nhấn Bỏ ghim để loại mục khỏi draft.", result: "Danh sách cập nhật tại chỗ và thứ tự mới được lưu." },
      { title: "Xử lý draft stale", purpose: "Ngăn xuất evidence đã lệch context, theme hoặc source.", action: "Nếu thấy cảnh báo Draft đã stale, quay lại Explorer, chạy lại và pin lại evidence theo lý do được liệt kê.", result: "Khi không còn stale reason, nút Tạo snapshot được mở." },
      { title: "Tạo snapshot", purpose: "Đóng băng nội dung và hash của bản báo cáo hiện tại.", action: "Nhấn Tạo snapshot.", result: "Màn hình hiện Snapshot hash và mở nút Xuất PDF." },
      { title: "Xuất từ Report Draft", purpose: "Tạo PDF theo snapshot đã đóng băng.", action: "Nhấn Xuất PDF.", result: "Trình duyệt tải file PDF; dữ liệu raw row và PII không được phép sẽ không xuất hiện." },
      { title: "Xuất báo cáo từ Command Center", purpose: "Tạo PDF từ Report Draft đã có evidence.", action: "Từ profile, mở tab Báo cáo → tạo snapshot → nhấn Xuất PDF.", result: "Trình duyệt tải file từ snapshot đã tạo." },
      { title: "Mở Thư viện báo cáo", purpose: "Xem lại snapshot đã tạo trong workspace.", action: "Sidebar → Thư viện báo cáo → Mở báo cáo. Có thể nhấn Xuất PDF đầy đủ trong trang chi tiết.", result: "Trang hiển thị summary, section, visualization và mục lục; draft do chính bạn tạo có thể có nút Xóa báo cáo." },
    ],
    outcome: "Bạn có bản snapshot/export chỉ chứa nội dung đã chọn và có thể truy nguyên nguồn.",
    links: [{ href: "/reports", label: "Thư viện báo cáo" }],
  },
];

const governanceWorkflows: GuideWorkflow[] = [
  {
    id: "test-drift", number: "10", label: "KIỂM ĐỊNH & DRIFT", title: "Chạy kiểm định thống kê và so sánh phiên bản",
    summary: "Backend tính test, p-value correction và drift severity; frontend chỉ trình bày aggregate evidence.",
    entry: "Dùng So sánh phiên bản ở sidebar để chọn hai profile run cùng dataset.",
    steps: [
      { title: "Chạy kiểm định thống kê", purpose: "Kiểm tra giả thuyết trên các cột phù hợp.", action: "Chọn Test → nhập Alpha → chọn đúng số cột được yêu cầu → nhấn Chạy kiểm định.", result: "Bảng hiện test statistic, p-value adjusted, kết luận và interpretation. Multiple-testing correction được thực hiện ở backend." },
      { title: "Chọn baseline drift trong profile", purpose: "Đo mức thay đổi giữa hai lần profile của cùng dataset.", action: "Ở phần So sánh drift, chọn Phiên baseline rồi nhấn Kiểm tra drift.", result: "Notice và bảng findings hiển thị cột, loại drift, severity, metric/PSI và chi tiết." },
      { title: "So sánh từ sidebar", purpose: "Chọn hai phiên theo tên mà không cần mở profile trước.", action: "Mở So sánh phiên bản → chọn Phiên baseline và Phiên hiện tại → nhấn So sánh drift.", result: "Chỉ profile run completed, tương thích và cùng dataset được tính; nếu không có finding, màn hình báo không phát hiện drift đáng báo cáo." },
      { title: "Đọc severity đúng cách", purpose: "Phân biệt tín hiệu cần điều tra với kết luận nghiệp vụ.", action: "Đọc summary, severity, PSI/null rate/cardinality/distribution và evidence chi tiết; đối chiếu scan mode của hai run.", result: "Bạn có danh sách thay đổi có thể kiểm tra lại, không phải kết luận dựa trên raw sample từ frontend." },
    ],
    outcome: "Kết quả test/drift được lưu theo profile run và có thể đưa vào combined report.",
    links: [{ href: "/compare", label: "So sánh phiên bản" }],
  },
  {
    id: "audit-safety", number: "11", label: "AUDIT & AN TOÀN", title: "Theo dõi hoạt động và giữ đúng boundary dữ liệu",
    summary: "Mọi resource được scope theo workspace. Report, Agent và Analysis không trả raw rows; PII bị loại khỏi aggregate/filter/group-by.",
    entry: "Mở Hoạt động trên sidebar để xem log của workspace hiện tại.",
    steps: [
      { title: "Đọc activity log", purpose: "Kiểm tra ai đã upload, profile, review, phân tích hoặc tạo báo cáo.", action: "Mở Hoạt động và đọc danh sách sự kiện theo thời gian.", result: "Màn hình hiện số sự kiện và chi tiết đã được lọc theo workspace; nội dung câu hỏi raw không hiển thị." },
      { title: "Xác minh evidence trước khi chia sẻ", purpose: "Bảo đảm người nhận hiểu nguồn và giới hạn của số liệu.", action: "Kiểm tra profile run, scan mode, result hash, limitation, snapshot hash và các section export.", result: "Báo cáo giữ được chuỗi provenance từ source → profile → context/execution → snapshot." },
      { title: "Xóa dataset khi thật sự cần", purpose: "Loại bỏ source và toàn bộ lịch sử profiling liên quan.", action: "Bộ dữ liệu → nhấn Xóa → xác nhận hộp thoại.", result: "Dataset và lịch sử profiling bị xóa không thể hoàn tác; các màn hình phụ thuộc có thể không còn mở được." },
    ],
    outcome: "Bạn biết nơi kiểm tra audit và nhận diện rõ các thao tác không thể hoàn tác.",
    links: [{ href: "/activity", label: "Hoạt động workspace" }],
  },
];

const mainWorkflows = [...workspaceAndProfileWorkflows, ...evidenceWorkflows, ...governanceWorkflows];

const troubleshooting = [
  ["Nhấn Analyst nhưng không vào được workspace", "Kiểm tra backend đang chạy, AUTH_ALLOW_GUEST=true và NEXT_PUBLIC_AUTH_ALLOW_GUEST=true đã có hiệu lực khi build frontend. Sau đó reload và nhấn Analyst lại."],
  ["Không upload được file", "Kiểm tra định dạng, dung lượng, workspace hiện tại, storage provider/bucket và kết nối Google Drive. Nếu đã upload một phần, nút Tải tiếp sẽ chỉ gửi các file còn thiếu."],
  ["Profile dừng ở pending_review", "Mở Review proposals, chọn quyết định cho tất cả proposal rồi nhấn Lưu quyết định & tiếp tục pipeline. PII/candidate key không được tự động xác nhận."],
  ["Explorer không chạy hoặc Promote bị blocked", "Profile phải completed; measure/dimension phải nằm trong context an toàn và không phải PII. Đọc quality issue/limitation, sửa context hoặc review metadata rồi chạy Preview lại."],
  ["Không thể Pin vào báo cáo", "Preview không thể ghim. Hãy nhấn Xác nhận kết quả để tạo Official result; câu trả lời Agent chỉ ghim được khi có Evidence verified."],
  ["Draft báo stale hoặc không tạo snapshot", "Draft phải có ít nhất một mục và không còn stale reason. Re-run Explorer hoặc Agent trên context/source hiện tại rồi pin lại evidence."],
  ["Không thấy profile run để hỏi Agent hoặc so sánh drift", "Chỉ run completed mới xuất hiện. Drift còn yêu cầu hai run cùng dataset; hãy tạo Profiling phiên bản mới nếu chưa có baseline phù hợp."],
  ["Failed to fetch hoặc trang không tải", "Mở http://localhost:8000/health, kiểm tra NEXT_PUBLIC_API_URL, CORS và backend log. HTTP 401 là lỗi phiên, 403 là quyền, 404 có thể là resource ngoài workspace, 409 thường yêu cầu chọn workspace."],
];

function StepList({ steps }: { steps: GuideStep[] }) {
  return <ol className="guide-detail-steps">
    {steps.map((step, index) => <li key={step.title}>
      <span className="guide-detail-step-number">{index + 1}</span>
      <div className="guide-detail-step-body">
        <h3>{step.title}</h3>
        <dl className="guide-step-details">
          <div><dt>Để làm gì</dt><dd>{step.purpose}</dd></div>
          <div><dt>Thao tác</dt><dd>{step.action}</dd></div>
          <div><dt>Sau khi nhấn</dt><dd>{step.result}</dd></div>
        </dl>
        {step.note && <p className="guide-step-warning"><b>Lưu ý:</b> {step.note}</p>}
      </div>
    </li>)}
  </ol>;
}

function WorkflowSection({ workflow, compact = false }: { workflow: GuideWorkflow; compact?: boolean }) {
  return <section className={`panel guide-workflow${compact ? " guide-workflow-compact" : ""}`} id={workflow.id}>
    <header className="guide-workflow-header">
      <span className="guide-section-number">{workflow.number}</span>
      <div><p className="eyebrow">{workflow.label}</p><h2>{workflow.title}</h2><p>{workflow.summary}</p></div>
    </header>
    <div className="guide-entry"><b>Bắt đầu ở đâu?</b><p>{workflow.entry}</p></div>
    <StepList steps={workflow.steps} />
    <footer className="guide-workflow-footer">
      <p><b>Kết quả cuối:</b> {workflow.outcome}</p>
      {workflow.links?.length ? <div className="guide-workflow-links">{workflow.links.map((link) => <Link href={link.href} key={link.href}>{link.label} <span aria-hidden="true">→</span></Link>)}</div> : null}
    </footer>
  </section>;
}

export default function GuidePage() {
  return <div className="public-page guide-public-page">
    <PublicNavbar />
    <main className="guide-page">
      <PageHeader eyebrow="Trung tâm hướng dẫn" title="Mọi luồng sử dụng VDaAgent, từ đầu đến cuối" description="Mỗi bước giải thích rõ mục đích, nút cần nhấn, kết quả xuất hiện và điều kiện để đi tiếp. Luồng chính dành cho một role duy nhất: Analyst." action={<div className="inline-actions"><Link className="button primary" href="/">Dùng thử Analyst</Link><Link className="button secondary" href="/login">Đăng nhập</Link></div>} />

      <section className="guide-overview" aria-label="Luồng chuẩn của Analyst"><span aria-hidden="true">✦</span><p><strong>Luồng chuẩn:</strong> Chọn workspace → Upload → Profiling → Review proposal → Tổng quan → Preview → Official → Agent → Pin → Snapshot → Export.</p></section>

      <nav className="panel guide-toc" aria-labelledby="guide-toc-title">
        <div><p className="eyebrow">MỤC LỤC</p><h2 id="guide-toc-title">Chọn đúng việc bạn đang cần làm</h2><p>Có thể đọc từ đầu hoặc nhảy thẳng tới một workflow. Các luồng 01–03 là cách truy cập; 04–11 là luồng làm việc chính.</p></div>
        <ol>{[...entryRoutes, ...mainWorkflows].map((workflow) => <li key={workflow.id}><a href={`#${workflow.id}`}><span>{workflow.number}</span>{workflow.title}</a></li>)}</ol>
      </nav>

      <section className="guide-section-intro" aria-labelledby="access-title"><p className="eyebrow">PHẦN A</p><h2 id="access-title">Vào hệ thống bằng cách nào?</h2><p>Chọn một trong ba luồng dưới đây. Guest và tài khoản đăng nhập đều có quyền Analyst, nhưng chỉ workspace đăng nhập phù hợp để giữ dữ liệu lâu dài.</p></section>
      <div className="guide-entry-workflows">{entryRoutes.map((workflow) => <WorkflowSection compact workflow={workflow} key={workflow.id} />)}</div>

      <section className="guide-section-intro guide-main-intro" aria-labelledby="main-flow-title"><p className="eyebrow">PHẦN B · CÁC BƯỚC CHUNG</p><h2 id="main-flow-title">Từ workspace đến báo cáo có evidence</h2><p>Thực hiện theo thứ tự 04 → 11 cho dữ liệu mới. Mỗi bước cho biết thao tác đó dùng để làm gì và màn hình sẽ thay đổi ra sao sau khi nhấn.</p></section>
      <div className="guide-workflow-list">{mainWorkflows.map((workflow) => <WorkflowSection workflow={workflow} key={workflow.id} />)}</div>

      <section className="panel guide-when-section" id="troubleshooting"><div><p className="eyebrow">XỬ LÝ SỰ CỐ</p><h2>Nếu workflow dừng ở một bước</h2><p className="guide-section-description">Mở đúng lỗi đang gặp và kiểm tra theo thứ tự được nêu.</p></div><div className="guide-troubleshooting">{troubleshooting.map(([title, detail]) => <details key={title}><summary>{title}</summary><p>{detail}</p></details>)}</div></section>

      <section className="panel guide-privacy"><div><p className="eyebrow">NGUYÊN TẮC AN TOÀN</p><h2>Mỗi kết quả đều có boundary</h2></div><div className="guide-privacy-points"><span><b>PII</b><small>Review thủ công; không aggregate/filter/group-by</small></span><span><b>Evidence</b><small>Gắn profile, execution và result hash</small></span><span><b>Raw rows</b><small>Không trả trong Agent, Analysis hoặc export</small></span></div></section>
    </main>
  </div>;
}
