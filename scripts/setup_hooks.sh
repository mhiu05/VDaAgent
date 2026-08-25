#!/usr/bin/env bash
# Install git pre-push hook for AI log submission (POSIX / Git Bash).
# Run once after cloning: bash scripts/setup_hooks.sh
set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOK_FILE="$REPO_ROOT/.git/hooks/pre-push"

cat > "$HOOK_FILE" <<'EOF'
#!/usr/bin/env bash
# Pre-push: sweep recent Antigravity / Gemini prompts, then submit AI logs.
# Uses the cross-platform Python launcher so it works whether the user
# has python3, python, or only the `py` launcher (Windows).
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$repo_root" ] || exit 0
cd "$repo_root" || exit 0
export AI_LOG_DIR="$repo_root/.ai-log"
bash "$repo_root/scripts/_pyrun.sh" "$repo_root/scripts/log_antigravity.py" --auto || true
bash "$repo_root/scripts/_pyrun.sh" "$repo_root/scripts/submit_log.py" || true
exit 0  # Never block push, even if either step fails
EOF

chmod +x "$HOOK_FILE"
chmod +x scripts/_pyrun.sh 2>/dev/null || true
echo "[ai-log] Git pre-push hook installed."

mkdir -p "$REPO_ROOT/.ai-log"
touch "$REPO_ROOT/.ai-log/.gitkeep"

echo "[ai-log] Setup complete. Configure AI_LOG_SERVER in your .env file."
