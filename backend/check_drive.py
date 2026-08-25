"""Manual smoke check for materialising a persisted dataset source."""
# ruff: noqa: E402

import sys

# pyrefly: ignore [missing-import]
from dotenv import load_dotenv

sys.path.insert(0, r"d:\VinUIniAi\DataProfiling\P-170\backend")
load_dotenv(r"d:\VinUIniAi\DataProfiling\P-170\.env")

from src.services.repository import get_repository
from src.config import get_settings

repo = get_repository()
run_id = "5a0bb24ef24c4082a93b58e9e550974c"
run = repo.get_profile_run(run_id, workspace_id="default")
if not run:
    print("Run not found!")
    sys.exit(0)

print(f"Run found: {run['dataset_id']}")
dataset = repo.get_dataset(run['dataset_id'])
print(f"Dataset ref: {dataset['source_ref']}")

try:
    from src.services.storage import materialize_source
    with materialize_source(dataset['source_ref'], get_settings()) as path:
        print(f"Successfully downloaded to {path}")
except Exception as exc:
    print(f"Failed to materialize: {type(exc).__name__}: {exc}")
