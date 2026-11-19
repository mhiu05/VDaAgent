# 01 · Glossary

| Term | Definition |
|---|---|
| Activation | One run of an agent from the moment it wakes until it is idle again. It is one Langfuse trace with one `trace_id`. See [03](03-agent-loop.md). |
| Admin overview | The admin page `/admin`: one row per agent with status, queue, errors and cost. See [13](13-observability.md). Not to be confused with the business dashboard. |
| Agent | One main session plus one agent folder, owned by one user. Every agent runs the same harness code; agents differ only by their folder and the `is_lead` flag. |
| Agent Fleet | The name of the current mock chat screen with six fixed agents ([14d](14d-frontend-chat-mock.md)). The target is the chat app of [14](14-frontend.md); the agents of a user are their *team*. |
| Agent folder | `/data/folders/<user_id>/<slug>/`. Holds the agent's prompts, memory, skills, helpers, routines, Python environment and credential links. It is a git repository. See [04](04-agent-folder.md). |
| Agent thread | A thread whose members are agents only. Users never see it; admins see it in the chat-trace view. |
| Artifact | A file attached to a report version (HTML, CSV, DOCX, PDF or XLSX). Also called a report file. See [19](19-reports-dashboard-notifications.md#reports-library). |
| Block of work | A stretch of reasoning and Python calls that the agent chooses to finish before it handles notifications. The agent decides how long it is; the harness never interrupts it. |
| Builder | The UI where users create and customize agents. See [05](05-agent-builder.md). |
| Business dashboard | The page `/`, with KPIs for inventory, slow-moving inventory and transactions, computed from the user's newest dataset. See [19](19-reports-dashboard-notifications.md#business-dashboard). |
| Built-in lead | The lead agent that every user gets at signup. It can't be deleted. Its slug is `lead` and its display name is "Điều phối". |
| Credential set | A named `.env` file in a domain, `domains/<domain>/credentials/<set>.env`. It is attached to an agent as a symlink in `.env.d/`. See [12](12-auth-and-domains.md). |
| `current_state` | A block the harness renders and appends with each new input. It gives the time, the agent's identity and team, the current task, the agent's status and its pending work. See [06](06-context-and-compaction.md). |
| Dataset | A JSON file that an agent publishes with `publish_dataset`; the business dashboard reads the newest `dashboard` dataset. |
| Delivery | One message (or system notice) waiting for one agent: a row in `deliveries`. A pending delivery is a notification the agent hasn't consumed yet. |
| Direct thread | The 1-to-1 thread between a user and one of their agents. Each agent has exactly one. |
| Domain | A company or team that uses the platform, such as `fabrikam`. A domain provides credential sets, starter agents and optional catalog entries. Each user belongs to exactly one domain. |
| Epoch | One stretch of an agent's context between two compactions. Each epoch has a fixed system prompt and summary. A new epoch starts at compaction or reset. |
| Exec | One run of agent Python code in `execd`, with its own `exec_id`. |
| Exec token | A short-lived HMAC token given to each exec, so the `contoso` helpers can call back to `api` as that agent during that exec only. |
| `execd` | The HTTP daemon in the `workspace` container that runs Python in agent folders. See [11](11-sandbox.md). |
| Global task | A unit of work taken from a user's global task queue. At most one runs per user at any time. |
| Global task queue | A user's FIFO queue of global tasks, controlled only by that user's lead. |
| Group thread | A thread the user creates with two or more of their agents. |
| Idle | The agent's model loop is not running. The harness can observe this. |
| Involved | An agent is involved in the running global task once it has sent or received a message while that task runs. |
| jev | The classifier for every message delivered to the lead, labelling it `task` or `side_question`. Named after and implemented by TypeSafe AI's Jev, a non-generative "System One" decision model reached through OpenRouter's Decisions API. See [07](07-routing-and-queue.md). |
| Lead | The one agent per user that owns that user's global task queue. |
| Library preset | A named list of Python packages. Applying it once runs `uv add`; afterwards no record remains of the preset having been applied. See [05](05-agent-builder.md). |
| Mock scenario | A `?scenario=` value that selects mock-service behaviour in the frontend, such as `offline` or `report-showcase`. See [14g](14g-frontend-development.md#mock-scenarios). Not to be confused with a FakeModel scenario ([17](17-testing.md)). |
| Notice | A system-generated notification with no message behind it, for example "a skill was installed" or "the harness restarted". |
| Notification | Input appended to the end of an **agent's** context. The receiver decides when to handle it. Items in the user's inbox are *user notifications*. |
| Offload | Writing a large Python output to a file and keeping only its head, its tail and the file path in the context. |
| Platform rules | `platform/rules.md`. Fixed instructions that open every agent's system prompt. Users can't edit them. |
| Report | A record in a user's reports library, with an id `R<n>`, attempts and immutable versions. See [19](19-reports-dashboard-notifications.md#reports-library). |
| Report attempt | One try at producing a new version of a report, from `start_report` to `publish_report` or `fail_report`. |
| Report overview | The compact `dashboard` mode of the report viewer for one saved version ([14e](14e-report-viewer.md)). Unrelated to the business dashboard. |
| Report version | One published, never-changing state of a report: schema v1 content, evidence and artifacts. Its id is `<report id>-v<n>`. |
| Routine | A prompt plus a cron schedule, stored in `routines/<name>.yaml` in the agent folder. It runs when its owner is idle. |
| Safe point | The agent is idle and not involved in a running global task. Compaction can run only then. |
| Side question | A message to the lead that doesn't need its own global task. It is delivered as a notification. |
| Skill | A folder `skills/<name>/` containing a `SKILL.md` with YAML frontmatter (`name`, `description`). Agents read it on demand. |
| Skill catalog | The curated list of installable skills in the `skill_catalog` table, seeded from YAML. |
| Slug | An agent's fixed identifier within its user's team, `[a-z0-9-]{2,32}`. It is used in paths and in `send_to_agent`. |
| Snapshot | The git commit `execd` makes after an exec when files changed. |
| Starter | An agent definition that a domain ships (a prompt, library presets and credential sets). It is copied for each new user of the domain. |
| Status label | The marker on every frontend feature: *Implemented (mock)*, *Implemented (API)* or *Planned*. See [14](14-frontend.md). |
| System exec | An `execd` run started by `api` rather than by the model, for example `uv add` or a skill install. |
| Thread | A conversation with a fixed set of members: the user and/or agents. Its kind is `direct`, `group` or `agent`. |
| Trigger | Anything that produces input for an agent: a user message, an agent message, the user opening the app, a routine, a system notice. |
| User notification | An item in the user's inbox at `/notifications`: a report is ready, a task failed, a choice is waiting, or an account or system event. See [19](19-reports-dashboard-notifications.md#user-notifications). |
| `workspace` | The container that holds every agent folder and runs `execd`. |
