import os
import sys
import json
from pathlib import Path
# pyrefly: ignore [missing-import]
from dotenv import load_dotenv

sys.path.insert(0, r"d:\VinUIniAi\DataProfiling\P-170\backend")
load_dotenv(r"d:\VinUIniAi\DataProfiling\P-170\.env")

from src.services.repository import get_repository
# pyrefly: ignore [missing-import]
from sqlalchemy import text

repo = get_repository()
try:
    with repo.engine.connect() as conn:
        result = conn.execute(text("SELECT workspace_id, title FROM reports WHERE id = 'c4997ac6285949dab00450e9a61e0e7c'")).fetchone()
        if result:
            print("Found in DB:", result)
            workspace = result[0]
            report = repo.get_report("c4997ac6285949dab00450e9a61e0e7c", workspace_id=workspace, published_only=False)
            if report:
                print("Success! Report title:", report.get("title"))
            else:
                print("Report not found for workspace", workspace)
        else:
            print("Report not in DB at all.")
except Exception as e:
    import traceback
    traceback.print_exc()
