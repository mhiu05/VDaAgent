# 11 · Sandbox: `workspace`, `execd`, `contoso`

Where and how agent code runs. **Depends on:** [02](02-architecture.md), [04](04-agent-folder.md).

## Isolation level (PoC)

Every agent folder of every user lives in one container, `workspace`. Code from agent A runs in that container with `cwd` set to A's folder ([decision 0007](decisions/0007-shared-workspace-container-for-agent-code.md)).

| Boundary | PoC | Enforced by |
|---|---|---|
| Agent code can't reach the app DB or Langfuse | yes | `workspace` is on the `exec` network only |
| Agent code can't modify domain credentials | yes | `/domains` is mounted read-only |
| Agent receives only its attached credential sets | yes; values are materialized inside its own `.env.d/` and loaded into its environment. The agent can read its own copies; the folder viewer redacts them | backend decrypts the attached DB credential sets; Landlock denies other agents' folders and `/domains` |
| Agent A can't list, read or write agent B's or another user's folder (absolute paths, `..`, symlinks) | yes, when the kernel has Landlock (`GET /health` → `fs_isolation`) | Landlock, per exec ([below](#filesystem-sandbox-landlock)) |
| CPU, memory and time limits per exec | yes | rlimits + wall-clock kill |
| Outbound network | open | warehouse, GitHub, PyPI are needed |

