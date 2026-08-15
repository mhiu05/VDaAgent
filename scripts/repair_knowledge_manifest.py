"""Migrate early crawl records to stable catalog-number source IDs."""

from __future__ import annotations

import json
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
KB_ROOT = ROOT / "data" / "knowledge_base"
MANIFEST = KB_ROOT / "manifests" / "sources.jsonl"


def main() -> None:
    records_by_catalog: dict[int, dict] = {}
    for line in MANIFEST.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        # Last record wins: it is the newest retry after a URL/title correction.
        records_by_catalog[int(record["catalog_number"])] = record

    migrated: list[dict] = []
    for number, record in sorted(records_by_catalog.items()):
        stable_id = f"source-{number:03d}"
        for path_key in ("raw_path", "normalized_path"):
            old_value = record.get(path_key)
            if not old_value:
                continue
            old_path = ROOT / old_value
            if not old_path.exists():
                continue
            suffix = old_path.suffix
            target_dir = old_path.parent
            new_path = target_dir / f"{stable_id}{suffix}"
            if old_path != new_path:
                if new_path.exists():
                    new_path.unlink()
                shutil.move(str(old_path), str(new_path))
            record[path_key] = new_path.relative_to(ROOT).as_posix()
        record["source_id"] = stable_id
        migrated.append(record)

    MANIFEST.write_text(
        "".join(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n" for record in migrated),
        encoding="utf-8",
    )
    print(json.dumps({"records": len(migrated), "manifest": str(MANIFEST)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
