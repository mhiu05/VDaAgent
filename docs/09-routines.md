# 09 · Routines

Scheduled work owned by one agent. **Depends on:** [01](01-glossary.md), [03](03-agent-loop.md), [07](07-routing-and-queue.md).

## Definition

A routine is a file `routines/<name>.yaml` in its owner's folder. Both the user (Lịch tab) and the agent can edit it.

```yaml
prompt: |
  Tóm tắt các căn mới bán chậm hơn 90 ngày và gửi cho người dùng nếu có thay đổi so với hôm qua.
cron: "0 8 * * 1-5"      # 5-field cron, Asia/Ho_Chi_Minh
enabled: true
```

- **`name`** is the file stem and matches `^[a-z0-9-]{2,32}$`.
- **Invalid files** (bad YAML, a bad cron, a missing prompt) are skipped. The agent gets one `routine_invalid` notice per file content (keyed by sha256, stored as `notice.sha256`), and the builder shows the error. A pending routine whose file was removed or became invalid is dropped.

## Rules

- **Firing.** When a routine fires, it becomes pending for its owner. It runs in the owner's main session, and only while the owner is idle, including idle periods in the middle of a global task ([decision 0003](decisions/0003-routines-run-only-when-the-owner-is-idle.md)).
- **Order.** Pending deliveries are handled before pending routines. When several routines are pending, the oldest due runs first.
- **No pile-up.** At most one instance of each routine is pending. If it fires again while still pending, the fires collapse into one.
- **Messages during a routine** follow the normal notification rule: the agent handles them after its current block of work. Routines should therefore be short. `platform/rules.md` says so.
- **Separation from tasks.** Routines never enter the global task queue and never run alongside the owner's other work.
- **Messaging.** A routine may call `send_to_user`. With no `thread`, the message goes to the agent's direct thread.

## Scheduler

`harness/scheduler.py` ticks every second:

1. **Reload.** When a runner starts and whenever its agent goes idle after an activation, it re-reads `routines/*.yaml` and syncs `routine_state`:
   - It inserts rows for new files and deletes rows for removed files.
   - When the cron changes, it recomputes `next_fire_at` with `croniter(cron, now, tz=Asia/Ho_Chi_Minh)`.
   - Builder writes trigger the same sync straight away.
2. **Fire.** For each `routine_state` row with `enabled` and `next_fire_at <= now`, it sets `pending=true`, sets `last_fired_at=now`, advances `next_fire_at` to the next time after `now`, and wakes the owner.
3. **Missed fires** (the app was down) collapse into one: on boot, every row whose `next_fire_at` is in the past becomes pending once.
4. **Start and end.** When an activation starts on a routine, the runner sets `pending=false` and `last_started_at`, and records `last_ended_at` when it ends.

The same tick also enforces `TASK_MAX_S` ([07](07-routing-and-queue.md#global-task-queue)).

## Compaction is a built-in routine

Compaction follows the routine rules (it runs only when idle, and at most one is pending) with a stricter condition: it runs only at a safe point ([06](06-context-and-compaction.md#compaction)). Its pending flag is `agents.compaction_pending`, not a `routine_state` row.
