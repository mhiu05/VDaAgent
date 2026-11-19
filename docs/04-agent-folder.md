# 04 · Agent folder

What an agent knows and can change lives in files. **Depends on:** [01](01-glossary.md), [11](11-sandbox.md), [12](12-auth-and-domains.md).

## Layout

```text
/data/folders/<user_id>/<slug>/
  .git/                       one repo per agent folder
  .gitignore                  .venv/  .contoso/outputs/  .env.d/
  .env.d/<set>.env  ->  /domains/<domain>/credentials/<set>.env    (one symlink per attached credential set)
  pyproject.toml, uv.lock     Python project; the agent and the builder may add or remove packages
  .venv/                      created by `uv sync`
  prompts/system.md           role and preferences (edited in the builder's "Vai trò" tab)
  prompts/context.md          durable context the agent maintains
  memory/index.md             memory index; rendered into the system prompt
  memory/*.md                 notes, read on demand
  skills/<name>/SKILL.md      skills (installed or written by the agent)
  helpers/*.py                importable as `helpers.<module>` (cwd is on sys.path)
  routines/<name>.yaml        {prompt, cron, enabled}
  files/                      scratch space and generated outputs (charts, reports)
  files/inbox/m_<message_id>/ copies of files sent to this agent (by the user or other agents)
  .contoso/outputs/<exec_id>.txt  offloaded outputs (written by api only)
```

| Part | Agent edits | User edits (builder) | Read when |
|---|---|---|---|
| `.env.d/` | No (prompt rule; the mount is read-only) | Attach and detach sets | every exec |
| `pyproject.toml`, `uv.lock` | Yes (`uv add`/`uv remove`) | Yes (Thư viện tab) | every exec |
| `prompts/system.md`, `prompts/context.md`, `memory/index.md` | Yes | `system.md` | new epoch only |
| `memory/*.md`, `skills/`, `helpers/` | Yes | skills (Kỹ năng tab) | on demand, so changes take effect immediately |
| `routines/*.yaml` | Yes | Yes (Lịch tab) | whenever the owner goes idle |
| `files/` | Yes | read-only (viewer) | on demand |

The agent uses its folder (runs helpers, reads memory and skills) and changes it (adds helpers, updates memory, writes skills and routines). The user changes the same files through the builder. Every change becomes a git commit, so the history shows who changed what.

## Platform skeleton

Every agent folder starts as a copy of `platform/agent-skeleton/`:

```text
platform/agent-skeleton/
  .gitignore            .venv/  .contoso/outputs/  .env.d/  __pycache__/
  pyproject.toml        [project] name="agent", version="0.1.0", requires-python=">=3.12", dependencies=[]; [tool.uv] package=false
  prompts/system.md     (empty; replaced by the starter, lead or custom prompt)
  prompts/context.md    "# Context\n"
  memory/index.md       "# Memory\n\n(no notes yet)\n"
  skills/.keep  helpers/.keep  routines/.keep  files/.keep
```

## Creating an agent

`agents/folders.create(user, slug, prompt, presets, credential_sets, author)` runs these steps as one builder job:

1. Check `slug` against `^[a-z0-9][a-z0-9-]{1,31}$`, check that it is unique for the user, and check `MAX_AGENTS_PER_USER`.
2. Copy `platform/agent-skeleton/` to `/data/folders/<user_id>/<slug>/`.
3. Write `prompts/system.md` from the given prompt.
4. For each credential set, create the symlink `.env.d/<set>.env` → `/domains/<domain>/credentials/<set>.env`. The set must exist in the user's domain.
5. Run `git init -b main`, then commit everything with the author `contoso-harness`, message `create <slug>`.
6. Run the system exec `uv sync`, then `uv add <packages>` once per preset ([05](05-agent-builder.md#libraries)). Each run leaves a snapshot.
7. Insert the `agents` row (`state='active'`, `baseline_commit` = HEAD at this point), epoch 0 ([06](06-context-and-compaction.md)) and the direct thread. Start the runner.

If a step fails, the job is marked `failed` and the half-made folder is moved to `/data/folders/.trash/<user_id>-<slug>-<ts>/`. The `agents` row is only inserted at the last step, so nothing half-made is left behind.

| Origin | Prompt | Presets | Credential sets |
|---|---|---|---|
| `lead` | `domains/<d>/starters/lead/prompt.md` if present, otherwise `platform/lead/prompt.md` | none | none |
| `starter` | `starters/<slug>/prompt.md` | from `agent.yaml` | from `agent.yaml` |
| `custom` | builder input (may be empty) | chosen in the creation dialog | chosen in the creation dialog |

At signup, a user gets the lead plus every starter in their domain ([12](12-auth-and-domains.md#provisioning-a-user)).

## Reset ("Khôi phục bản gốc")

1. Take the job lock. Refuse with 409 if the agent is involved in a running task.
2. `git restore --source=<baseline_commit> --staged --worktree :/`. This also removes tracked files that didn't exist in the baseline. Then `git clean -fd -e .venv -e .env.d -e .contoso` removes untracked files. A lead or starter agent then gets `prompts/system.md` from the domain's current template (the lead or starter prompt), so a fixed template reaches agents created before the fix; a custom agent keeps its own prompt. Commit with author `contoso-harness`, message `reset`.
3. `.env.d/` is git-ignored, so reset leaves it as it is. Credential links are a builder choice, not something the agent learned.
4. Run `uv sync`.
5. Open a new epoch with reason `reset` and an empty summary. Pending deliveries are kept.
6. Rebuild `routine_state` from `routines/`.

`baseline_commit` is the folder as the creation job left it, presets included, so reset works the same for every origin.

## Delete

- The lead can't be deleted. Any other agent can be, unless it is involved in a running task (409).
- Deleting stops the runner and sets `agents.state='deleted'`. The direct thread becomes read-only, and the agent is removed from groups and from `current_state` team lists.
- The folder stays on disk, so the admin chat-trace view still works.

## Git snapshots

Every exec leaves a record of the folder state it produced ([decision 0012](decisions/0012-git-snapshot-per-exec.md)). `execd` takes the snapshot after the exec's whole process group has exited:

1. `git add -A`
2. `git diff --cached --quiet`. Exit code 0 means nothing changed; 1 means something did.
3. If something changed: `git -c user.name=<author> -c user.email=<author>@contoso.local commit -q -m "exec <exec_id>"`.
4. `head = git rev-parse HEAD`
5. `changed = git diff --name-status <old_head> <head>`. This is empty when nothing changed.

| Case | `head` | `changed` |
|---|---|---|
| Files changed | new commit | list of `{path, status}` (`A`, `M`, `D`, `R`) |
| Nothing changed | previous HEAD | `[]` |
| Snapshot failed (e.g. stale `index.lock`) | `null`, plus `snapshot_error` | `null` |

- **A snapshot failure never fails the exec.** The result still reaches the model, and the trace view shows a warning. The next successful snapshot picks up the missed changes.
- **Authors.** The agent's own execs commit as `agent:<slug>`. System execs commit as the author `api` passes: `user:<username>` for builder actions, `contoso-harness` for creation, reset and notices that copy files.
- **Commits `api` makes itself** (builder file writes such as the prompt or a routine, inbox copies) use the same author rules, under the same job lock.

## Folder viewer

The viewer is read-only. A user can open their own agents' folders; an admin can open any folder. `api` reads the volume directly.

| Endpoint | Returns |
|---|---|
| `GET /api/agents/{id}/tree?path=&at=` | One directory level: `[{name, type, size, mtime, items, symlink_target}]`, where `type` is `file`, `dir` or `symlink`. For directories, `items` and `size` are counted when listed |
| `GET /api/agents/{id}/file?path=&at=` | Text up to 1 MB as `text/plain; charset=utf-8`, images as raw bytes, other files as `Content-Disposition: attachment` |
| `GET /api/agents/{id}/archive?path=&at=` | A `.zip` of a directory or the whole folder. Always excludes `.venv/` |
| `GET /api/agents/{id}/log?path=&limit=` | Commits touching a path: `[{commit, author, message, at, exec_id}]` |
| `GET /api/agents/{id}/diff?commit=` | Unified diff of one commit (binary files listed only) |

Rules:
- **Path safety.** Every path is resolved under the folder, and `..`, absolute paths and escaping symlinks are refused (400). Symlinks are listed but not followed, except as described next.
- **`.env.d/*.env` shows key names only**, values redacted (`WAREHOUSE_DSN=••••`), for every role, admins included. Archives contain the same redacted text. Only `KEY=••••` lines are shown: comments and values are dropped. A dangling link shows as empty.
- **`.venv/`** is listed as one collapsed entry (`items` and `size` are `null`) and can't be expanded (400 `not_expandable`). **`.contoso/outputs/`** can be browsed. `.git/` is never listed or readable.
- **Errors.** 400 `invalid_path` for an unsafe path, `not_a_directory` / `not_a_file` for the wrong kind, `invalid_commit` when `at` or `commit` isn't a 7–40 character hex hash; 404 `not_found` for a missing path or commit. Archives leave out links that escape the folder or dangle.
- **`at=<commit>`** reads from git (`git show <commit>:<path>`, `git ls-tree`) instead of the working tree. `.contoso/outputs/` doesn't exist at a past commit, because git ignores it.
- **Rendering in the UI.** Markdown is rendered; `.py`, `.yaml`, `.toml` and `.json` are syntax-highlighted; CSV shows a 200-row table preview; images show inline.

## Self-improvement

An agent improves by editing its own folder, either while it works or during compaction:

- Files it reads on demand (helpers, skills, memory notes) take effect immediately.
- The system prompt (`prompts/system.md`, `prompts/context.md`, `memory/index.md`, the skills list) is rendered again only when a new epoch opens. That keeps the context append-only during a task ([decision 0005](decisions/0005-append-only-context-during-a-task.md)).
- `platform/rules.md` tells agents where to keep what: preferences in `memory/preferences.md`, procedures as skills, reusable code in `helpers/`, and durable facts in `prompts/context.md`.