The fixes for the unenforced rows are listed in [99](99-risks-and-future-work.md#poc-shortcuts-and-future-work).

### Filesystem sandbox (Landlock)

Every user's folders share one volume and one uid, so file permissions can't separate them. Each exec process restricts itself with [Landlock](https://docs.kernel.org/userspace-api/landlock.html) after fork and before it runs the code (`workspace/execd/landlock.py`); its children inherit the restriction and execd itself stays unrestricted.

| Path | Access |
|---|---|
| the agent's own folder, `UV_CACHE_DIR`, `/tmp`, `/dev/shm` | read, write, execute |
| `/usr`, `/lib*`, `/bin`, `/sbin`, `/etc`, `/opt`, `/proc`, `/sys`, `/var/cache` | read, execute |
| `/dev` | read and write device files |
| everything else — the folders root, other agents' and users' folders, `/domains` | denied |

Landlock also stops the exec from ptrace-class access to execd (`/proc/<execd>/environ`). `EXEC_FS_ISOLATION` on the backend and workspace services: `auto` (default; enforced with Landlock ABI ≥ 2, Linux ≥ 5.19 and `landlock` among the active LSMs), `required` (an exec fails rather than run unsandboxed) or `off`. `GET /health` reports `fs_isolation`: `landlock`, `unavailable` or `off`.

Git snapshots and backend folder operations use `workspace/execd/git_sandbox.py`. Hooks and fsmonitor are disabled, system/global Git configuration is ignored, and Git plus any repository-configured subprocess inherits the folder's Landlock boundary. Each Git operation has a 30-second timeout and its process group is killed on completion.

Not covered: the uv cache is shared and writable by every exec (a poisoned cache entry would reach other agents' installs); outbound network stays open; agents can still learn other folders' names by guessing paths (`stat` is not restricted), but can't list, read or write them.

## Image

`workspace/Dockerfile`:
- `python:3.12-slim-bookworm` with `git`, `uv` (copied from `ghcr.io/astral-sh/uv`), `tini`, `fonts-noto-core` (for Vietnamese text in charts), `libpq5`.
- The `contoso` package is at `/opt/contoso` (stdlib only, on `PYTHONPATH`). `execd` is at `/opt/execd`, with its own venv for FastAPI and uvicorn.
- **uv cache warm-up (optional).** The image installs no preset packages, so `make up` stays light. The shared cache `UV_CACHE_DIR=/data/folders/.uv-cache` lives on the `folders` volume, on the same filesystem as every venv (uv hardlinks instead of copying). Provisioning fills it with what each agent needs, and later agents reuse it. `make warm-cache` (`workspace/prewarm.py warm` in a one-off workspace container) fills it ahead of time with every package of `platform/seeds/library_presets.yaml` and `domains/*/seeds/library_presets.yaml`. It locks them with `--generate-hashes` and installs them with `--require-hashes`, because agent folders are uv projects whose `uv add`/`uv sync` reuse a cached wheel only if its sha256 is recorded. `make warm-cache-status` reports the cache size and whether every preset is cached. Package installs in agent folders get `AGENT_PACKAGE_INSTALL_TIMEOUT_S` (default 1200 s) instead of the 600 s system-exec limit.
- **Process.** It runs as the non-root user `agent` (uid 1000) with `tini -- uvicorn execd.app:app --host 0.0.0.0 --port 7000`.
- **Environment.** `UV_CACHE_DIR=/data/folders/.uv-cache`, `UV_LINK_MODE=hardlink` (venvs share cached files, so 50 venvs are cheap), `UV_PYTHON_DOWNLOADS=never`. Later builds don't refresh the cache inside an existing volume. New preset packages are then downloaded on first use.

## `execd` API

All requests except `GET /health` need the header `Authorization: Bearer $EXECD_TOKEN`.

### `POST /exec`

```jsonc
// request
{"folder": "/data/folders/<user_id>/<slug>", "exec_id": "x_01J…",
 "code": "print(1)",              // agent exec; or:
 "argv": ["uv", "add", "pandas"], // system exec (exactly one of code/argv)
 "timeout_s": 120, "author": "agent:data", "env_extra": {"CONTOSO_API_URL": "...", "CONTOSO_EXEC_TOKEN": "...", "CONTOSO_DEFAULT_THREAD": "direct:data"}}
// response
{"exit_code": 0, "stdout": "...", "stderr": "...", "duration_ms": 1400, "timed_out": false, "truncated": false,
 "head": "3f2c…", "changed": [{"path": "...", "status": "M"}], "snapshot_error": null}
```

How a request runs:
1. **Folder check.** The `folder`'s real path (symlinks resolved) must be strictly under `/data/folders/` and contain `.git`; otherwise 400 `invalid_folder`. A body with neither or both of `code` and `argv` is 400 `invalid_request`; a missing or wrong token is 401 `unauthenticated`. Errors use the doc 15 shape `{error, message}`.
2. **Command.** `code` runs as `[<folder>/.venv/bin/python, -c, code]`, or `[python3, -c, code]` if `.venv` doesn't exist yet. `argv` runs as given, with `PATH` set to `<folder>/.venv/bin:/usr/local/bin:/usr/bin:/bin`.
3. **Environment**, built from scratch. The parent's environment is never inherited:
   - `PATH`, `HOME=<folder>`, `LANG=C.UTF-8`, `TZ=Asia/Ho_Chi_Minh`, `PYTHONPATH=/opt` (for `contoso`; `python -c` already puts the cwd first on `sys.path`, so `helpers.*` imports work), `PYTHONUNBUFFERED=1`, `UV_CACHE_DIR`, `UV_LINK_MODE`;
   - then every `KEY=VALUE` from `<folder>/.env.d/*.env` in name order, parsed with `python-dotenv` semantics (no interpolation; a later file wins on the same key, and a dangling link is skipped);
   - then `env_extra`.
4. **Process.** `subprocess.Popen(..., cwd=folder, start_new_session=True)`. The `preexec_fn` sets `RLIMIT_AS = EXEC_MEM_MB` (default 2048) and `RLIMIT_FSIZE = 1 GB`. There's no `RLIMIT_NPROC`: it would count every process of the shared uid. Instead, the container's `pids_limit: 4096` in compose bounds runaway forking.
5. **Output.** `stdout` and `stderr` are read concurrently, each capped at `EXEC_MAX_OUTPUT_BYTES` (10 MB). Anything beyond the cap is discarded, `truncated=true` is set, and the marker `\n[... truncated by execd at 10 MB]` is appended.
6. **Wall clock.** On `timeout_s`, the whole process group gets `os.killpg(pgid, SIGKILL)`, and `timed_out=true`. When the main process exits normally, the process group is also killed, so no background process outlives the exec.
7. **Snapshot** ([04](04-agent-folder.md#git-snapshots)) with `author`.

Calls for the same folder never overlap, because `api` holds the agent's job lock. `execd` also keeps a per-folder `asyncio.Lock` as a second guard.

### `GET /health`

No auth. Returns `{"ok": true}`. The compose healthcheck uses it, and `api`'s own `/api/health` calls it.

## Exec token

```text
token   = "v1." + agent_id + "." + exec_id + "." + exp + "." + b64url(HMAC_SHA256(SESSION_SECRET, "v1|agent_id|exec_id|exp"))
exp     = now + timeout_s + 10 (unix seconds)
```

`api:8001` accepts the token only if all of these hold:
- the signature is valid;
- `exp` hasn't passed;
- `running_exec[agent_id] == exec_id`, or that exec ended less than 5 s ago.

So a helper can't act as another agent, or after its exec has finished. `final=True` is recorded against the `exec_id` and applied when the exec returns.

## Helper library `contoso`

`/opt/contoso/__init__.py` uses only the standard library (`urllib.request`, `json`). It reads `CONTOSO_API_URL` and `CONTOSO_EXEC_TOKEN` from the environment and posts JSON to `/internal/v1/<helper>`. On a non-2xx response it raises `contoso.ContosoError(code, message)`, so the model sees the reason in stderr. A 400, 404 or 422 raises the subclass `ContosoValueError` (also a `ValueError`, as doc 08 promises for bad arguments), and a 409 raises `ContosoConflictError` (also a `RuntimeError`, for example during compaction). Called outside an exec (no `CONTOSO_API_URL`/`CONTOSO_EXEC_TOKEN`), helpers raise `ContosoError('not_in_exec', …)`. `send_to_user` fills `thread` from `CONTOSO_DEFAULT_THREAD` when none is given; `send_to_agent` doesn't.

| Helper | Internal endpoint | Returns |
|---|---|---|
| `send_to_user(text=None, *, files=(), choices=None, reports=(), thread=None, reply_to=None, final=False)` | `POST /internal/v1/send_to_user` | message id |
| `send_to_agent(receivers, content, *, files=(), thread=None, reply_to=None)` | `POST /internal/v1/send_to_agent` | message id |
| `end_task(outcome, status="done")` | `POST /internal/v1/end_task` | task id |
| `queue_task(description)` | `POST /internal/v1/queue_task` | task id |
| `write_summary(text)` | `POST /internal/v1/write_summary` | `None` |
| `start_report(title, type, *, projects=(), markets=(), report_id=None)` | `POST /internal/v1/reports/start` | `{"report_id", "attempt_id"}` |
| `publish_report(attempt_id, schema_path, *, artifacts=(), evidence=(), source=None)` | `POST /internal/v1/reports/publish` | version id |
| `fail_report(attempt_id, reason)` | `POST /internal/v1/reports/fail` | `None` |
| `publish_dataset(kind, path)` | `POST /internal/v1/datasets/publish` | dataset id |

The semantics of the messaging helpers are in [08](08-communication.md); the report and dataset helpers are in [19](19-reports-dashboard-notifications.md). `api` reads `files`, `schema_path`, `artifacts` and `path` from the shared `folders` volume.

`contoso.skills` (the skill installer) lives in the same package ([05](05-agent-builder.md#installer-contososkills)).

## Limits

| Key | Default |
|---|---|
| `EXEC_TIMEOUT_S` | 120 (system execs: 600) |
| `EXEC_MEM_MB` | 2048 |
| `EXEC_MAX_OUTPUT_BYTES` | 10,485,760 |
| Attachment size / count | 20 MB / 10 per message |
