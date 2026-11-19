# 0018 · A single global admin role

- **Context.** Admins need the observability dashboard and user management. Domains must stay separate for users.
- **Decision.** There are two roles: `user` (exactly one domain) and `admin` (no domain, sees everything, has no agent team). Only admins reach `/api/admin/*` and the Langfuse login.
- **Rejected.**
  - Per-domain admins plus a superadmin: domain filtering on every dashboard query, and one Langfuse project per domain, which headless init can't create.
  - Admin as a flag inside a domain: no cross-domain view.
- **Consequences.** Any admin sees every domain's data. Per-domain admins are future work. See [12](../12-auth-and-domains.md#roles-and-authorization).
