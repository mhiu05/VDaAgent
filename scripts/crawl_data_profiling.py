import sys
import io
import re
import os
from pathlib import Path
import httpx
from bs4 import BeautifulSoup

# Reconfigure stdout/stderr to use UTF-8 encoding (resolves Windows terminal encoding errors)
if hasattr(sys.stdout, 'buffer'):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'buffer'):
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# Add backend root to sys.path so we can import src modules
scripts_dir = Path(__file__).resolve().parent
repo_root = scripts_dir.parent
backend_src = repo_root / "backend"
sys.path.insert(0, str(backend_src))

from src.services.retrieval import HybridIndex
from src.config import get_settings

# Wikipedia pages to crawl
WIKI_PAGES = {
    "data_profiling": "https://en.wikipedia.org/wiki/Data_profiling",
    "data_analysis": "https://en.wikipedia.org/wiki/Data_analysis",
    "exploratory_data_analysis": "https://en.wikipedia.org/wiki/Exploratory_data_analysis",
    "data_analytics": "https://en.wikipedia.org/wiki/Data_analytics"
}

def clean_text(text: str) -> str:
    # Remove citation brackets like [1], [2], [citation needed]
    text = re.sub(r'\[\d+\]', '', text)
    text = re.sub(r'\[edit\]', '', text)
    text = re.sub(r'\[clarification needed\]', '', text)
    text = re.sub(r'\[citation needed\]', '', text)
    # Remove multiple spaces/newlines
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()

def slugify(text: str) -> str:
    text = text.lower()
    text = re.sub(r'[^a-z0-9]+', '_', text)
    return text.strip('_')

def crawl_and_parse(topic: str, url: str) -> list[dict]:
    print(f"Fetching {url}...")
    import subprocess
    html_content = ""
    try:
        # Use system curl.exe since it successfully bypasses Wikipedia's fingerprint/UA blocks
        result = subprocess.run(
            ["curl.exe", "-sL", "-A", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", url],
            capture_output=True,
            text=False,
            check=True
        )
        html_content = result.stdout.decode('utf-8', errors='replace')
    except Exception as e:
        print(f"Error fetching {url} using curl: {e}")
        # Fallback to httpx
        try:
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
            response = httpx.get(url, headers=headers, timeout=20.0, follow_redirects=True)
            response.raise_for_status()
            html_content = response.text
        except Exception as ex:
            print(f"Fallback HTTPX also failed: {ex}")
            return []

    if not html_content:
        return []

    soup = BeautifulSoup(html_content, 'html.parser')
    
    # Remove unwanted elements
    for el in soup.find_all(['script', 'style', 'table', 'noscript']):
        el.decompose()

    # Find the main body content container
    content_div = soup.find(id="mw-content-text")
    if not content_div:
        content_div = soup.find(class_="mw-parser-output")
    if not content_div:
        content_div = soup
        
    documents = []
    
    current_section = "Introduction"
    current_paragraphs = []
    
    # Iterate through elements recursively
    parser_output = content_div.find(class_="mw-parser-output") or content_div
    elements = parser_output.find_all(['h2', 'h3', 'p', 'ul', 'ol'])
    for child in elements:
        if child.name in ['h2', 'h3']:
            # Save the previous section if it has text
            section_text = "\n\n".join(current_paragraphs)
            section_text = clean_text(section_text)
            if section_text and len(section_text) > 100:
                documents.append({
                    "section_title": current_section,
                    "text": section_text
                })
            
            # Start new section
            # Wikipedia headings usually contain a span with class mw-headline
            headline_span = child.find(class_="mw-headline")
            if headline_span:
                current_section = headline_span.text.strip()
            else:
                current_section = child.text.strip()
            current_paragraphs = []
        elif child.name in ['p', 'ul', 'ol']:
            current_paragraphs.append(child.text)
            
    # Save the last section
    section_text = "\n\n".join(current_paragraphs)
    section_text = clean_text(section_text)
    if section_text and len(section_text) > 100:
        documents.append({
            "section_title": current_section,
            "text": section_text
        })
        
    # Map raw sections to finalized document dicts
    final_docs = []
    for doc in documents:
        # Ignore references, notes, external links sections
        title_lower = doc["section_title"].lower()
        if any(ignored in title_lower for ignored in ["references", "see also", "further reading", "external links", "notes", "bibliography"]):
            continue
            
        slug = slugify(doc["section_title"])
        doc_id = f"kb:wikipedia:{topic}:{slug}"
        
        # Build markdown text representation
        md_text = f"# {doc['section_title']}\n\n*Topic: {topic.replace('_', ' ').title()} ({url})*\n\n{doc['text']}"
        
        final_docs.append({
            "doc_id": doc_id,
            "title": doc["section_title"],
            "text": md_text,
            "metadata": {
                "source": "wikipedia",
                "url": url,
                "topic": topic,
                "section": doc["section_title"]
            }
        })
        
    print(f"Extracted {len(final_docs)} sections for {topic}")
    return final_docs

def main():
    settings = get_settings()
    kb_dir = settings.data_path / "crawl_db" / "crawled_kb"
    kb_dir.mkdir(parents=True, exist_ok=True)
    
    print("Initializing Hybrid Index...")
    index = HybridIndex(settings)
    
    all_docs = []
    for topic, url in WIKI_PAGES.items():
        topic_dir = kb_dir / topic
        topic_dir.mkdir(parents=True, exist_ok=True)
        
        docs = crawl_and_parse(topic, url)
        all_docs.extend(docs)
        
        # Save individual markdown files
        for d in docs:
            slug = slugify(d["title"])
            file_path = topic_dir / f"{slug}.md"
            file_path.write_text(d["text"], encoding="utf-8")
            
    print(f"Crawled total {len(all_docs)} segments. Upserting into HybridIndex...")
    
    for i, d in enumerate(all_docs, 1):
        print(f"[{i}/{len(all_docs)}] Upserting {d['doc_id']}...")
        index.upsert(
            doc_id=d["doc_id"],
            text=d["text"],
            metadata=d["metadata"]
        )
        
    print("Successfully crawled and indexed all knowledge base documents!")
    
    # Test query
    print("\nTesting queries on indexed knowledge base...")
    test_queries = [
        "What is data profiling?",
        "What is exploratory data analysis?",
        "Difference between data analysis and data profiling"
    ]
    for q in test_queries:
        print(f"\nQuery: '{q}'")
        try:
            hits = index.search(q, top_k=2)
            for idx, hit in enumerate(hits, 1):
                print(f"  {idx}. [{hit.doc_id}] Score: {hit.score:.4f} | Source: {hit.source}")
                snippet = hit.text[:120].replace('\n', ' ')
                print(f"     Snippet: {snippet}...")
        except Exception as e:
            print(f"  Error querying: {e}")

if __name__ == "__main__":
    main()
