# 06 · Context và compaction

Một phiên chạy lâu giữ context hữu ích mà không phình to thế nào. **Phụ thuộc:** [01](01-glossary.md), [03](03-agent-loop.md), [04](04-agent-folder.md), [09](09-routines.md).

## Bố cục

Context lớn dần từ trái sang phải, và compaction đặt lại nó:

```text
[system prompt] [current_state + input mới]
[system prompt] [lịch sử ...] [current_state + input mới]
[system prompt] [lịch sử ............] [current_state + input mới]
                     ↓ compaction (epoch mới)
[system prompt (render lại)] [tóm tắt] [current_state + input mới]
```

Context của một agent được xác định hoàn toàn bởi:

> `agent_epochs[mới nhất].system_prompt` + `agent_epochs[mới nhất].summary` + các `events` có `seq > agent_epochs[mới nhất].start_seq`, theo thứ tự `seq`.

## System prompt

System prompt được render **một lần mỗi epoch** và lưu ở `agent_epochs.system_prompt`. Nó không bao giờ được render lại trong một epoch.

```text
<platform_rules>        platform/rules.md (+ mục "Lead duties" nếu is_lead)
<role>                  prompts/system.md
<context>               prompts/context.md
<memory_index>          memory/index.md
<skills>                mỗi skills/*/SKILL.md một dòng: "- <name>: <description>  (skills/<dir>/SKILL.md)"
<environment>           đường dẫn thư mục, phiên bản Python, tên key theo từng bộ credentials đã gắn, package đã cài
```

