"""Crawl official knowledge-base sources listed in docs/knowledge-base-crawl-sources.md.

The crawler intentionally keeps the pipeline conservative:
  - reads only URLs explicitly listed in the source catalog;
  - stores a normalized Markdown document and one manifest record per source;
  - preserves a raw response for audit/re-processing;
  - uses a polite delay and does not execute downloaded content;
  - skips binary/PDF conversion when pdftotext is unavailable.

Usage (from repository root):
    .venv\\Scripts\\python.exe scripts/crawl_knowledge_base.py --priority P0 --limit 8
    .venv\\Scripts\\python.exe scripts/crawl_knowledge_base.py --priority P0 --start 8
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
import time
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import requests


ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "docs" / "knowledge-base-crawl-sources.md"
KB_ROOT = ROOT / "data" / "knowledge_base"
RAW_ROOT = KB_ROOT / "raw"
NORMALIZED_ROOT = KB_ROOT / "normalized"
MANIFEST_PATH = KB_ROOT / "manifests" / "sources.jsonl"

USER_AGENT = "P-170-knowledge-base-crawler/1.0 (+local-first-data-profiling-agent)"
BLOCK_TAGS = {"script", "style", "noscript", "svg", "canvas", "nav", "footer", "header", "aside", "form"}
BLOCK_END = {"article", "br", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "p", "pre", "section", "table", "tr", "ul", "ol", "title"}


@dataclass
class Source:
    number: int
    priority: str
    title: str
    url: str
    description: str
    access: str
    category: str


class TextExtractor(HTMLParser):
    """Small dependency-free HTML-to-text extractor.

    It deliberately favors recall and auditability over clever DOM heuristics.
    Navigation-like containers are ignored, while headings and paragraphs are
    kept as line boundaries so later chunking can use the normalized Markdown.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip_depth = 0
        self.title_parts: list[str] = []
        self.in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.casefold()
        if tag in BLOCK_TAGS:
            self.skip_depth += 1
        if tag == "title":
            self.in_title = True
        if self.skip_depth == 0 and tag in BLOCK_END:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.casefold()
        if tag == "title":
            self.in_title = False
        if self.skip_depth == 0 and tag in BLOCK_END:
            self.parts.append("\n")
        if tag in BLOCK_TAGS and self.skip_depth:
            self.skip_depth -= 1

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.title_parts.append(data)
        if self.skip_depth == 0:
            self.parts.append(data)

    @property
    def title(self) -> str:
        return clean_text(" ".join(self.title_parts))

    @property
    def text(self) -> str:
        return clean_text("".join(self.parts))


def clean_text(value: str) -> str:
    value = value.replace("\u00a0", " ").replace("\r\n", "\n").replace("\r", "\n")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n[ \t]+", "\n", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def slugify(value: str) -> str:
    value = value.casefold().replace("/", "-")
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value[:100] or "source"


def source_id_for(source: Source) -> str:
    """Stable identity: catalog number survives title/URL corrections."""
    return f"source-{source.number:03d}"


def parse_catalog(path: Path) -> list[Source]:
    sources: list[Source] = []
    category = "uncategorized"
    table_re = re.compile(
        r"^\|\s*(\d+)\s*\|\s*(P[012])\s*\|\s*\[([^]]+)\]\((https?://[^)]+)\)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*$"
    )
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            category = line[3:].strip()
        match = table_re.match(line)
        if not match:
            continue
        number, priority, title, url, description, access = match.groups()
        sources.append(Source(int(number), priority, title, url, description, access, category))
    return sources


def source_allowed(url: str, session: requests.Session) -> tuple[bool, str]:
    parsed = urlparse(url)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    parser = RobotFileParser()
    parser.set_url(robots_url)
    try:
        response = session.get(robots_url, timeout=20)
        if response.status_code == 404:
            return True, "robots-404"
        if response.ok:
            parser.parse(response.text.splitlines())
            return parser.can_fetch(USER_AGENT, url), "robots-allowed" if parser.can_fetch(USER_AGENT, url) else "robots-blocked"
        return True, f"robots-http-{response.status_code}"
    except requests.RequestException as exc:
        return True, f"robots-unavailable:{type(exc).__name__}"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def extract_pdf(data: bytes, raw_path: Path) -> tuple[str, str]:
    raw_path.write_bytes(data)
    pdftotext = shutil.which("pdftotext")
    if not pdftotext:
        return "", "pdftotext-not-found"
    with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as output:
        text_path = Path(output.name)
    try:
        result = subprocess.run(
            [pdftotext, "-layout", str(raw_path), str(text_path)],
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
        )
        if result.returncode != 0:
            return "", f"pdftotext-exit-{result.returncode}"
        return clean_text(text_path.read_text(encoding="utf-8", errors="replace")), "pdf-text-extracted"
    finally:
        text_path.unlink(missing_ok=True)


