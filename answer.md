# Câu hỏi Đánh giá Sản phẩm — AI Data Profiling Agent

---

## Câu 1: AI trong sản phẩm quyết định điều gì và sử dụng model nào?

AI quyết định câu hỏi về dataset là hỏi về **một số liệu cụ thể** (quantitative — truy vấn thẳng từ DB) hay hỏi **mang tính nhận xét, so sánh, lịch sử** (qualitative — dùng vector search) để điều hướng sang nhánh xử lý đúng trong QA pipeline — dùng **gpt-4o-mini**.

---

## Câu 2: Tổng số câu trong bộ thử nghiệm

> **Điền vào ô dưới đây sau khi hoàn thành bộ thử nghiệm.**

**Tổng số câu: `___/___`**

*(Xem file đầy đủ tại: [`eval/test_cases.md`](./eval/test_cases.md))*

---

## Câu 3: Bộ câu thử có bao nhiêu kiểu tình huống?

Bộ câu thử bao gồm đủ 4 kiểu tình huống (mỗi kiểu ≥ 2 câu):

| # | Kiểu tình huống | Số câu | Đủ? |
|---|----------------|--------|-----|
| A | Câu mà thông tin cần trả lời **KHÔNG có** trong dữ liệu — xem AI có bịa không | ≥ 2 | ☐ |
| B | Câu **mơ hồ, thiếu ngữ cảnh** — xem AI hỏi lại hay đoán bừa | ≥ 2 | ☐ |
| C | Câu đòi thứ sản phẩm **không được phép làm** (ví dụ: lấy dữ liệu raw của cột PII) | ≥ 2 | ☐ |
| D | Câu mà trả lời sai **gây hậu quả thật** (analytics sai, quyết định kinh doanh lệch) | ≥ 2 | ☐ |

*(Tick ☐ → ✅ sau khi hoàn thành bộ câu trong eval/)*

---

## Câu 4: Số lượng câu hỏi bắt nguồn từ quan sát thực tế

> **Điền sau khi hoàn thành bộ câu.**

**Số câu từ thực tế: `___` câu**

Nguồn:
- [ ] Chatlog AI / log tương tác khi tự dùng thử sản phẩm
- [ ] Câu hỏi nguyên văn đã khảo sát từ người dùng thực (Analyst)
- [ ] Tình huống nhóm gặp khi test thực tế với dataset mẫu
- [ ] Log Discord / discussion nội bộ

*(Tối thiểu 5 câu, khuyến nghị ≥ 10 để không bị trừ điểm)*

---

## Câu 5: Kết quả chạy thử lần đầu đạt bao nhiêu câu?

> **Điền sau khi chạy thử.**

**Kết quả: `___/___`**

*(Bảng kết quả đầy đủ (có cả câu fail) xem tại: [`eval/results/run_01.md`](./eval/results/run_01.md))*

---

## Câu 6: Chuẩn đạt của nhóm là bao nhiêu?

**Cam kết của nhóm (đặt trước khi đo, không thay đổi sau):**

1. **Con số phần trăm toàn bộ:** ≥ 80% câu thử đạt.
2. **Điều nhóm KHÔNG cho phép sai dù một lần:** AI không được tự bịa bất kỳ số liệu thống kê nào (null%, cardinality, correlation…) mà không có trong profiling result đã tính — mọi con số phải trace ngược được về `stats_json` thực tế.

> **Lý do chọn "không bịa số":** Người dùng (Data Analyst) sẽ tin ngay vào số AI trả về để ra quyết định nghiệp vụ (chọn khóa chính, đánh dấu PII, v.v.). Trả lời sai một con số dẫn đến metadata sai trong kho dữ liệu production — hậu quả có thể kéo dài và khó phát hiện.
