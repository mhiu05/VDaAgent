# Getting VDaAgent running

[Tiếng Việt](GUIDE.vi.md)

Three phases, each with one command:

```text
1. make setup     creates .env and the credential files, lists what you must fill in
2. (edit files)   then make check, until it reports no missing keys
3. make up        starts everything, creates the demo users, prints the URLs
```

## Prerequisites

| Need | Notes |
|---|---|
| Docker with Compose **v2.20 or newer** and **buildx** | macOS/Windows: Docker Desktop (has both). Linux: Docker Engine + the `docker-compose-plugin` and `docker-buildx-plugin` packages. macOS with a plain Homebrew `docker` CLI: `brew install docker-buildx`, then `ln -sfn "$(brew --prefix)/opt/docker-buildx/bin/docker-buildx" ~/.docker/cli-plugins/docker-buildx` |
| `make`, `git` | macOS: `xcode-select --install`. Windows: run everything inside WSL 2 (Ubuntu), with Docker Desktop's WSL integration on |
| ~6 GB RAM for Docker | the stack uses about 3.7 GB when idle (Langfuse and ClickHouse are most of it). On Docker Desktop, raise the memory limit if it is lower |
| ~10 GB free disk | about 2 GB of images, plus build cache and data volumes |

You don't need Python, Node or uv on your machine: every tool runs in a container.

## 1. Setup

```bash
git clone <repo-url> VDaAgent && cd VDaAgent
make setup
```

`make setup` checks that Docker, Compose and buildx work, then:

- creates `.env` from `.env.example` and fills every internal secret (database, session, Langfuse…) with a random value;
- creates each `domains/<id>/credentials/<set>.env` from its `.env.example`;
- prints what you still have to fill in.

It never overwrites a value or a file that already exists, so you can run it again at any time. Example output on a fresh clone:

```text
created .env from .env.example
filled generated keys: POSTGRES_PASSWORD, SESSION_SECRET, EXECD_TOKEN, …
created domains/fabrikam/credentials/warehouse.env
created domains/fabrikam/credentials/web-search.env

still to fill in:
  .env: OPENROUTER_API_KEY, ADMIN_USERNAME, ADMIN_PASSWORD
  domains/fabrikam/credentials/warehouse.env: WAREHOUSE_DSN, WAREHOUSE_SNAPSHOT_ID
  domains/fabrikam/credentials/web-search.env: TAVILY_API_KEY
optional: .env: DEMO_PASSWORD
next: fill these in, then run `make check` (see GUIDE.md)
```

## 2. Fill in the files

Open each file `make setup` listed and fill in the value after `=`. Secrets come from the project owner: ask privately, never in a group chat or an issue.

| File | Key | What it is | Where it comes from |
|---|---|---|---|
| `.env` | `OPENROUTER_API_KEY` | the only model key (all agents use it) | project owner |
| `.env` | `ADMIN_USERNAME`, `ADMIN_PASSWORD` | the admin login for the app; the password is also the Langfuse password | you choose (username: 3–32 characters from `a-z`, `0-9`, `.`, `_`, `-`) |
| `.env` | `DEMO_PASSWORD` (optional) | password for the demo users `alice` and `bob` (both fabrikam) | you choose; leave empty to skip the demo users |
| `domains/fabrikam/credentials/warehouse.env` | `WAREHOUSE_DSN`, `WAREHOUSE_SNAPSHOT_ID` | read-only connection to the fabrikam data warehouse, and the snapshot to analyse | project owner |
| `domains/fabrikam/credentials/web-search.env` | `TAVILY_API_KEY` | web search for market news | project owner |

**Recommended: use the cheaper model.** Without these lines the agents use `anthropic/claude-haiku-4.5`, which costs much more on the shared key. Set in `.env`:

```text
AGENT_MODEL=deepseek/deepseek-v4.1-flash
COMPACTION_MODEL=deepseek/deepseek-v4.1-flash
```

Leave `JEV_MODEL` empty; its default is the right one.

Then check:

```bash
make check
```

The first run builds the backend image (a few minutes); later runs take seconds. A good result:

```text
platform: ok
domain fabrikam: available
```

- `platform: missing required keys: …` → fill those keys in `.env`; `make check` and `make up` stop until you do.
- `domain <id>: unavailable` with a reason → that domain's credential file is missing a key. The rest of the app still works; only that domain's users can't run tasks.

## 3. Start

```bash
make up
```

It runs `make check`, builds and starts every service (the first time takes several minutes), waits until all of them are healthy, creates `alice` and `bob` if `DEMO_PASSWORD` is set, and prints:

```text
VDaAgent is up
  app       http://localhost:8080   (login: admin, alice, bob)
  api       http://127.0.0.1:8000/api/health
  langfuse  http://localhost:3100   (admin@contoso.local / ADMIN_PASSWORD)
  stop: make down    logs: make logs
```

Open the app URL and log in. `make up` is safe to run again: after a `git pull`, it rebuilds what changed and leaves existing users alone.

| Command | Does |
|---|---|
| `make down` | stops everything; your data (database, agent folders, the shared uv cache) is kept |
| `make demo-ready` | optional, before a demo or onboarding several users: warms the uv cache, then `make up` and `make health` |
| `make logs` | follows the backend and workspace logs |
| `make help` | lists every command |

To restart, use `make down` then `make up`. **Don't** run `docker compose down -v` or `make reset-dev` unless you mean it: they delete every volume — the database (users, chats), agent folders, the shared uv cache (the next users download every package again), attachments, reports and Langfuse data.

## Troubleshooting

**Port already in use.** Set another port in `.env`, then `make up` again:
- app (8080): `PROXY_PORT=8081`
- API (8000): `APP_PORT=8010` and `APP_URL=http://localhost:8010`

**`docker buildx is missing`** or a build error mentioning `--mount`. Install buildx (see [Prerequisites](#prerequisites)).

**A domain is `unavailable`.** Run `make check` to see which key is missing, fill it in, then `make up`.

**A task stays "running" forever.** Usually the OpenRouter key ran out of credits. Log in as the admin and open that agent's trace in the admin console: an error `model_unavailable` (often with HTTP 402) confirms it. Tell the project owner.

**Docker runs on another machine.** Don't point your laptop at it with `DOCKER_HOST=ssh://…`: Compose mounts `./domains`, `./platform` and `./deploy` from paths on *your* laptop that don't exist on the server, and the stack starts with no domains. Clone the repo **on the server** and run the three phases there, then open tunnels from your laptop:

```bash
ssh -L 8080:127.0.0.1:8080 -L 8000:127.0.0.1:8000 -L 3100:127.0.0.1:3100 <user>@<server>
```

**Calling the API by hand returns 403 `csrf`.** Every non-GET `/api` request needs the header `X-Contoso-Client: web`.

## Rules

- Never commit `.env` or `domains/*/credentials/*.env` (both are git-ignored) and never paste their contents into chats or issues.
- More detail: [docs/16 Configuration and deployment](docs/16-configuration-and-deployment.md).
