# Khảo Sát Chi Tiết 5 Pain Point Nghiệp Vụ 

## Mục lục
0. [Khung phân tích & quy ước ánh xạ](#0-khung-phân-tích--quy-ước-ánh-xạ)
1. [Pain Point 1 — Kế toán (Kế toán tổng hợp)](#1-pain-point-1--kế-toán-kế-toán-tổng-hợp)
2. [Pain Point 2 — Bán lẻ/E-commerce (Inventory Analyst)](#2-pain-point-2--bán-lẻe-commerce-inventory-analyst)
3. [Pain Point 3 — Ngân hàng/AML](#3-pain-point-3--ngân-hàngaml)
4. [Pain Point 4 — Marketing](#4-pain-point-4--marketing)
5. [Pain Point 5 — HR](#5-pain-point-5--hr)
6. [Bảng tổng hợp chéo 5 domain](#6-bảng-tổng-hợp-chéo-5-domain)
7. [Nhận định chung & khuyến nghị](#7-nhận-định-chung--khuyến-nghị)

---

## 0. Khung phân tích & quy ước ánh xạ

6 node lõi: `sample → compute_stats → propose_metadata → HITL interrupt → summarize → QA`, cộng với 2 ràng buộc xuyên suốt là HITL và PII masking. Khi rà từng epic (khối công việc tổng quát) của 5 pain point, tài liệu này quy ước 6 "năng lực phân tích" (ngoài ra có 1 node ngoài phạm vi) tổng quát mà một node có thể thực hiện, dùng làm đơn vị đối chiếu xuyên domain:

| Ký hiệu | Năng lực phân tích | Node tương ứng | Có sẵn trong MVP |
|---|---|---|---|
| **NC** | Null-check / kiểm tra tính đầy đủ theo trường | `compute_stats` | Có |
| **OL** | Outlier detection theo baseline (tĩnh hoặc động/rolling) | `compute_stats` | Có (baseline tĩnh: IQR/z-score); baseline động theo kỳ/mùa vụ là mở rộng |
| **GD** | Group-wise distribution — so sánh phân phối giữa các nhóm | `compute_stats` (mở rộng từ correlation/group-by) | Một phần (correlation matrix có sẵn qua ydata-profiling, nhưng group-by theo chiều nghiệp vụ là mở rộng) |
| **CK** | Candidate key / đối chiếu liên bảng (join key detection) | `propose_metadata` | Có (candidate key trong phạm vi 1 bảng); đối chiếu liên bảng/liên phân hệ là mở rộng |
| **TR** | Trend/xu hướng theo thời gian, phân biệt biến động ngắn hạn vs xu hướng thật | *(chưa có node riêng — gần nhất là `compute_stats`)* | Không — cần bổ sung logic rolling-window/thời gian |
| **CS** | Composite/multi-signal scoring (tổng hợp nhiều tín hiệu thành 1 điểm rủi ro) | *(ngoài phạm vi 6 node hiện tại)* | Không — đây là model phái sinh, vượt "thống kê mô tả + diễn giải NL" (ràng buộc mục 2.3) |
| **GR** | Graph/network analysis (quan hệ nhiều bước giữa các thực thể) | *(ngoài phạm vi — hệ thống hiện chỉ có Vector DB, không có Graph DB)* | Không |

Mỗi epic dưới đây được gắn nhãn 1-2 ký hiệu để dễ tổng hợp ở mục 6.

---

## 1. Pain Point 1 — Kế toán (Kế toán tổng hợp)

**Persona:** Kế toán tổng hợp (General Ledger Accountant) · **Dữ liệu xử lý:** bút toán từ các phân hệ đổ về (AR, AP, kho), báo cáo tài chính

### Pain point hẹp
| Pain point hẹp | Chi tiết |
| :--- | :--- |
| Không phát hiện bút toán bất thường trước khi chốt sổ | Hàng chục nghìn bút toán/tháng, cần rà soát giá trị bất thường hoặc tài khoản đối ứng lạ |
| Số liệu từ các phân hệ không khớp khi hợp nhất | Dữ liệu AR/AP/kho đổ về GL không đồng bộ format/thời điểm, phải tự dò từng phân hệ |
| Áp lực thời gian: 3 ngày chốt sổ, 50% thời gian làm sạch dữ liệu | Duplicate, thiếu trường, sai định dạng chiếm hết thời gian lẽ ra dành cho phân tích |

> **User story:** Là kế toán tổng hợp, tôi muốn agent tự động profiling dữ liệu bút toán trước khi chốt sổ, để tôi phát hiện bút toán bất thường, thiếu trường, và sai lệch đối chiếu giữa các phân hệ trước khi dành thời gian phân tích thủ công.

### Epic breakdown & ánh xạ DATA-13

**Epic ACC-GL-1: Kiểm tra tính đầy đủ dữ liệu (Null-check)** `[NC]`
- AC1: Quét toàn bộ bút toán import, liệt kê % null theo từng trường bắt buộc
- AC2: Với trường null > 0%, liệt kê dòng cụ thể kèm nguồn phân hệ
- AC3: Phân loại null theo mức độ nghiêm trọng: Blocking vs Warning
- *Ánh xạ:* Khớp trực tiếp với `compute_stats` + báo cáo missing value (mục 6.1, 7). Riêng AC3 (phân loại Blocking/Warning) là logic nghiệp vụ cần cấu hình thêm ngoài % null thô.

**Epic ACC-GL-2: Phát hiện bút toán bất thường (Outlier)** `[OL]`
- AC1: Tính baseline giá trị bút toán theo tài khoản (lịch sử 6-12 kỳ)
- AC2: Gắn cờ bút toán lệch > ngưỡng (z-score hoặc %), ngưỡng cấu hình theo nhóm tài khoản
- AC3: Với tài khoản có tính mùa vụ, áp baseline theo cùng kỳ năm trước
- *Ánh xạ:* Vượt phạm vi outlier tĩnh (IQR/z-score một lần) hiện có trong `compute_stats` — cần baseline **động theo thời gian** (rolling theo kỳ) và **theo mùa vụ**, đây là điểm cần bổ sung thiết kế so với mục 7.

**Epic ACC-GL-3: Đối chiếu tài khoản đối ứng bất thường (Tương quan liên cột)** `[GD]`
- AC1: Học pattern cặp tài khoản Nợ-Có thường xuất hiện cùng nhau
- AC2: Gắn cờ cặp đối ứng hiếm gặp/chưa từng xuất hiện
- AC3: Báo cáo kèm % tần suất xuất hiện lịch sử
- *Ánh xạ:* Gần với correlation matrix trong `compute_stats`, nhưng thực chất là bài toán học tần suất đồng xuất hiện (association) giữa 2 cột phân loại — cần custom logic ngoài correlation matrix chuẩn của ydata-profiling.

**Epic ACC-GL-4: Đối chiếu số liệu giữa các phân hệ (Khóa ứng viên)** `[CK]`
- AC1: Tự động nhận diện trường khóa để join GL với phân hệ nguồn
- AC2: Phát hiện bản ghi lệch giữa 2 nguồn
- AC3: Gợi ý nguyên nhân khả dĩ kèm mức tin cậy — cần HITL xác nhận
- *Ánh xạ:* AC1 khớp trực tiếp `propose_metadata` (candidate key). AC2-AC3 mở rộng sang **đối chiếu liên bảng/liên hệ thống nguồn** — vượt phạm vi "1 dataset/1 bảng" mà kiến trúc mục 3 mô tả, cần thiết kế thêm bước join đa nguồn trước khi vào `compute_stats`.

### Ràng buộc đặc thù
Mọi cảnh báo phải trích dẫn số liệu gốc + công thức (khớp mục 2.3); HITL bắt buộc trước khi ghi nhận định vào audit log (khớp mục 2.1); tách riêng số liệu tạm/đã chốt; mask thông tin tài khoản ngân hàng/đối tác (khớp mục 2.2).

### Success metrics
| Chỉ số | Mục tiêu |
| :--- | :--- |
| Thời gian chốt sổ giảm | -20-30% so với baseline |
| Tỷ lệ phát hiện lỗi trước kiểm toán ngoài | Tăng |
| False positive rate | <15% |

**Đối chiếu ràng buộc hệ thống:** Domain này khớp gần như trọn vẹn với 4 ràng buộc mục 2 — đặc biệt củng cố lý do HITL (mục 2.1: "candidate key mơ hồ về nghiệp vụ" ở mục 10 chính là tình huống ACC-GL-4/AC3). Đây cũng là domain duy nhất trong 5 pain point có yêu cầu **đối chiếu đa nguồn** (multi-system reconciliation) rõ ràng, gợi ý cần bổ sung khả năng nhận diện khóa liên bảng chứ không chỉ trong 1 dataset.

---

## 2. Pain Point 2 — Bán lẻ/E-commerce (Inventory Analyst)

**Persona:** Nhân viên quản lý tồn kho (Inventory/Supply Chain Analyst) · **Dữ liệu xử lý:** tồn kho theo SKU × kho/chi nhánh, lịch sử nhập/xuất, lead time nhà cung cấp

### Pain point hẹp
| Pain point hẹp | Chi tiết |
| :--- | :--- |
| Không thấy tồn kho lệch giữa các kho dù tổng vẫn đủ | Kho A thừa, kho B thiếu → hệ thống báo "đủ hàng" theo tổng nhưng khách khu vực kho B vẫn out-of-stock |
| Không dự đoán chính xác thời điểm hết hàng theo SKU | Tốc độ bán đổi theo mùa/campaign, công thức min-max tĩnh không theo kịp |
| Phát hiện dead stock quá muộn | Chỉ phát hiện khi kiểm kê định kỳ, vốn đã bị chôn nhiều tháng |

> **User story:** Là nhân viên quản lý tồn kho, tôi muốn agent tự động profiling dữ liệu tồn kho theo SKU × kho/chi nhánh, để tôi phát hiện lệch tồn kho giữa các kho, dự đoán thời điểm hết hàng chính xác, và cảnh báo hàng tồn đọng sớm.

### Epic breakdown & ánh xạ DATA-13

**Epic INV-1: Phát hiện lệch tồn kho giữa các kho (Thống kê phân phối theo nhóm)** `[GD]`
- AC1: Tính phân phối tồn kho theo SKU × kho, hiển thị độ lệch chuẩn giữa các kho
- AC2: Gắn cờ "tổng đủ nhưng phân bổ lệch" theo ngưỡng % dư/thiếu
- AC3: Gợi ý điều chuyển hàng giữa kho — chỉ gợi ý, không tự thực thi
- *Ánh xạ:* Đây là group-by statistics theo 2 chiều (SKU × kho) — mở rộng so với thống kê mô tả theo từng cột độc lập mà `compute_stats` hiện mô tả (mục 7); cần thêm chiều phân tích nhóm.

**Epic INV-2: Dự đoán thời điểm hết hàng theo SKU (Outlier + trend trên tốc độ bán)** `[TR]` `[OL]`
- AC1: Tính sales velocity động theo cửa sổ 7/14/30 ngày
- AC2: Điều chỉnh dự đoán khi tốc độ bán biến động đột biến, không ngoại suy tuyến tính
- AC3: Gắn cờ "cần đặt hàng ngay" khi ngày dự kiến hết hàng < lead time + buffer
- AC4: Loại trừ SKU mùa vụ/campaign khỏi baseline thông thường
- *Ánh xạ:* Đây thực chất là bài toán **dự báo (forecasting)**, không chỉ diễn giải số liệu đã tính — vượt ràng buộc mục 2.3 ("LLM không tự tính hay đoán số", "chỉ diễn giải kết quả có sẵn"). Cần một compute engine riêng cho time-series forecasting, nằm ngoài phạm vi ydata-profiling.

**Epic INV-3: Cảnh báo tồn đọng sớm (Outlier trên chỉ số luân chuyển)** `[OL]`
- AC1: Tính Days Inventory Outstanding (DIO) theo SKU, so ngưỡng theo nhóm danh mục
- AC2: Gắn cờ DIO vượt ngưỡng liên tục qua N kỳ (tránh nhiễu ngắn hạn)
- AC3: Phân loại mức ưu tiên: Critical vs Watch
- *Ánh xạ:* DIO là chỉ số phái sinh (derived metric) từ dữ liệu thô — cần bước tính toán trung gian trước khi đưa vào `compute_stats`; ngưỡng theo N kỳ liên tục là logic rolling-window tương tự Epic ACC-GL-2.

### Ràng buộc đặc thù
Mọi gợi ý điều chuyển/đặt hàng qua HITL (khớp mục 2.1); ngưỡng cấu hình theo nhóm SKU (không hard-code); SKU campaign phải gắn nhãn riêng để không nhiễu baseline; trích dẫn số liệu gốc (khớp mục 2.3).

### Success metrics
| Chỉ số | Mục tiêu |
| :--- | :--- |
| Tỷ lệ out-of-stock cục bộ | Giảm 20-30% |
| Thời gian phát hiện dead stock | Từ theo kỳ kiểm kê → theo tuần |
| Vốn bị chôn ở hàng tồn đọng | Giảm thời gian trung bình xử lý |
| False positive rate | <15% |

**Đối chiếu ràng buộc hệ thống:** Domain này khớp tốt với ràng buộc sampling/chi phí (mục 2.4) nếu dữ liệu tồn kho nằm trên warehouse lớn (nhiều SKU × nhiều kho × lịch sử dài). Tuy nhiên INV-2 (dự đoán hết hàng) là điểm lệch rõ nhất so với triết lý "Agent chỉ diễn giải, không tự tính/đoán" — cần làm rõ ranh giới giữa "profiling mô tả" và "dự báo", có thể để forecasting là một agent/tool riêng nằm ngoài phạm vi DATA-13 gốc.

---

## 3. Pain Point 3 — Ngân hàng/AML

**Persona:** Chuyên viên AML · **Dữ liệu xử lý:** giao dịch, tài khoản, KYC, lịch sử luân chuyển dòng tiền

### Pain point hẹp
| Pain point hẹp | Chi tiết |
| :--- | :--- |
| Không phát hiện giao dịch chia nhỏ né ngưỡng (structuring) | Nhiều giao dịch dưới ngưỡng, cùng chủ thể/nhóm liên kết, hệ thống không cộng dồn |
| Không phát hiện mạng lưới luân chuyển vòng (layering) | Cần xâu chuỗi 4-5 bước giao dịch mới lộ pattern, không nhìn 1 giao dịch đơn lẻ |
| Quá tải cảnh báo giả (alert fatigue) từ rule tĩnh | Ngưỡng cố định sinh hàng trăm cảnh báo/ngày, phần lớn false positive |
| Thiếu baseline hành vi cá nhân hoá theo khách hàng | Ngưỡng chung cho mọi loại khách hàng, đánh giá cảm tính, không nhất quán |

> **User story:** Là chuyên viên AML, tôi muốn agent tự động phát hiện các mẫu giao dịch đáng ngờ (structuring, layering) qua nhiều tài khoản/thời gian, để tôi ưu tiên rà soát case rủi ro thực sự cao thay vì rà thủ công hàng trăm cảnh báo giả mỗi ngày.

### Epic breakdown & ánh xạ DATA-13

**Epic AML-1: Phát hiện giao dịch chia nhỏ né ngưỡng — Tương quan đa biến theo thời gian** `[TR]` `[GD]`
- AC1: Nhóm giao dịch theo chủ tài khoản/nhóm liên kết trong cửa sổ trượt, tính tổng giá trị gộp
- AC2: Gắn cờ khi tổng gộp vượt ngưỡng dù từng giao dịch riêng lẻ dưới ngưỡng
- AC3: Phân biệt structuring thật với hành vi hợp lệ dựa trên baseline lịch sử của chính tài khoản
- *Ánh xạ:* Đòi hỏi **entity resolution** (xác định "nhóm liên kết" thực sự đứng sau nhiều tài khoản) trước khi gộp — đây là bước tiền xử lý không có trong pipeline `sample → compute_stats` hiện tại.

**Epic AML-2: Phát hiện mạng lưới tài khoản liên kết bất thường (layering) — Khóa ứng viên mở rộng (graph-based)** `[GR]`
- AC1: Xây dựng graph liên kết giữa tài khoản dựa trên dòng tiền
- AC2: Phát hiện pattern vòng tròn (A→B→C→A) hoặc luân chuyển nhanh nhiều lớp
- AC3: Gắn cờ theo độ sâu chuỗi liên kết và tốc độ luân chuyển
- *Ánh xạ:* **Không khớp với kiến trúc hiện tại.** Mục 3 (project_context) chỉ liệt kê Vector DB cho retrieval (dense + sparse), không có Graph DB — trong khi bài toán layering về bản chất là graph traversal/cycle detection. Đây là gap kiến trúc rõ nhất trong toàn bộ 5 pain point.

**Epic AML-3: Giảm cảnh báo giả từ rule tĩnh (Outlier có ngữ cảnh)** `[OL]` `[CS]`
- AC1: Thay ngưỡng cố định bằng baseline hành vi theo loại khách hàng
- AC2: Mỗi cảnh báo kèm điểm rủi ro tổng hợp, không chỉ pass/fail 1 rule
- AC3: Học từ phản hồi chuyên viên để tinh chỉnh ngưỡng, nhưng thay đổi chính thức vẫn cần con người duyệt
- *Ánh xạ:* AC2 (điểm rủi ro tổng hợp từ nhiều yếu tố) là composite scoring — vượt phạm vi "diễn giải số liệu đã tính" thành *narrative*, đây là một **mô hình tính điểm riêng**. AC3 (feedback loop) đòi hỏi vòng lặp học liên tục, khác với luồng HITL một chiều (đề xuất → confirm/reject → ghi metadata) ở mục 2.1/7.

### Ràng buộc đặc thù (nghiêm ngặt hơn các domain khác)
Không tự động kết luận rửa tiền — chỉ xếp hạng ưu tiên; toàn bộ log phải lưu đầy đủ phục vụ thanh tra Ngân hàng Nhà nước (nghĩa vụ pháp lý); điều chỉnh ngưỡng phải qua change control chính thức; dữ liệu KYC/giao dịch tuân thủ bảo mật nghiêm ngặt hơn; không thiết kế hệ thống theo hướng "giải thích cách né phát hiện".

### Success metrics
| Chỉ số | Mục tiêu |
| :--- | :--- |
| False positive rate | Giảm đáng kể so với rule tĩnh |
| Thời gian rà soát trung bình/case | Giảm nhờ ưu tiên theo điểm rủi ro |
| Tỷ lệ case rủi ro cao phát hiện sớm hơn | Tăng |
| Tính đầy đủ audit trail | 100% (bắt buộc, không thương lượng) |

**Đối chiếu ràng buộc hệ thống:** Domain có ràng buộc governance/audit **cao hơn hẳn** mức mô tả chung ở mục 2.2/2.3 của project_context — mọi quyết định phải trace được và lưu trữ phục vụ thanh tra, không chỉ "trace ngược về số liệu" mà còn phải đáp ứng nghĩa vụ pháp lý dài hạn. Về mặt năng lực kỹ thuật, đây là domain có **độ lệch lớn nhất so với kiến trúc DATA-13 hiện tại** (thiếu Graph DB, thiếu entity resolution, thiếu composite scoring) — nếu chọn AML làm domain chính, kiến trúc mục 3 cần bổ sung đáng kể.

---

## 4. Pain Point 4 — Marketing

**Persona:** Chuyên viên phân tích Marketing · **Dữ liệu xử lý:** hiệu suất campaign đa kênh, đa segment theo thời gian thực

### Pain point hẹp
| Pain point hẹp | Chi tiết |
| :--- | :--- |
| Không phát hiện campaign "chết dần" đủ sớm | CTR/conversion giảm dần nhưng chưa đủ rõ, chỉ nhận ra khi đã lãng phí ngân sách |
| Không phân bổ hiệu quả khi khách hàng chạm nhiều kênh | Multi-touch attribution không xử lý được bằng Excel, quy hết công cho kênh cuối (last-click) |
| Không phát hiện audience segment suy giảm hiệu quả | Segment bão hòa (ad fatigue) nhưng ngân sách vẫn phân bổ như cũ |

> **User story:** Là chuyên viên phân tích Marketing, tôi muốn agent tự động profiling dữ liệu hiệu suất campaign theo thời gian thực, đa kênh, đa segment, để tôi phát hiện campaign suy giảm sớm, phân bổ đúng ngân sách, và phân biệt lỗi tracking với thay đổi hiệu suất thật.

### Epic breakdown & ánh xạ DATA-13

**Epic MKT-1: Cảnh báo campaign suy giảm sớm (Phân tích xu hướng theo thời gian)** `[TR]`
- AC1: Tính baseline hiệu suất (CTR, CVR, CPA) theo cửa sổ trượt 3/7/14 ngày
- AC2: Gắn cờ xu hướng giảm liên tục qua N ngày, phân biệt biến động ngày với xu hướng thật
- AC3: Kèm mức độ tin cậy cảnh báo theo số ngày giảm liên tiếp
- *Ánh xạ:* Cùng nhóm năng lực `[TR]` với ACC-GL-2 và INV-3 — củng cố nhận định ở mục 7 rằng **rolling-window trend detection** là năng lực lõi cần bổ sung, xuất hiện lặp lại ở ít nhất 4/5 domain.

**Epic MKT-2: Multi-touch attribution (Tương quan chuỗi sự kiện theo khách hàng)** `[CS]`
- AC1: Xâu chuỗi touchpoint theo khách hàng/session trước khi chuyển đổi
- AC2: Tính điểm đóng góp từng kênh theo mô hình cấu hình được (linear, time-decay, position-based)
- AC3: So sánh hiệu quả theo attribution model mới vs. last-click hiện tại
- *Ánh xạ:* Đây là một **mô hình phân bổ (attribution model)** độc lập, không phải thống kê mô tả cột — vượt hẳn phạm vi `compute_stats`/ydata-profiling. Tương tự Epic INV-2, đây là năng lực "tính toán mô hình" chứ không phải "diễn giải số liệu đã tính", cần compute engine riêng.

**Epic MKT-3: Phát hiện segment bão hòa (Outlier trên nhóm đối tượng)** `[GD]` `[OL]`
- AC1: Tính hiệu suất theo từng audience segment, so với baseline lịch sử của chính segment đó
- AC2: Gắn cờ dấu hiệu ad fatigue (CTR giảm, tần suất tăng mà conversion không tăng tương ứng)
- AC3: Gợi ý mức điều chỉnh — chỉ gợi ý, không tự động điều chỉnh ngân sách
- *Ánh xạ:* Kết hợp `[GD]` (group-wise theo segment) và `[OL]` (baseline riêng từng nhóm) — về cấu trúc tương tự INV-1, khớp tốt với hướng mở rộng group-by đã nêu ở mục 0.

**Epic MKT-4: Phân biệt lỗi tracking với thay đổi hiệu suất thật (Outlier có ngữ cảnh)** `[GD]`
- AC1: Phát hiện pattern đặc trưng lỗi tracking (1 kênh giảm về 0 đột ngột, các chỉ số liên quan không đổi tương ứng)
- AC2: So sánh biến động giữa các kênh cùng thời điểm
- AC3: Gắn nhãn: Nghi lỗi kỹ thuật vs Nghi suy giảm hiệu suất thật
- *Ánh xạ:* Tương đương về bản chất với Epic ACC-GL-3 (so sánh đồng thời biến động giữa các "cột"/kênh để phát hiện bất thường tương đối) — một minh chứng khác cho thấy **correlation/cross-column anomaly** là năng lực tái sử dụng được giữa các domain.

### Ràng buộc đặc thù
Không nêu rõ trong raw survey (phần constraints của domain Marketing không có trong tài liệu gốc); dựa trên các AC, cần suy ra: mô hình attribution phải cấu hình được (không hard-code 1 model); phân biệt rõ cảnh báo kỹ thuật vs hiệu suất thật trước khi đề xuất hành động.

### Success metrics
*(Không có trong `raw_survey.md` — phần Success Metrics của Pain Point 4 chưa được khảo sát/bổ sung.)*

**Đối chiếu ràng buộc hệ thống:** Về governance, domain Marketing có yêu cầu ràng buộc **lỏng hơn rõ rệt** so với AML/HR/Kế toán trong tài liệu gốc — không thấy đề cập PII masking hay HITL tường minh, dù MKT-2/MKT-3 (thay đổi phân bổ ngân sách) về logic vẫn nên qua HITL theo nguyên tắc mục 2.1. Đây là điểm cần làm rõ thêm nếu chọn domain này (constraints và success metrics chưa đầy đủ như 4 domain còn lại).

---

## 5. Pain Point 5 — HR

**Persona:** Chuyên viên C&B · **Dữ liệu xử lý:** chấm công, hiệu suất, lương, tương tác nội bộ, dữ liệu tuyển dụng

### Pain point hẹp
| Pain point hẹp | Chi tiết |
| :--- | :--- |
| Không phát hiện nguy cơ nghỉ việc (attrition) đủ sớm | Tín hiệu ẩn, rời rạc (giờ làm thêm giảm, tương tác giảm, nghỉ phép lẻ tăng), không kết nối được |
| Không phát hiện chênh lệch lương bất hợp lý quy mô lớn | Khó so sánh hàng nghìn nhân sự theo nhiều biến để phát hiện pay equity |
| Không xâu chuỗi hiệu suất qua nhiều kỳ đánh giá | Mỗi kỳ xem riêng lẻ, không thấy xu hướng giảm dần, phát hiện quá muộn |
| Dữ liệu tuyển dụng phân tán, khó đánh giá nguồn ứng viên | Nhiều kênh (LinkedIn, job board, referral, agency), format khác nhau |
| Không phát hiện bất thường trong chấm công/nghỉ phép | Khối lượng lớn, nhiều chi nhánh/ca, khó thấy pattern bất thường |
| Đánh giá ứng viên không nhất quán giữa các interviewer | Không có baseline so sánh độ khắt khe/dễ dãi giữa interviewer |

> **User story:** Là chuyên viên C&B, tôi muốn agent tự động profiling dữ liệu nhân sự (chấm công, hiệu suất, lương, tương tác nội bộ) để phát hiện nguy cơ nghỉ việc sớm và chênh lệch lương bất hợp lý, để tôi chủ động giữ chân nhân sự có nguy cơ rời bỏ và đảm bảo chính sách lương công bằng.

*(Lưu ý: raw_survey.md khảo sát 6 pain point hẹp nhưng chỉ breakdown chi tiết 3 epic — tương ứng attrition risk và pay equity. Phần "xâu chuỗi hiệu suất" được gộp làm tín hiệu bổ sung cho Epic HR-1; 3 pain point hẹp còn lại — chấm công bất thường, tuyển dụng phân tán, đánh giá interviewer không nhất quán — chưa có epic breakdown tương ứng trong tài liệu gốc.)*

### Epic breakdown & ánh xạ DATA-13

**Epic HR-1: Cảnh báo nguy cơ nghỉ việc sớm (Tương quan đa biến theo thời gian)** `[CS]` `[TR]`
- AC1: Tổng hợp tín hiệu rời rạc theo nhân sự qua thời gian (giờ làm thêm, nghỉ phép lẻ, tương tác nội bộ, thời gian phản hồi)
- AC2: Tính risk score tổng hợp dựa trên xu hướng suy giảm đồng thời nhiều tín hiệu
- AC3: Gắn cờ risk score vượt ngưỡng liên tục qua N tuần
- AC4: Báo cáo cho quản lý/HRBP, không thông báo tự động cho nhân sự — tránh tạo cảm giác bị giám sát
- *Ánh xạ:* AC2 là composite multi-signal scoring — cùng nhóm `[CS]` với AML-3, vượt phạm vi "diễn giải số liệu đã tính" vì bản thân risk score là một **model tổng hợp**, không phải một con số đo được trực tiếp. AC4 là một ràng buộc UX/đạo đức đặc thù không có tương đương ở 4 domain còn lại.

**Epic HR-2: Phát hiện chênh lệch lương bất hợp lý (Outlier + phân phối theo nhóm)** `[GD]` `[OL]`
- AC1: Tính phân phối lương theo nhóm tương đồng (vị trí, cấp bậc, kinh nghiệm, khu vực)
- AC2: Gắn cờ cá nhân/nhóm lệch chuẩn so với nhóm tương đồng
- AC3: Phân tích chênh lệch theo chiều nhạy cảm (giới tính, khu vực, phòng ban) để phát hiện pattern hệ thống
- AC4: Báo cáo ẩn danh ở cấp rộng để tránh vi phạm quyền riêng tư
- *Ánh xạ:* Đây là epic **khớp tốt nhất với kiến trúc hiện tại** trong toàn bộ domain HR — gần như tương đương INV-1/MKT-3 (`[GD]`), khác biệt chính là yêu cầu ẩn danh hoá bổ sung (AC4), khớp trực tiếp với triết lý PII masking mục 2.2 nhưng ở mức độ tổng hợp nhóm thay vì mức bản ghi.

**Epic HR-3: Xâu chuỗi hiệu suất qua nhiều kỳ đánh giá (Trend analysis)** `[TR]`
- AC1: Tổng hợp điểm đánh giá qua các kỳ liên tiếp cho từng nhân sự
- AC2: Phát hiện xu hướng giảm dần liên tục — tín hiệu bổ sung cho risk score ở HR-1
- AC3: Kết hợp với dữ liệu attrition risk để tăng độ tin cậy khi cả 2 tín hiệu cùng xuất hiện
- *Ánh xạ:* `[TR]` thuần tuý, cùng nhóm với ACC-GL-2/MKT-1. AC3 (kết hợp nhiều nguồn tín hiệu để tăng confidence) tái khẳng định nhu cầu về một tầng composite scoring dùng chung, thay vì xây riêng cho từng domain.

### Ràng buộc đặc thù (dữ liệu nhân sự rất nhạy cảm)
Phân tích cấp cá nhân chỉ hiển thị cho người có thẩm quyền; risk score/attrition không được dùng để đánh giá/kỷ luật — chỉ hỗ trợ retention; pay equity theo chiều nhạy cảm phải tuân thủ quy định chống phân biệt đối xử, dùng để điều chỉnh chính sách chứ không gắn nhãn cá nhân; HITL bắt buộc cho mọi hành động giữ chân/điều chỉnh lương; log truy cập risk score phải kiểm soát chặt.

### Success metrics
| Chỉ số | Mục tiêu |
| :--- | :--- |
| Tỷ lệ nghỉ việc ngoài dự kiến (không có tín hiệu cảnh báo trước) | Giảm so với baseline |
| Thời gian phát hiện nguy cơ nghỉ việc trước khi nộp đơn | Tăng |
| Số case chênh lệch lương bất hợp lý được phát hiện và điều chỉnh | Tăng |
| False positive rate (cảnh báo rủi ro nghỉ việc sai) | <20% (ngưỡng cao hơn AML vì hệ quả sai ít nghiêm trọng hơn) |

**Đối chiếu ràng buộc hệ thống:** Domain HR có mức độ nhạy cảm dữ liệu **tương đương AML** (yêu cầu phân quyền chặt, log truy cập kiểm soát) nhưng khác về bản chất rủi ro: AML lo về gian lận/pháp lý, HR lo về đạo đức sử dụng dữ liệu con người (AC4 của HR-1 là ví dụ điển hình không xuất hiện ở domain nào khác). Về mặt kỹ thuật, HR-2 khớp tốt với kiến trúc MVP hiện tại, trong khi HR-1/HR-3 (attrition) đòi hỏi composite scoring — cùng loại gap với AML-3.

---

## 6. Bảng tổng hợp chéo 5 domain

| Domain | Persona | Pain point cốt lõi | Năng lực DATA-13 chính | Mức độ khớp MVP hiện tại | Năng lực cần bổ sung |
|---|---|---|---|---|---|
| **1. Kế toán** | Kế toán tổng hợp | Bút toán bất thường, đối chiếu phân hệ | NC, OL, GD, CK | **Cao** — hầu hết epic ánh xạ trực tiếp vào `compute_stats`/`propose_metadata` | Baseline theo mùa vụ; đối chiếu khóa liên bảng (đa nguồn) |
| **2. Retail/E-com** | Inventory Analyst | Lệch tồn kho, dự đoán hết hàng, dead stock | GD, OL, TR | **Cao–Trung bình** | Forecasting thời điểm hết hàng (vượt phạm vi "diễn giải số liệu") |
| **3. Ngân hàng/AML** | Chuyên viên AML | Structuring, layering, alert fatigue | TR, GD, GR, CS | **Thấp** — GR (graph) hoàn toàn ngoài kiến trúc hiện tại | Graph DB/network analysis; entity resolution; composite risk score; audit-trail cấp pháp lý |
| **4. Marketing** | Chuyên viên Marketing | Campaign suy giảm, multi-touch attribution, segment bão hòa | TR, GD, CS | **Trung bình** | Attribution model (sequence-based); real-time streaming; constraints/success metrics chưa đầy đủ trong khảo sát gốc |
| **5. HR** | Chuyên viên C&B | Attrition risk, pay equity, xu hướng hiệu suất | GD, OL, TR, CS | **Trung bình** — HR-2 khớp tốt, HR-1/HR-3 cần composite | Composite multi-signal scoring; tổng hợp dữ liệu tuyển dụng đa nguồn |

**Ghi chú ký hiệu:** NC = Null-check · OL = Outlier (baseline) · GD = Group-wise distribution · CK = Candidate key/liên bảng · TR = Trend theo thời gian · CS = Composite scoring · GR = Graph/network.

---

## 7. Nhận định chung & khuyến nghị

**a) Năng lực lặp lại nhiều nhất qua 5 domain là Trend detection (TR) và Outlier theo baseline động (OL).** Cả 5 pain point đều xoay quanh việc phân biệt "biến động ngắn hạn tự nhiên" với "xu hướng bất thường thật" (bút toán, tồn kho, giao dịch, campaign, hiệu suất nhân sự) — trong khi `compute_stats` ở mục 7 (project_context.md) hiện mới mô tả outlier tĩnh (IQR/z-score một lần). Đây là khoảng cách rõ nhất giữa kiến trúc hiện tại và nhu cầu thực tế xuyên domain, nên được ưu tiên bổ sung dưới dạng một năng lực lõi dùng chung (rolling-window baseline), thay vì xây riêng lẻ theo từng domain.

**b) HITL và yêu cầu trích dẫn số liệu gốc là ràng buộc xuyên suốt, không riêng domain nào** — củng cố đúng đắn quyết định thiết kế ở mục 2.1/2.3 của project_context. Mức độ nghiêm ngặt tăng dần: Marketing (lỏng nhất, thậm chí thiếu trong khảo sát gốc) → Retail/Kế toán (rõ ràng, chuẩn mực) → HR/AML (nghiêm ngặt nhất, gắn với đạo đức và nghĩa vụ pháp lý).

**c) Ba domain (AML, Marketing, HR) đòi hỏi năng lực nằm ngoài 6 node đã mô tả ở mục 7** — cụ thể là graph analysis (AML), attribution modeling (Marketing), và composite multi-signal scoring (AML/HR). Đây đều là các **mô hình phái sinh** cần tính toán riêng, khác về bản chất với "thống kê mô tả từng cột rồi diễn giải bằng NL" mà ràng buộc mục 2.3 xác lập. Nếu muốn phục vụ các domain này, cần cân nhắc: (i) mở rộng phạm vi Agent để bao gồm các compute engine chuyên biệt, hoặc (ii) giữ nguyên phạm vi "profiling mô tả" và coi các năng lực này là hệ thống riêng tiêu thụ output của DATA-13 (báo cáo/metadata) làm input.

**d) Liên hệ với backlog "Nâng cao" (mục 6.2, project_context.md):** Multi-agent drift detection có thể tái sử dụng trực tiếp logic TR (Epic ACC-GL-2, MKT-1, HR-3); Eval suite (precision/recall candidate key) có dữ liệu benchmark khả dĩ từ Epic ACC-GL-4/AML-2; "Gợi ý bước làm sạch dữ liệu" liên hệ trực tiếp Epic ACC-GL-1 (null-check → remediation). Ngược lại, composite scoring và graph analysis **chưa nằm trong backlog nâng cao hiện tại** và cần được bổ sung nếu muốn mở rộng sang AML/HR đầy đủ.

**e) Khuyến nghị cho câu hỏi mở mục 11 ("1 domain chính hay nhiều domain chung"):** Dựa trên mức độ khớp với kiến trúc đã chốt (bảng mục 6), **Kế toán và Retail/E-commerce là 2 domain phù hợp nhất để làm MVP pilot** — phần lớn epic ánh xạ trực tiếp vào node sẵn có, không đòi hỏi Graph DB hay attribution model riêng (ngoại trừ Epic INV-2 cần cân nhắc tách forecasting ra khỏi phạm vi lõi). AML và Marketing nên xếp vào giai đoạn mở rộng sau MVP do khoảng cách kiến trúc lớn (đặc biệt AML với năng lực graph). HR ở vị trí trung gian: Epic HR-2 (pay equity) có thể đưa vào MVP cùng nhóm GD với Retail/Kế toán, trong khi HR-1/HR-3 (attrition) nên hoãn đến khi năng lực composite scoring được thiết kế.