# 0002 · jev reads the receiver's view

- **Context.** jev needs the right context, and building it separately for each kind of channel does not scale.
- **Decision.** One context builder: the receiver's `current_state`, summary and last `JEV_K` message events, plus the message. Every decision is stored in `jev_decisions` so policies can be compared later.
- **Rejected.**
  - Per-channel context rules.
  - The thread's log only: it can't see the current task.
  - No classifier, with the agent sorting every message itself: a full model turn per message, and it waits until the current block of work ends.
- **Consequences.** The rest of the system depends only on jev's label, so the policy can change freely. See [07](../07-routing-and-queue.md#jev).
