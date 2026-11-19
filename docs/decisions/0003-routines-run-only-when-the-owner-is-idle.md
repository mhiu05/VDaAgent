# 0003 · Routines run only when the owner is idle

- **Context.** Routines belong to individual agents, while each user's global work is serialized.
- **Decision.** A routine runs in its owner's main session when the owner is idle. Messages that arrive meanwhile follow the normal notification rule. Each routine has at most one pending instance.
- **Rejected.**
  - Routines as global tasks: they wait behind the whole queue, which is bad UX.
  - Git branches of the agent folder: they would mean merging context and folders.
  - Read-only sub-agents: permission rules, scratch space, copying messages back, and two voices for one agent.
  - The harness pausing a routine when a message arrives: a new mechanism, and paused work mixed into the context.
- **Consequences.** Routines can starve if their owner is never idle ([99](../99-risks-and-future-work.md)). See [09](../09-routines.md).
