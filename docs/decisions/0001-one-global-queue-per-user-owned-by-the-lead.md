# 0001 · One global task queue per user, owned by the lead

- **Context.** Several agents need stable coordination, and every user has their own agent team ([0010](0010-per-user-agent-teams.md)).
- **Decision.** Each user has one FIFO queue, controlled only by that user's lead, with at most one running global task per user. jev classifies only messages delivered to the lead. Every other agent gets notifications, and asks the lead to queue new work. A partial unique index enforces one running task per user.
- **Rejected.**
  - Any agent's jev creating tasks: help needed mid-task would be queued behind the task that needs it, a deadlock.
  - Per-agent work lists inside the current task: a second level of scheduling.
  - One global queue shared by all users: users would wait behind each other.
- **Consequences.** Users run in parallel, while each user's work is serialized. See [07](../07-routing-and-queue.md#global-task-queue).
