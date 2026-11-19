# 05 · Agent builder

How users create and customize agents without writing code. **Depends on:** [04](04-agent-folder.md), [06](06-context-and-compaction.md), [11](11-sandbox.md).

## Principles

1. **The folder is the only source of truth.** The builder reads and writes folder files: the prompt, `skills/`, `pyproject.toml`, `routines/` and `.env.d/`. No DB table copies what an agent has installed.
2. **Every builder change is a commit by `user:<username>`**, so the history separates user edits from the agent's own self-improvement edits.
3. **Every builder change notifies the agent.** A notice delivery describes the change, so the agent can act on it right away without breaking the prompt cache ([decision 0016](decisions/0016-builder-edits-notify-then-apply-at-a-safe-point.md)).
4. **One writer at a time.** Builder jobs take the agent's job lock, the same lock the agent's own execs take. A save made while the agent is mid-exec waits until that exec finishes. The UI shows "Đang cài…" until the save completes. Creation jobs lock on `(user_id, slug)`, because the agent doesn't exist yet.

## Tabs

| Tab | What the user does | Writes | Notice to the agent |
|---|---|---|---|
| **Thông tin** | slug (only at creation), display name, avatar (emoji + colour), description | `agents` row | none |
| **Vai trò** | edit the markdown role and preferences | `prompts/system.md`, plus compaction becomes pending | `Người dùng đã cập nhật vai trò của bạn:` followed by a unified diff |
| **Kỹ năng** | browse the catalog, install or remove a skill, install from a GitHub link, see every skill in `skills/` | `skills/<name>/` | `Kỹ năng mới: <name> — đọc skills/<name>/SKILL.md` / `Đã gỡ kỹ năng: <name>` |
| **Thư viện** | apply presets, add or remove single packages, see installed packages | `pyproject.toml`, `uv.lock`, `.venv/` | `Thư viện đã thay đổi: +pandas, +pyarrow` / `-seaborn` |
| **Lịch** | create, edit, enable or delete routines | `routines/<name>.yaml` | `Lịch "<name>" đã được tạo/cập nhật/xóa: <cron>` |
| **Dữ liệu** | attach or detach the domain's credential sets | `.env.d/` symlinks | `Quyền dữ liệu thay đổi: +warehouse (WAREHOUSE_DSN, WAREHOUSE_SCHEMA)`. Key names only |
| **Thư mục** | browse the folder and its history ([04](04-agent-folder.md#folder-viewer)) | — | — |

The **lead** has the same tabs, with three exceptions: its slug is fixed, it can't be deleted, and `platform/rules.md` (which holds its queue duties) can't be edited.

**Creating an agent** (`/agents/new`) asks for a slug, display name, avatar and description, then offers **"Bắt đầu từ mẫu"** (copy one of the domain's starters with a new slug) or **"Trống"** (an empty prompt, plus presets and credential sets picked in the same dialog). It runs the creation job from [04](04-agent-folder.md#creating-an-agent).

## Prompt edits

- **Save** writes `prompts/system.md`, commits it, and appends the diff notice. It also sets compaction to pending.
- The agent's behaviour changes as soon as it reads the notice. At the next safe point, compaction opens a new epoch, and the system prompt is rendered again with the new role ([06](06-context-and-compaction.md#compaction)).
- The editor warns before saving if the prompt is over 8,000 characters.
- The lead's platform rules are rendered above `prompts/system.md` and aren't shown as editable text.

## Skills

### Catalog

The `skill_catalog` table ([10](10-data-model.md)) is seeded at boot from `platform/seeds/skills.yaml` plus `domains/<id>/seeds/skills.yaml` (optional), upserted by `id`. A user sees the global rows (`domain_id IS NULL`) plus their own domain's rows.

```yaml
# platform/seeds/skills.yaml
- id: xlsx
  name: xlsx                       # directory name under skills/
  title_vi: Đọc & tạo file Excel
  description_vi: Đọc bảng tính khách gửi, xuất báo cáo .xlsx có công thức và định dạng.
  tags: [Báo cáo, Excel]
  install_cmd: [python, -m, contoso.skills, install, anthropics/skills, skills/xlsx, --ref, dbd4588f9e1033efb41dad4bef2f7947c8993d44]
```

- **`install_cmd`** is an argv array, never a shell string. It runs as a system exec with `cwd` set to the agent folder.
- **The initial seed** pins `anthropics/skills` at `dbd4588f9e1033efb41dad4bef2f7947c8993d44` and ships `xlsx`, `docx`, `pdf` and `pptx`. Domain seeds add their own rows ([18](18-domains.md)).
- **Seed validation** at boot requires a unique `id`, a unique `name` within the global rows plus any one domain's rows, a pinned `--ref` of 40 hex characters, and `install_cmd[0:3] == [python, -m, contoso.skills]`. A skill `id` is unique across the global rows and every domain's (it is the primary key). The checks are `backend/catalog/validate.py`; a domain seed that fails them makes that domain unavailable ([12](12-auth-and-domains.md#validation-at-boot)). If the global validation fails, the marketplace is disabled (and the reason logged); everything else still runs.

### Installer `contoso.skills`

`python -m contoso.skills install <owner/repo> <path> --ref <sha> [--name <dir>]`. It uses only the standard library and is baked into the workspace image ([11](11-sandbox.md)).

1. Download `https://codeload.github.com/<owner>/<repo>/tar.gz/<sha>`, sending `Authorization: Bearer $GITHUB_TOKEN` if that variable is set. The download is capped at 50 MB.
2. Extract only the members under `<repo>-<sha>/<path>/`. Refuse absolute paths, `..` and links that point outside the folder.
3. Require `SKILL.md` at the top of the extracted directory, with YAML frontmatter containing `name` and `description`.
4. Write the result to `skills/<name or --name>/`, replacing any existing directory atomically (extract to `skills/.tmp-<name>`, then rename).
5. Print `{"installed": "skills/<dir>", "files": N, "has_code": bool}` as JSON. `has_code` is true if any file ends in `.py`, `.sh` or `.js`, or is executable.

The directory name (`--name`, else the frontmatter `name`) must match `[A-Za-z0-9][A-Za-z0-9._-]*`. Links must stay inside the skill; hard links are refused. On any failure the installer prints the reason to stderr, exits non-zero and leaves an existing install untouched. For tests, `CONTOSO_SKILLS_CODELOAD_URL` replaces `https://codeload.github.com` (the `fixtures` server in [17](17-testing.md)).

**Install from link** turns `https://github.com/<owner>/<repo>/tree/<ref>/<path>` into the same command. If `<ref>` is a branch, `api` resolves it to a commit SHA first through `GET https://api.github.com/repos/<owner>/<repo>/commits/<ref>`, so every install is pinned.

**Preview before install.** `GET /api/catalog/skills/{id}/preview` returns the rendered `SKILL.md` and the file list. `api` fetches these from `raw.githubusercontent.com` and the tarball listing, and caches them on disk under `/data/cache/skills/<sha>/`. The install dialog shows the source, the file list and, when `has_code` is true, a warning: "Kỹ năng này chứa mã chạy trong thư mục agent".

**"Đã cài"** means a directory `skills/<catalog.name>/` exists. Pressing install again re-installs and overwrites it. **Removing** a skill deletes `skills/<name>/` and commits.

**Agent-made skills** are any other directories in `skills/`. They are shown the same way; the commit history tells you who created them.

## Libraries

The `library_presets` table is seeded from `platform/seeds/library_presets.yaml` and domain seeds. A preset is a one-shot installer ([decision 0015](decisions/0015-library-presets-are-one-shot-installers.md)). Seed validation requires a unique `id` (across the global rows and every domain's, since it is the primary key) and `packages` as a non-empty list of strings.

```yaml
- id: data
  title_vi: Phân tích dữ liệu
  description_vi: Đọc, lọc, gộp bảng lớn.
  packages: ["pandas>=2.2", "numpy>=2.0", "pyarrow>=17"]
- id: postgres
  title_vi: Kết nối PostgreSQL
  packages: ["psycopg[binary]>=3.2", "sqlalchemy>=2.0"]
- id: charts
  title_vi: Vẽ biểu đồ
  packages: ["matplotlib>=3.9", "seaborn>=0.13"]
- id: stats
  title_vi: Thống kê
  packages: ["scipy>=1.14", "statsmodels>=0.14", "scikit-learn>=1.5"]
- id: documents
  title_vi: Tài liệu Word/Excel/PDF
  packages: ["python-docx>=1.1", "openpyxl>=3.1", "reportlab>=4.2", "markdown>=3.7"]
- id: web
  title_vi: Truy cập web
  packages: ["httpx>=0.27", "beautifulsoup4>=4.12"]
```

- **Apply preset** runs the system exec `uv add <packages…>` once. Nothing remembers that the preset was used. Applying it again changes nothing.
- **Installed packages** are read live from `pyproject.toml` `[project].dependencies`. Each one has a remove button (`uv remove <name>`). A text field adds a single package (`uv add <spec>`), checked against PEP 508 before the job starts.
- **Failure.** `uv add` and `uv remove` are atomic. If one fails (an unknown package, a version conflict), the folder is unchanged, and the job ends `failed` with the last 4 KB of `uv` output shown in the UI.
- **Speed.** The workspace image pre-fills the uv cache with every package of every seeded preset, so applying a preset works offline and takes seconds ([11](11-sandbox.md#image)).

## Routines

- **The Lịch tab** edits `routines/<name>.yaml` ([09](09-routines.md)). `name` matches `^[a-z0-9-]{2,32}$`.
- **Schedule picker.** "Hằng ngày lúc HH:MM", "Hằng tuần vào <days> lúc HH:MM" and "Mỗi N giờ" each produce a cron expression. "Nâng cao" accepts raw 5-field cron, validated with `croniter`. All times are in `Asia/Ho_Chi_Minh`.
- **Display.** The tab shows the next three fire times and the last run (`routine_state.last_started_at` / `last_ended_at`).

## Credential sets

- The tab lists the domain's sets (`GET /api/catalog/credential-sets`), each showing its name, its description (taken from the `# description:` first line of the `.env.example`) and its key names.
- **Attaching** a set creates the symlink `.env.d/<set>.env`; **detaching** removes it. The change takes effect on the next exec. No commit is made, because `.env.d/` is git-ignored. The change is recorded in the notice and in the structured log.
