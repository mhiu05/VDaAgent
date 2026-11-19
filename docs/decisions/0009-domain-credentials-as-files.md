# 0009 · Domain credentials are files, attached as credential sets

- **Context.** Each domain has its own data credentials (warehouse DSN, search keys). Users can create their own agents, so credentials can't belong to fixed template folders.
- **Decision.**
  - Credentials live in `domains/<domain>/credentials/<set>.env` (with a committed `.env.example`), are mounted read-only, and are attached to an agent as symlinks in `.env.d/`.
  - `execd` loads them into each exec's environment.
  - Key names must be unique across a domain's sets.
  - `api` never parses the values, except to check that they aren't empty.
- **Rejected.**
  - One `.env` per agent template: it doesn't work for agents users create themselves.
  - One `.env` per domain: every agent would see every credential.
  - Prefixed keys in the root `.env`: one huge file, and a typo in a prefix silently drops a credential.
  - Encrypted DB storage edited in the UI: forms, encryption and audit work the PoC doesn't need.
- **Consequences.** Rotating a credential is one file edit, and it takes effect on the next exec. See [12](../12-auth-and-domains.md#credentials-flow).
