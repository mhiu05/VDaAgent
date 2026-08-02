"""Dashboard tĩnh cho P-170.

Chỉ có một file `index.html` (HTML + CSS + JS vanilla, không build step) được
FastAPI serve qua `StaticFiles` tại `/ui`. Xem ADR-011 để biết vì sao chọn cách
này thay vì một app Next.js riêng.
"""

from __future__ import annotations

from pathlib import Path

WEBUI_DIR = Path(__file__).parent
INDEX_HTML = WEBUI_DIR / "index.html"

__all__ = ["INDEX_HTML", "WEBUI_DIR"]
