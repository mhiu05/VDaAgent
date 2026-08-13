"""Validate knowledge-base provenance before an import can write to PostgreSQL."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ROOT = ROOT / "data" / "knowledge_base"
REQUIRED = {"doc_id", "source_id", "title", "canonical_url", "source_sha256", "text"}
MAX_CHARS = 6_000


def _read_jsonl(path: Path, errors: list[str], label: str) -> list[dict]:
    records: list[dict] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        errors.append(f"cannot read {label}: {exc}")
        return records
    for number, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ValueError("record is not an object")
            records.append(value)
        except (json.JSONDecodeError, ValueError) as exc:
            errors.append(f"{label}:{number}: invalid JSONL ({exc})")
    return records


def validate(manifest_path: Path, normalized_dir: Path, corpus_path: Path) -> dict:
    errors: list[str] = []
    warnings: list[str] = []
    manifest = _read_jsonl(manifest_path, errors, "manifest")
    corpus = _read_jsonl(corpus_path, errors, "corpus")
    sources = {str(item.get("source_id")): item for item in manifest if item.get("source_id")}
    ok_sources = {source_id: item for source_id, item in sources.items() if item.get("status") == "ok"}
    seen: set[str] = set()
    chunks_by_source: dict[str, int] = {}
    for number, item in enumerate(corpus, 1):
        missing = sorted(field for field in REQUIRED if not str(item.get(field) or "").strip())
        if missing:
            errors.append(f"corpus:{number}: missing required fields {', '.join(missing)}")
        doc_id, source_id, text = str(item.get("doc_id", "")), str(item.get("source_id", "")), str(item.get("text", ""))
        if doc_id in seen:
            errors.append(f"corpus:{number}: duplicate doc_id {doc_id}")
        seen.add(doc_id)
        if urlparse(str(item.get("canonical_url", ""))).scheme not in {"http", "https"}:
            errors.append(f"corpus:{number}: canonical_url must be HTTP(S)")
        if len(text) > MAX_CHARS:
            errors.append(f"corpus:{number}: chunk exceeds {MAX_CHARS} characters")
        if source_id not in ok_sources:
            errors.append(f"corpus:{number}: source {source_id} is not manifest status ok")
        elif item.get("source_sha256") != ok_sources[source_id].get("normalized_sha256"):
            errors.append(f"corpus:{number}: source hash does not match manifest")
        chunks_by_source[source_id] = chunks_by_source.get(source_id, 0) + 1
    for source_id, item in ok_sources.items():
        normal = item.get("normalized_path")
        if not normal:
            errors.append(f"manifest: ok source {source_id} has no normalized_path")
            continue
        path = ROOT / str(normal)
        if not path.exists():
            # Fixtures may carry just a basename while production manifests
            # retain a project-relative provenance path.
            path = normalized_dir / Path(str(normal)).name
        if not path.exists():
            errors.append(f"manifest: normalized file missing for {source_id}")
            continue
        # The crawler hashes decoded normalized text.  ``read_text`` also
        # normalizes CRLF, so this remains stable across Windows checkouts.
        actual = hashlib.sha256(path.read_text(encoding="utf-8").encode("utf-8")).hexdigest()
        expected = str(item.get("normalized_sha256") or "")
        if actual != expected:
            errors.append(f"manifest: normalized hash mismatch for {source_id}")
        if not chunks_by_source.get(source_id):
            errors.append(f"manifest: ok source {source_id} has no corpus chunks")
        if path.stat().st_size < 300:
            warnings.append(f"source {source_id} is shorter than the minimum chunk target")
    for source_id, item in sources.items():
        if item.get("status") != "ok":
            warnings.append(f"source {source_id} unavailable ({item.get('status')})")
    return {"valid": not errors, "errors": errors, "warnings": warnings, "sources": len(sources), "ok_sources": len(ok_sources), "chunks": len(corpus)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=DEFAULT_ROOT / "manifests" / "sources.jsonl")
    parser.add_argument("--normalized-dir", type=Path, default=DEFAULT_ROOT / "normalized")
    parser.add_argument("--corpus", type=Path, default=DEFAULT_ROOT / "knowledge_base.jsonl")
    args = parser.parse_args()
    summary = validate(args.manifest, args.normalized_dir, args.corpus)
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    return 0 if summary["valid"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
