"""Build a deterministic, provenance-preserving external knowledge corpus."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KB_ROOT = ROOT / "data" / "knowledge_base"
MANIFEST = KB_ROOT / "manifests" / "sources.jsonl"
OUTPUT = KB_ROOT / "knowledge_base.jsonl"
TARGET_CHARS = 3_000
MAX_CHARS = 6_000
OVERLAP_CHARS = 500
TINY_TAIL_CHARS = 300


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def without_front_matter(text: str) -> str:
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end >= 0:
            return text[end + len("\n---") :].strip()
    return text.strip()


def remove_repeated_boilerplate(text: str) -> str:
    """Remove only unmistakable single-line navigation/cookie boilerplate."""
    patterns = re.compile(
        r"^(skip to (main )?content|cookie (settings|policy)|accept (all )?cookies|"
        r"privacy policy|terms of (use|service)|all rights reserved)\.?$",
        re.IGNORECASE,
    )
    return "\n".join(line for line in text.splitlines() if not patterns.match(line.strip())).strip()


def _units(text: str) -> list[str]:
    sections = re.split(r"(?=^#{1,6}\s+)", text, flags=re.MULTILINE)
    units: list[str] = []
    for section in sections:
        paragraphs = re.split(r"\n\s*\n", section.strip())
        units.extend(part.strip() for part in paragraphs if part.strip())
    return units


def _split_long_unit(unit: str) -> list[str]:
    if len(unit) <= MAX_CHARS:
        return [unit]
    sentences = re.split(r"(?<=[.!?])\s+", unit)
    pieces: list[str] = []
    current = ""
    for sentence in sentences:
        if current and len(current) + len(sentence) + 1 > MAX_CHARS:
            pieces.append(current)
            overlap = current[-OVERLAP_CHARS:].rsplit(" ", 1)[-1] if len(current) > OVERLAP_CHARS else ""
            current = (overlap + " " + sentence).strip()
        else:
            current = (current + " " + sentence).strip()
    if current:
        pieces.append(current)
    output: list[str] = []
    for piece in pieces:
        while len(piece) > MAX_CHARS:
            cut = piece.rfind(" ", 0, MAX_CHARS)
            cut = cut if cut > MAX_CHARS // 2 else MAX_CHARS
            output.append(piece[:cut].strip())
            piece = piece[max(0, cut - OVERLAP_CHARS) :].strip()
        if piece:
            output.append(piece)
    return output


def chunks(text: str) -> list[str]:
    """Chunk at headings/paragraphs/sentences, never beyond MAX_CHARS."""
    output: list[str] = []
    current = ""
    for unit in _units(text):
        for part in _split_long_unit(unit):
            if current and len(current) + len(part) + 2 > MAX_CHARS:
                output.append(current)
                current = ""
            current = (current + "\n\n" + part).strip()
            if len(current) >= TARGET_CHARS:
                output.append(current)
                current = ""
    if current:
        if output and len(current) < TINY_TAIL_CHARS and len(output[-1]) + len(current) + 2 <= MAX_CHARS:
            output[-1] = output[-1] + "\n\n" + current
        else:
            output.append(current)
    return output


def main() -> None:
    records = [json.loads(line) for line in MANIFEST.read_text(encoding="utf-8").splitlines() if line.strip()]
    output: list[dict[str, object]] = []
    for record in sorted(records, key=lambda item: str(item.get("source_id", ""))):
        if record.get("status") != "ok" or not record.get("normalized_path"):
            continue
        path = ROOT / str(record["normalized_path"])
        if not path.exists():
            continue
        text = remove_repeated_boilerplate(without_front_matter(path.read_text(encoding="utf-8", errors="replace")))
        for index, chunk in enumerate(chunks(text), start=1):
            output.append({
                "doc_id": f"{record['source_id']}#chunk-{index:04d}",
                "knowledge_type": "external_knowledge",
                "source_id": record["source_id"],
                "catalog_number": record.get("catalog_number"),
                "title": record["title"],
                "category": record.get("category"),
                "priority": record.get("priority"),
                "canonical_url": record["canonical_url"],
                "final_url": record.get("final_url"),
                "retrieved_at": record.get("retrieved_at"),
                "license_or_access": record.get("access"),
                "language": record.get("language", "en"),
                "source_sha256": record.get("normalized_sha256"),
                "chunk_index": index,
                "chunk_sha256": sha256(chunk),
                "text": chunk,
            })
    OUTPUT.write_text("".join(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n" for item in output), encoding="utf-8")
    print(json.dumps({"sources": len({item['source_id'] for item in output}), "chunks": len(output), "output": str(OUTPUT)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
