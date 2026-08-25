# Install git pre-push hook for AI log submission (Windows PowerShell).
# Run once after cloning: powershell -ExecutionPolicy Bypass -File scripts\setup_hooks.ps1

$ErrorActionPreference = 'Stop'

$RepoRoot = (git rev-parse --show-toplevel).Trim()
if (-not $RepoRoot) { throw 'Not inside a Git repository.' }
$HookFile = Join-Path $RepoRoot '.git/hooks/pre-push'

# Git on Windows runs hooks via Git Bash, so the hook body must be bash.
$HookBody = @'
#!/usr/bin/env bash
# Pre-push: sweep recent Antigravity / Gemini prompts, then submit AI logs.
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$repo_root" ] || exit 0
cd "$repo_root" || exit 0
export AI_LOG_DIR="$repo_root/.ai-log"
bash "$repo_root/scripts/_pyrun.sh" "$repo_root/scripts/log_antigravity.py" --auto || true
bash "$repo_root/scripts/_pyrun.sh" "$repo_root/scripts/submit_log.py" || true
exit 0
'@

Set-Content -Path $HookFile -Value $HookBody -Encoding UTF8 -NoNewline
Write-Host "[ai-log] Git pre-push hook installed."

if (-not (Test-Path (Join-Path $RepoRoot '.ai-log'))) { New-Item -ItemType Directory -Path (Join-Path $RepoRoot '.ai-log') | Out-Null }
if (-not (Test-Path (Join-Path $RepoRoot '.ai-log/.gitkeep'))) { New-Item -ItemType File -Path (Join-Path $RepoRoot '.ai-log/.gitkeep') | Out-Null }

Write-Host "[ai-log] Setup complete. Configure AI_LOG_SERVER in your .env file."
