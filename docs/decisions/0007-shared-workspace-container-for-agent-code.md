# 0007 · One shared `workspace` container runs all agent code

- **Context.** Every action is `cd AGENT_FOLDER && python -c CODE`. Agent code needs the domain credentials, but must not edit them.
- **Decision.**
  - Every user × agent folder lives in one `workspace` container, and `execd` runs code with `cwd` set to the target folder.
  - `/domains` is mounted read-only.
  - The rule that agents must not read or print `.env.d/` is enforced **only through the system prompt**. This is recorded as future work.
  - `workspace` has no route to Postgres or Langfuse.
- **Rejected.**
  - bubblewrap per call: user namespaces and seccomp tweaks on the Docker host; worth doing later.
  - A container per agent through the Docker socket: the socket is root-equivalent, and it needs lifecycle and GC code.
- **Consequences.** There's no file-system isolation between agents or users. See [11](../11-sandbox.md) and [99](../99-risks-and-future-work.md).
