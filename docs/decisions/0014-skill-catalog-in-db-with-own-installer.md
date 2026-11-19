# 0014 · Skill catalog in the DB, with our own installer

- **Context.** Users choose skills from a well-known online source, like a plugin marketplace. Skills are folders with a `SKILL.md`, kept in GitHub repos. skills.sh's API accepts only Vercel OIDC tokens, so a compose stack that isn't deployed on Vercel can't call it.
- **Decision.**
  - A curated `skill_catalog` table, seeded from YAML (global plus per-domain, with `domain_id` null meaning global), holding tags and an argv `install_cmd`.
  - Installing means running that command through `execd`: `python -m contoso.skills install <repo> <path> --ref <sha>`, a stdlib installer that extracts one folder from the GitHub tarball into `skills/<name>/`.
  - There is one skills directory, and no provenance file. Git authorship tells installed skills apart from agent-made ones.
- **Rejected.**
  - The skills.sh CLI (`npx skills add`): it needs Node, installs into agent-specific directories, sends telemetry, and isn't pinned by default.
  - Free-form shell commands: there'd be no guarantee the result lands in `skills/<name>/`.
  - A live skills.sh mirror (`mastra-ai/skills-api`): one more service, and tens of thousands of coding skills that would confuse Sales Ops users.
- **Consequences.** Installs are pinned and reproducible. Third-party code needs trust ([99](../99-risks-and-future-work.md)). See [05](../05-agent-builder.md#skills).
