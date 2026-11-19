# 0006 · One `api` process hosts the HTTP API and the harness

- **Context.** The harness needs agent runners, jev, queues and a scheduler. The PoC needs few moving parts.
- **Decision.** A single asyncio process runs FastAPI, the supervisor with one `AgentRunner` per agent, jev, the scheduler, the job worker and the in-process event bus. All state lives in Postgres and the folders; memory only caches it.
- **Rejected.**
  - Separate `api` and `harness` services connected through Postgres `LISTEN/NOTIFY` and leases: about a third more harness work, and it proves nothing extra in a PoC.
  - The harness inside the `workspace` container: the OpenRouter key and DB credentials would sit next to code written by the model.
- **Consequences.** One process caps scale. The `api` ↔ `workspace` HTTP boundary is the only network contract, so splitting later is a deployment change. See [02](../02-architecture.md).