`platform/rules.md` gồm:
- **Tool và helper:** tool Python duy nhất, và các helper `contoso` cùng chữ ký của chúng.
- **Nhắn tin:** im lặng là mặc định; khi nào nên nhắn người dùng; `final=True`; thông báo và khối công việc.
- **Quy ước thư mục:** nơi cất sở thích, quy trình, helper và sự thật lâu dài ([04](04-agent-folder.md#tự-cải-thiện)).
- **Quy tắc cứng:** không bao giờ sửa hay in file `.env.d/`, hay bất kỳ giá trị nào đọc từ chúng; không ghi ra ngoài thư mục; giữ lịch chạy ngắn.
- **Nhiệm vụ của lead** (chỉ lead): sở hữu hàng đợi; xử lý công việc `<begin_task>` tự làm hoặc giao bằng `send_to_agent`; trả lời người dùng; gọi `end_task`. Coi yêu cầu giúp task hiện tại là câu hỏi phụ.

## Cách render

`harness/render.py` chuyển context thành danh sách `messages` theo định dạng OpenAI:

| Nguồn | Message |
|---|---|
| `system_prompt` | `{"role": "system", "content": system_prompt}` |
| `summary` (nếu không rỗng) | `{"role": "user", "content": "<summary>\n…\n</summary>"}` |
| event `input` | `{"role": "user", "content": payload.text}` |
| event `assistant` | `{"role": "assistant", "content": payload.text hoặc null, "tool_calls": [...]}` |
| event `tool_result` | `{"role": "tool", "tool_call_id": …, "content": payload.text}` |
| event `error` | `{"role": "user", "content": "<error code=…>…</error>"}` |

- **`payload.text` đã lưu chính là thứ đã gửi.** Việc render không bao giờ định dạng lại event cũ, nên phần tiền tố ổn định từng byte.
- **Context có thể kết thúc bằng một message `tool`** rồi tiếp ngay một message `user` mới (sau `final=True`). Điều đó hợp lệ trong định dạng OpenAI, và OpenRouter tự chuyển đổi cho model Anthropic. Test hợp đồng live ([17](17-testing.md)) kiểm tra điều này.
- **Điểm đặt cache.** Với model `anthropic/*`, renderer thêm `cache_control: {"type": "ephemeral"}` vào system message và vào message cuối. Các nhà cung cấp khác tự cache tiền tố.

## `current_state`

Harness render và đặt ở đầu mỗi event `input`:

```text
<current_state>
time: 2026-10-17T10:02:11+07:00
you: data ("Data")
lead: lead ("Điều phối")
team: lead, data, insight, compare, chart, report
task: T42 "Vì sao căn MAS-U03832 bán chậm…" (running since 10:01)
status: busy
pending: 2 notifications; routines: bao-cao-sang
</current_state>
```

- Với lead, dòng `lead: you` được dùng, và một dòng `queue: 2 queued` đứng sau `task:`.
- `task: none` khi người dùng không có task nào đang chạy. Mô tả task được cắt còn 60 ký tự (kết thúc bằng `…`); `pending: none` khi không có gì chờ. Giờ theo `Asia/Ho_Chi_Minh`.

## Các mục input

Phần còn lại của event `input` là một phần tử cho mỗi mục, cũ trước:

```text
<notification id="d_981" from="user:alice" thread="direct:data" message="m_5521" at="10:02:05">
Lấy giúp bảng giá dự án 100.
attachments: files/inbox/m_5521/bang-gia.xlsx
</notification>
<notification id="d_982" from="agent:lead" thread="agent:lead+data" message="m_5522" at="10:02:09">
…
</notification>
<notice id="d_990" kind="builder" at="10:05:00">Kỹ năng mới: xlsx — đọc skills/xlsx/SKILL.md</notice>
<routine name="bao-cao-sang" fired_at="08:00:00">…prompt…</routine>
<begin_task id="T42" source_message="m_5520" thread="direct:lead">
Phân tích vì sao căn MAS-U03832 bán chậm, so sánh căn tương đồng, vẽ biểu đồ, xuất báo cáo.
--- original message ---
Vì sao căn MAS-U03832 bán chậm? So sánh với các căn tương đồng, vẽ biểu đồ và xuất báo cáo.
</begin_task>
```

`thread` dùng id dễ đọc: `direct:<slug>`, `group:<thread_id>` (kèm thuộc tính `name="…"`), `agent:<slug>+<slug>…`. Các helper nhận đúng các id này.

## Chỉ nối thêm trong lúc task chạy

Không thứ gì đã có trong context thay đổi trong lúc task chạy. Input mới được nối vào cuối, và các khối `current_state` cũ ở nguyên chỗ. Điều này giữ prefix cache của nhà cung cấp hợp lệ. Đặt `current_state` trong system prompt sẽ làm mất toàn bộ cache mỗi lượt. Có một ngoại lệ: offload hàng loạt dự phòng bên dưới, tốn một lần trượt cache và được ghi lại ([quyết định 0005](decisions/0005-append-only-context-during-a-task.md)).

## Offload output lớn

1. **Khi output tới.** Nếu `stdout` + `stderr` dài hơn `OFFLOAD_CHARS` (mặc định 8.000), `api` ghi toàn bộ output ra `.contoso/outputs/<exec_id>.txt`. Kết quả tool khi đó chỉ chứa 2.000 ký tự đầu và 2.000 ký tự cuối của output (stdout, rồi stderr), cộng đường dẫn ([03](03-agent-loop.md#định-dạng-kết-quả-tool)). Agent đọc lại file khi cần thêm, tốn thêm một exec.
2. **Dự phòng.** Nếu ước lượng vượt ngưỡng cứng ([03](03-agent-loop.md#giới-hạn-context-trong-một-bước)), mọi `tool_result` trong epoch hiện tại chưa offload, trừ cái mới nhất, được offload cùng một lúc. Việc đó ghi lại `payload.text` của chúng sang dạng đã offload, đặt `payload.batch_offloaded_at`, và nối một event `error` (`batch_offload`, kèm số lượng) để lần mất cache hiện ra trong trace.
3. **Thất bại.** Nếu context vẫn vượt ngưỡng cứng, quy tắc `context_overflow` ở [03](03-agent-loop.md#giới-hạn-context-trong-một-bước) được áp dụng.

File đã offload được giữ suốt vòng đời của thư mục (xem [99](99-risks-and-future-work.md)).

## Compaction

Compaction chuyển thông tin ra khỏi lịch sử để context không phình to:

- sự thật lâu dài vào thư mục (trí nhớ, `prompts/context.md`, kỹ năng), nên chúng trở lại trong system prompt của epoch sau;
- mọi thứ khác cần để tiếp tục vào một bản tóm tắt mới, thay cho bản cũ.

**Khi nào chạy** ([quyết định 0004](decisions/0004-no-compaction-during-a-task.md)):
- Compaction chuyển sang **chờ** trong bốn trường hợp: ước lượng vượt `SOFT_CONTEXT_RATIO`, sửa prompt từ builder, `context_overflow`, hoặc admin bấm "compact now".
- Nó **chỉ chạy ở điểm an toàn**: agent rảnh và không nằm trong `task_involvement` của task đang chạy. Compaction trong lúc task mà agent tham gia đang chạy là lỗi nghiêm trọng, và có test chặn điều đó.
- Nó là lịch chạy có sẵn, nên tuân theo quy tắc lịch chạy: tối đa một lần chờ, và đứng sau delivery và lịch chạy đang chờ ([03](03-agent-loop.md#activation)).
- Lead compaction giữa hai task: sau `end_task`, và trước `begin_task` của task kế tiếp.

**Quy trình** (`harness/compaction.py`):
1. Nối một event `input` với `current_state` và `<compaction>` + `platform/compaction.md`. Prompt đó bảo agent:
   - cập nhật `memory/*.md` và `memory/index.md`, `prompts/context.md`, và kỹ năng, với những gì nó đã học;
   - rồi gọi `contoso.write_summary(text)`, chứa những gì cần để tiếp tục: cam kết còn mở, quyết định gần đây, câu hỏi chưa giải quyết, và vài lượt trao đổi cuối của từng hội thoại;
   - không gửi tin nhắn nào.
2. Chạy vòng lặp bước bình thường với `COMPACTION_MODEL`. `send_to_user` và `send_to_agent` trả lỗi trong lúc compaction.
3. Compaction **thành công** khi `write_summary` được gọi với text không rỗng và activation kết thúc.
   - `api` render system prompt mới từ thư mục.
   - Nó ghi `agent_epochs(epoch+1, start_seq=<seq cuối>, system_prompt, summary, reason='compaction')`. Vì `start_seq` là seq cuối, chính các event của compaction bị loại khỏi context mới.
   - Nó tạo commit harness `epoch <n>` nếu có file thay đổi.
4. Compaction **thất bại** nếu `write_summary` không được gọi, hoặc khi lỗi model hay hết số bước. Epoch giữ nguyên và compaction vẫn chờ, thử lại ở điểm an toàn kế tiếp sau backoff 1, 5, rồi 30 phút (lưu trong bộ nhớ, nên khởi động lại thì thử ngay). Gọi `write_summary` ngoài lúc nén là 409 `not_compacting`. Sau 3 lần thất bại, agent hiện `compaction_failed` trên trang tổng quan của admin.
5. Nếu chính context compaction sẽ vượt ngưỡng cứng, nó được offload hàng loạt trước. Nếu vẫn quá lớn, harness mở epoch mới với `summary = tóm tắt trước + "\n[Ngữ cảnh trước đó bị lược bỏ do vượt giới hạn]"` và nối event `error` (`compaction_truncated`).

## Khi nào mất cache

Prefix cache chỉ bị đặt lại khi mở epoch mới (lúc compaction hoặc khôi phục) và khi chạy offload hàng loạt dự phòng. Cả hai đều hiếm và đều được ghi lại.

## Cấu hình

| Key | Mặc định | Ý nghĩa |
|---|---|---|
| `SOFT_CONTEXT_RATIO` | 0.6 | Tỉ lệ cửa sổ mà tại đó compaction chuyển sang chờ |
| `HARD_CONTEXT_RATIO` | 0.9 | Tỉ lệ cửa sổ mà tại đó offload hàng loạt chạy |
| `OFFLOAD_CHARS` | 8000 | Kích thước output mà vượt quá thì bị offload |
| `OFFLOAD_HEAD_CHARS` / `OFFLOAD_TAIL_CHARS` | 2000 / 2000 | Phần giữ lại trong context |
| `COMPACTION_MODEL` | giống `AGENT_MODEL` | Model dùng cho compaction |
