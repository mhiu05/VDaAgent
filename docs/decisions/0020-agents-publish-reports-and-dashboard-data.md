# 0020 · Agents publish reports and dashboard data

- **Context.** The frontend has a reports library and a business dashboard. The PoC spec had neither: a report was a DOCX/PDF attachment, and only agents can reach the warehouse, because domain credentials live in agent folders and `api` never parses their values ([12](../12-auth-and-domains.md#credentials-flow)).
- **Decision.**
  - Agents publish through `contoso` helpers: `start_report`, `publish_report`, `fail_report` and `publish_dataset`. `api` validates and stores what they send, owned by the user.
  - A report version is report schema v1 plus artifacts and evidence, and it never changes after it is published.
  - The business dashboard reads the newest `dashboard` dataset, which an agent (normally `data`) publishes when the user asks, or from a routine the user sets up. The browser computes KPIs from it with the existing, tested `features/dashboard/model` functions.
- **Rejected.**
  - `api` querying the warehouse: it would need the domain credentials, which breaks the rule that only agent code sees them.
  - Computing the dashboard in `api`: it would duplicate the frontend rules and their tests in Python before there is a need.
  - Keeping reports as chat attachments only: no versions, no search, no viewer.
- **Consequences.** Reports and the dashboard are only as fresh as the agents make them. The whole dataset goes to the browser, so it is capped at 20 MB. The schema rules exist twice, in `api` validation and the frontend decoder ([99](../99-risks-and-future-work.md)). See [19](../19-reports-dashboard-notifications.md).
