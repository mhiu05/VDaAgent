import os
from pathlib import Path


SCRIPT_REPO_ROOT = Path(__file__).resolve().parents[1]


def resolve_log_dir() -> Path:
    configured = Path(os.environ.get('AI_LOG_DIR', '.ai-log'))
    if configured.is_absolute():
        return configured
    return SCRIPT_REPO_ROOT / configured
