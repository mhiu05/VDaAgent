"""Validate, bulk import and optionally sync the external knowledge corpus."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CORPUS = ROOT / "data" / "knowledge_base" / "knowledge_base.jsonl"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "backend"))
from scripts.validate_knowledge_base import validate  # noqa: E402


def load(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--sync", action="store_true", help="Delete stale external documents after successful upsert.")
    parser.add_argument("--batch-size", type=int, default=64)
    args = parser.parse_args()
    started = time.monotonic()
    corpus = args.corpus if args.corpus.is_absolute() else ROOT / args.corpus
    if not corpus.exists() or args.batch_size < 1:
        print(json.dumps({"errors": ["corpus missing or batch-size must be positive"]}))
        return 1
    kb_root = ROOT / "data" / "knowledge_base"
    validation = validate(kb_root / "manifests" / "sources.jsonl", kb_root / "normalized", corpus)
    if not validation["valid"]:
        print(json.dumps({"errors": validation["errors"], "warnings": validation["warnings"]}, ensure_ascii=False))
        return 1
    records = load(corpus)
    revision = hashlib.sha256(corpus.read_bytes()).hexdigest()
    summary: dict[str, object] = {
        "corpus_revision": revision, "records": len(records),
        "sources": len({record["source_id"] for record in records}),
        "inserted": 0, "updated": 0, "unchanged": 0,
        "stale": 0, "deleted": 0, "errors": [],
    }
    if args.dry_run:
        summary["duration_seconds"] = round(time.monotonic() - started, 3)
        print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
        return 0
    try:
        from src.services.retrieval import Document, get_index
        index = get_index()
        documents = [Document(record["doc_id"], record["text"], {
            "knowledge_type": "external_knowledge", "corpus_revision": revision,
            "language": record.get("language", "en"), "source_id": record["source_id"],
            "chunk_index": record.get("chunk_index"), "chunk_sha256": record.get("chunk_sha256"),
            "title": record["title"], "category": record.get("category"),
            "priority": record.get("priority"), "canonical_url": record["canonical_url"],
            "retrieved_at": record.get("retrieved_at"), "source_sha256": record["source_sha256"],
        }) for record in records]
        result = index.upsert_many(documents, batch_size=args.batch_size)
        summary.update(result)
        if args.sync:
            from src.services.repository import get_repository
            active_ids = {record["doc_id"] for record in records}
            stale = sum(1 for doc in index.documents if doc.metadata.get("knowledge_type") == "external_knowledge" and doc.doc_id not in active_ids)
            summary["stale"] = stale
            summary["deleted"] = get_repository().delete_external_retrieval_documents_except(active_ids)
            if summary["deleted"]:
                index._load()  # refresh only after DB commit; no partial sync deletion.
    except Exception as exc:  # noqa: BLE001
        summary["errors"] = [str(exc)]
        summary["duration_seconds"] = round(time.monotonic() - started, 3)
        print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
        return 1
    summary["duration_seconds"] = round(time.monotonic() - started, 3)
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
