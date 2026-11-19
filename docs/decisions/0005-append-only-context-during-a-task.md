# 0005 · Append-only context during a task

- **Context.** Editing earlier parts of the context invalidates the prefix cache from that point on.
- **Decision.**
  - Store each event's exact rendered text, and never re-render it.
  - Render the system prompt once per epoch.
  - Offload large outputs as they arrive, fall back to one batch offload, and fail the task if the context is still over the limit.
  - Builder changes reach the agent as appended notices ([0016](0016-builder-edits-notify-then-apply-at-a-safe-point.md)).
- **Rejected.**
  - Rewriting old outputs turn by turn: repeated cache misses.
  - `current_state` inside the system prompt: the cache would be invalidated every turn.
  - Re-rendering the system prompt when the folder changes.
- **Consequences.** Cache resets happen only at new epochs and batch offloads. See [06](../06-context-and-compaction.md).
