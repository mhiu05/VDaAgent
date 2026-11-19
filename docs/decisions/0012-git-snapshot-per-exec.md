# 0012 · A git snapshot after every exec

- **Context.** The folder viewer shows what an agent knows now, but not how self-improvement happened: which step edited memory, who added a skill.
- **Decision.**
  - Every agent folder is a git repository. After every exec, `execd` runs `git add -A`, checks `git diff --cached --quiet`, and commits only if something changed, with the author `agent:<slug>`, `user:<username>` or `contoso-harness`.
  - The `tool_result` stores `head` and `changed`, even when nothing changed.
  - A snapshot failure never fails the exec.
  - `baseline_commit` makes reset possible.
- **Rejected.** A list of changed paths from mtimes: no diffs, no past versions, and nothing to reset against.
- **Consequences.** About 20–50 ms per exec. The commit count grows, and squashing is future work. See [04](../04-agent-folder.md#git-snapshots).
