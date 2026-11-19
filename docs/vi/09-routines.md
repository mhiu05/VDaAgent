# 09 · Lịch chạy

Công việc theo lịch của một agent. **Phụ thuộc:** [01](01-glossary.md), [03](03-agent-loop.md), [07](07-routing-and-queue.md).

## Định nghĩa

Lịch chạy là một file `routines/<name>.yaml` trong thư mục của chủ sở hữu. Cả người dùng (tab Lịch) lẫn agent đều sửa được.

```yaml
prompt: |
  Tóm tắt các căn mới bán chậm hơn 90 ngày và gửi cho người dùng nếu có thay đổi so với hôm qua.
cron: "0 8 * * 1-5"      # cron 5 trường, Asia/Ho_Chi_Minh
enabled: true
```

- **`name`** là tên file (bỏ đuôi) và khớp `^[a-z0-9-]{2,32}$`.
- **File không hợp lệ** (YAML hỏng, cron sai, thiếu prompt) bị bỏ qua. Agent nhận một notice `routine_invalid` cho mỗi nội dung file (theo sha256, lưu ở `notice.sha256`), và builder hiện lỗi. Routine đang chờ mà file bị xoá hoặc trở nên không hợp lệ thì bị bỏ.

## Quy tắc

- **Tới hạn.** Khi lịch chạy tới hạn, nó chuyển sang chờ với chủ sở hữu. Nó chạy trong phiên chính của chủ sở hữu, và chỉ khi chủ sở hữu rảnh, kể cả những lúc rảnh giữa một task toàn cục ([quyết định 0003](decisions/0003-routines-run-only-when-the-owner-is-idle.md)).
- **Thứ tự.** Delivery đang chờ được xử lý trước lịch chạy đang chờ. Khi nhiều lịch cùng chờ, lịch tới hạn sớm nhất chạy trước.
- **Không dồn đống.** Mỗi lịch chạy có tối đa một lần đang chờ. Nếu nó tới hạn lần nữa khi vẫn đang chờ, các lần tới hạn gộp thành một.
- **Tin đến trong lúc chạy lịch** theo quy tắc thông báo bình thường: agent xử lý sau khối công việc hiện tại. Vì vậy lịch chạy nên ngắn, và `platform/rules.md` nói rõ điều đó.
- **Tách khỏi task.** Lịch chạy không bao giờ vào hàng đợi task toàn cục và không bao giờ chạy song song với việc khác của chủ sở hữu.
- **Nhắn tin.** Lịch chạy có thể gọi `send_to_user`. Không có `thread` thì tin vào hội thoại trực tiếp của agent.

## Bộ lập lịch

`harness/scheduler.py` chạy mỗi giây một nhịp:

1. **Nạp lại.** Khi runner khởi động và mỗi khi agent rảnh lại sau một activation, runner đọc lại `routines/*.yaml` và đồng bộ `routine_state`:
   - Nó thêm dòng cho file mới và xoá dòng của file đã bị xoá.
   - Khi cron đổi, nó tính lại `next_fire_at` bằng `croniter(cron, now, tz=Asia/Ho_Chi_Minh)`.
   - Ghi từ builder kích hoạt cùng việc đồng bộ ngay lập tức.
2. **Kích hoạt.** Với mỗi dòng `routine_state` có `enabled` và `next_fire_at <= now`, nó đặt `pending=true`, đặt `last_fired_at=now`, đẩy `next_fire_at` sang lần kế tiếp sau `now`, và đánh thức chủ sở hữu.
3. **Lần bị lỡ** (app đang tắt) gộp thành một: khi khởi động, mọi dòng có `next_fire_at` trong quá khứ chuyển sang chờ một lần.
4. **Bắt đầu và kết thúc.** Khi một activation bắt đầu với lịch chạy, runner đặt `pending=false` và `last_started_at`, và ghi `last_ended_at` khi nó kết thúc.

Cùng nhịp đó cũng áp `TASK_MAX_S` ([07](07-routing-and-queue.md#hàng-đợi-task-toàn-cục)).

## Compaction là lịch chạy có sẵn

Compaction tuân theo quy tắc của lịch chạy (chỉ chạy khi rảnh, tối đa một lần chờ), cộng một điều kiện chặt hơn: chỉ chạy ở điểm an toàn ([06](06-context-and-compaction.md#compaction)). Cờ chờ của nó là `agents.compaction_pending`, không phải một dòng `routine_state`.
