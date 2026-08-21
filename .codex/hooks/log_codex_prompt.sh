#!/usr/bin/env sh
set -u

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$repo_root" ] || exit 0

script="$repo_root/scripts/log_hook.py"
[ -f "$script" ] || exit 0

if [ -x "$repo_root/.venv/bin/python" ]; then
  exec "$repo_root/.venv/bin/python" "$script" --tool=codex
fi

if [ -x "$repo_root/.venv/Scripts/python.exe" ]; then
  exec "$repo_root/.venv/Scripts/python.exe" "$script" --tool=codex
fi

if command -v python3 >/dev/null 2>&1; then
  exec python3 "$script" --tool=codex
fi

if command -v python >/dev/null 2>&1; then
  exec python "$script" --tool=codex
fi

if command -v py >/dev/null 2>&1; then
  exec py -3 "$script" --tool=codex
fi

exit 0
