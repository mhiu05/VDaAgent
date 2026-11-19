# 0017 · `send_to_user` may end the activation

- **Context.** Most replies end with "send the answer, then stop". A separate model call just to say Done costs latency and tokens.
- **Decision.** `send_to_user(..., final=True)` marks the exec as final. If the exec exits with code 0, the harness appends the `tool_result` and the agent goes idle without another model call. If the code raises after sending, the flag is ignored. The next input follows the `tool` message directly as a `user` message, and a live contract test checks that providers accept this.
- **Rejected.**
  - Always requiring a final model turn: one wasted call per reply.
  - `final` on `send_to_agent`: the sender usually waits for a reply.
- **Consequences.** If a provider rejected the message shape, the fallback is a fixed rendered `assistant: (done)` turn that is never stored as model output. See [03](../03-agent-loop.md#step-loop).
