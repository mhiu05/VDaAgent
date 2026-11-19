# 0016 · Builder edits notify the agent, then apply at a safe point

- **Context.** The system prompt is rendered once per epoch to keep the prefix cache valid ([0005](0005-append-only-context-during-a-task.md)), but users expect a prompt edit to take effect.
- **Decision.** Every builder change writes the folder, commits it as `user:<username>`, and appends a notice describing the change (a unified diff for prompt edits). A prompt edit also makes compaction pending, so the next safe point opens a new epoch with the new prompt rendered properly.
- **Rejected.**
  - Apply only at the next natural compaction: possibly days later.
  - Open a new epoch without compaction: the history since the last compaction would be lost.
- **Consequences.** Behaviour changes as soon as the agent reads the notice, with no cache break mid-task. See [05](../05-agent-builder.md#prompt-edits).