def markdown_for(source: Source, retrieved_at: str, final_url: str, content: str, extraction: str) -> str:
    metadata = {
        "source_id": source_id_for(source),
        "catalog_number": source.number,
        "priority": source.priority,
        "title": source.title,
        "publisher_or_category": source.category,
        "canonical_url": source.url,
        "final_url": final_url,
        "access": source.access,
        "retrieved_at": retrieved_at,
        "extraction": extraction,
    }
    front_matter = "\n".join(
        ["---"]
        + [f"{key}: {json.dumps(value, ensure_ascii=False)}" for key, value in metadata.items()]
        + ["---", ""]
    )
    return front_matter + f"# {source.title}\n\n{content}\n"


def read_manifest() -> dict[str, dict]:
    if not MANIFEST_PATH.exists():
        return {}
    records: dict[str, dict] = {}
    for line in MANIFEST_PATH.read_text(encoding="utf-8").splitlines():
        if line.strip():
            record = json.loads(line)
            records[record["source_id"]] = record
    return records


def write_manifest(records: Iterable[dict]) -> None:
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    ordered = sorted(records, key=lambda item: item.get("catalog_number", 0))
    MANIFEST_PATH.write_text(
        "".join(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n" for record in ordered),
        encoding="utf-8",
    )


def crawl(source: Source, session: requests.Session) -> dict:
    source_id = source_id_for(source)
    raw_extension = ".pdf" if ".pdf" in source.url.casefold() else ".html"
    raw_path = RAW_ROOT / f"{source_id}{raw_extension}"
    normalized_path = NORMALIZED_ROOT / f"{source_id}.md"
    retrieved_at = now_iso()
    base_record = {
        "source_id": source_id,
        "catalog_number": source.number,
        "priority": source.priority,
        "title": source.title,
        "category": source.category,
        "canonical_url": source.url,
        "access": source.access,
        "retrieved_at": retrieved_at,
    }
    try:
        allowed, robots_status = source_allowed(source.url, session)
        base_record["robots"] = robots_status
        if not allowed:
            base_record.update({"status": "blocked_by_robots", "error": robots_status})
            return base_record

        response = session.get(source.url, timeout=45, allow_redirects=True)
        response.raise_for_status()
        data = response.content
        content_type = response.headers.get("content-type", "").casefold()
        final_url = response.url
        is_pdf = ".pdf" in final_url.casefold() or "application/pdf" in content_type
        raw_path.parent.mkdir(parents=True, exist_ok=True)
        normalized_path.parent.mkdir(parents=True, exist_ok=True)
        if is_pdf:
            content, extraction = extract_pdf(data, raw_path)
        else:
            raw_path.write_bytes(data)
            encoding = response.encoding or response.apparent_encoding or "utf-8"
            parser = TextExtractor()
            parser.feed(data.decode(encoding, errors="replace"))
            content = parser.text
            extraction = "html-text-extracted"
            if parser.title and len(content) < len(parser.title):
                content = parser.title + "\n\n" + content
        if not content:
            content = "Nội dung chưa trích xuất được tự động. Xem raw response và canonical URL."
            extraction += ";empty-content"
        markdown = markdown_for(source, retrieved_at, final_url, content, extraction)
        normalized_path.write_text(markdown, encoding="utf-8")
        base_record.update(
            {
                "status": "ok",
                "http_status": response.status_code,
                "final_url": final_url,
                "content_type": content_type,
                "raw_path": raw_path.relative_to(ROOT).as_posix(),
                "normalized_path": normalized_path.relative_to(ROOT).as_posix(),
                "raw_bytes": len(data),
                "normalized_chars": len(markdown),
                "raw_sha256": sha256_bytes(data),
                "normalized_sha256": sha256_bytes(markdown.encode("utf-8")),
                "extraction": extraction,
            }
        )
        return base_record
    except (requests.RequestException, UnicodeError, OSError, subprocess.SubprocessError) as exc:
        base_record.update({"status": "error", "error": f"{type(exc).__name__}: {exc}"})
        return base_record


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--priority", choices=["P0", "P1", "P2"], default="P0")
    parser.add_argument("--start", type=int, default=0, help="Zero-based offset within the selected priority")
    parser.add_argument("--limit", type=int, default=0, help="Maximum number of sources in this batch; 0 means all")
    parser.add_argument("--delay", type=float, default=1.5, help="Seconds between source requests")
    args = parser.parse_args()

    if not CATALOG.exists():
        raise SystemExit(
            f"Thiếu source catalog: {CATALOG}. Khôi phục docs/knowledge-base-crawl-sources.md "
            "trước khi crawl để đảm bảo URL/provenance được review."
        )

    sources = [source for source in parse_catalog(CATALOG) if source.priority == args.priority]
    sources = sources[args.start :]
    if args.limit:
        sources = sources[: args.limit]
    records = read_manifest()
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5"})
    print(f"Crawling {len(sources)} {args.priority} sources into {KB_ROOT}")
    for index, source in enumerate(sources, start=1):
        result = crawl(source, session)
        records[result["source_id"]] = result
        write_manifest(records.values())
        print(json.dumps({"n": index, "total": len(sources), "title": source.title, "status": result["status"]}, ensure_ascii=False))
        if index < len(sources):
            time.sleep(max(0.0, args.delay))
    return 0 if all(records[source_id_for(source)]["status"] == "ok" for source in sources) else 2


if __name__ == "__main__":
    raise SystemExit(main())
