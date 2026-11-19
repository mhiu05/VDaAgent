# 0015 · Library presets are one-shot installers

- **Context.** Non-technical users need an easy way to install Python libraries, for example "Phân tích dữ liệu" for pandas and friends. Agents also run `uv add` themselves.
- **Decision.** A preset is a seeded list of packages. Choosing one runs `uv add <packages>` once, and nothing records that the preset was used. The installed-package list is read live from `pyproject.toml`, and packages are removed one at a time.
- **Rejected.**
  - Preset state derived from `pyproject.toml`, with smart removal: complex, and it can remove packages the agent needs.
  - Preset selection stored in the DB: a second source of truth, which drifts whenever the agent runs `uv add` itself.
- **Consequences.** Simple and idempotent. Undoing a preset means removing its packages one by one. See [05](../05-agent-builder.md#libraries).
