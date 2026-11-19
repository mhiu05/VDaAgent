# 0004 · No compaction during a task

- **Context.** Compacting during a task loses in-flight working context.
- **Decision.** Compaction runs only at safe points (idle, and not involved in a running task). A soft threshold, a builder prompt edit or an overflow schedules it.
- **Rejected.** Checkpointing and restarting during a task, which is mid-task compaction under another name.
- **Consequences.** A task that outgrows the context after batch offload fails. See [06](../06-context-and-compaction.md#compaction).
