# 0004 · Không compaction giữa task

- **Bối cảnh.** Compaction giữa task làm mất context đang làm việc.
- **Quyết định.** Compaction chỉ chạy ở điểm an toàn (rảnh, và không tham gia task đang chạy). Ngưỡng mềm, việc sửa prompt từ builder hoặc tràn context sẽ lên lịch cho nó.
- **Đã loại.** Lưu checkpoint rồi khởi động lại giữa task, tức là compaction giữa task dưới tên gọi khác.
- **Hệ quả.** Task vượt quá context sau offload hàng loạt sẽ thất bại. Xem [06](../06-context-and-compaction.md#compaction).
