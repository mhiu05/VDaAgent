#!/usr/bin/env python3
from __future__ import annotations
import csv, hashlib, json, re, uuid
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

BASE=Path(__file__).resolve().parent
CURATED=BASE/"curated"
VERSION="2026-09-v1"
ALLOWED_INV={"available","reserved","sold","held","unknown"}
ALLOWED_RES={"active","converted","expired","cancelled","refunded"}
ALLOWED_TX={"pending","confirmed","completed","cancelled","refunded","expired"}
SNAPSHOT_DATES={"2023-01-31","2023-06-30","2023-12-31","2024-03-31","2024-09-30","2024-12-31","2025-03-31","2025-09-30","2025-12-31","2026-09-20"}

errors=[]
warnings=[]
stats={}

def err(msg): errors.append(msg)
def valid_uuid(s):
    try: uuid.UUID(s); return True
    except: return False
def parse_date(s):
    return date.fromisoformat(s) if s else None
def csv_rows(paths):
    for p in paths:
        with p.open("r",encoding="utf-8",newline="") as f:
            for row in csv.DictReader(f):
                yield p,row

manifest=json.loads((BASE/"manifest.json").read_text(encoding="utf-8"))

# Dimension keys
units=set(); unit_project={}; unit_zone={}
with (CURATED/"dim_units.csv").open("r",encoding="utf-8",newline="") as f:
    for r in csv.DictReader(f):
        uid=r["unit_external_id"]
        if uid in units: err(f"duplicate unit_external_id: {uid}")
        units.add(uid); unit_project[uid]=r["project_external_id"]; unit_zone[uid]=r["zone_external_id"]
        if not valid_uuid(uid): err(f"invalid unit UUID: {uid}")
        if r["currency"]!="VND" or r["synthetic_marker"]!="MOCK_ONLY": err(f"invalid unit marker/currency: {uid}")
projects=set()
with (CURATED/"dim_projects.csv").open("r",encoding="utf-8",newline="") as f:
    for r in csv.DictReader(f): projects.add(r["project_external_id"])
zones=set()
with (CURATED/"dim_zones.csv").open("r",encoding="utf-8",newline="") as f:
    for r in csv.DictReader(f): zones.add(r["zone_external_id"])
markets=set()
with (CURATED/"dim_markets.csv").open("r",encoding="utf-8",newline="") as f:
    for r in csv.DictReader(f): markets.add(r["market_external_id"])
stats["dimensions"]={"units":len(units),"projects":len(projects),"zones":len(zones),"markets":len(markets)}
if len(units)!=60000: err(f"dim_units expected 60000, got {len(units)}")
if len(projects)!=12: err(f"dim_projects expected 12, got {len(projects)}")
if len(zones)!=300: err(f"dim_zones expected 300, got {len(zones)}")
if len(markets)!=5: err(f"dim_markets expected 5, got {len(markets)}")

# Inventory checks
inv_files=sorted(CURATED.glob("fact_inventory_snapshot_*.csv"))
inv_count=0; inv_keys=set(); snapshots_by_unit=defaultdict(int)
inv_status=Counter(); inv_project=Counter(); inv_city=Counter(); nulls=Counter()
for p,r in csv_rows(inv_files):
    inv_count+=1
    key=(r["unit_external_id"],r["snapshot_date"])
    if key in inv_keys: err(f"duplicate inventory business key: {key}")
    inv_keys.add(key)
    uid=r["unit_external_id"]
    if uid not in units: err(f"inventory missing unit: {uid}")
    if r["project_external_id"] not in projects: err(f"inventory missing project: {r['project_external_id']}")
    if r["zone_external_id"] not in zones: err(f"inventory missing zone: {r['zone_external_id']}")
    if r["country_code"]!="VN" or r["currency"]!="VND" or r["synthetic_marker"]!="MOCK_ONLY":
        err(f"invalid curated inventory country/currency/marker at {uid}")
    if r["status"] not in ALLOWED_INV: err(f"invalid inventory status {r['status']}")
    if r["snapshot_date"] not in SNAPSHOT_DATES: err(f"unexpected snapshot_date {r['snapshot_date']}")
    sd=parse_date(r["snapshot_date"]); av=parse_date(r["available_since"]); sold=parse_date(r["sold_at"])
    if av and av>sd: err(f"available_since > snapshot_date for {uid}")
    if sold and sold>sd: err(f"sold_at > snapshot_date for {uid}")
    if r["status"]=="sold" and not sold: err(f"sold row missing sold_at for {uid}")
    for c in ("area_sqm","list_price","available_since","sold_at","bedrooms"):
        if r[c]=="": nulls[c]+=1
    if r["area_sqm"]:
        try:
            if float(r["area_sqm"])<=0: err(f"non-positive area in curated inventory: {uid}")
        except: err(f"non-numeric area in curated inventory: {uid}")
    if r["list_price"]:
        try:
            if int(r["list_price"])<0: err(f"negative price in curated inventory: {uid}")
        except: err(f"non-numeric list_price in curated inventory: {uid}")
    snapshots_by_unit[uid]+=1
    inv_status[r["status"]]+=1; inv_project[r["project_external_id"]]+=1; inv_city[r["market_name"]]+=1

if inv_count<600000: err(f"inventory rows below 600000: {inv_count}")
bad_coverage=sum(1 for uid,c in snapshots_by_unit.items() if c!=10)
if bad_coverage: err(f"units without exactly 10 snapshots: {bad_coverage}")
for p in inv_files:
    with p.open("r",encoding="utf-8") as f:
        n=sum(1 for _ in f)-1
    if n>50000: err(f"shard exceeds 50000 rows: {p.name}={n}")
stats["inventory"]={"rows":inv_count,"shards":len(inv_files),"status_distribution":dict(inv_status),"project_distribution":dict(inv_project),"city_distribution":dict(inv_city),"null_distribution":dict(nulls),"snapshot_coverage_bad_units":bad_coverage}

# Compatibility latest snapshot
compat_count=0
with (CURATED/"vda_unit_snapshots.csv").open("r",encoding="utf-8",newline="") as f:
    for r in csv.DictReader(f):
        compat_count+=1
        if r["snapshot_date"]!="2026-09-20": err("compatibility extract contains non-latest snapshot")
if compat_count!=60000: err(f"compatibility extract expected 60000, got {compat_count}")
stats["compatibility_extract_rows"]=compat_count

# Fact helper
def validate_fact(globpat, min_rows, keycol, allowed_status=None, statuscol=None):
    files=sorted(CURATED.glob(globpat)); count=0; keys=set(); status=Counter()
    for p,r in csv_rows(files):
        count+=1
        k=r[keycol]
        if k in keys: err(f"duplicate {keycol}: {k}")
        keys.add(k)
        uid=r.get("unit_external_id","")
        if uid and uid not in units: err(f"{globpat} references missing unit: {uid}")
        pid=r.get("project_external_id","")
        if pid and pid not in projects: err(f"{globpat} references missing project: {pid}")
        zid=r.get("zone_external_id","")
        if zid and zid not in zones: err(f"{globpat} references missing zone: {zid}")
        if r.get("currency") and r["currency"]!="VND": err(f"{globpat} non-VND currency")
        if r.get("synthetic_marker")!="MOCK_ONLY": err(f"{globpat} invalid synthetic marker")
        if not valid_uuid(k): err(f"{globpat} invalid UUID in {keycol}")
        if statuscol:
            s=r[statuscol]; status[s]+=1
            if allowed_status and s not in allowed_status: err(f"{globpat} invalid status {s}")
    if count<min_rows: err(f"{globpat} below minimum {min_rows}: {count}")
    for p in files:
        with p.open("r",encoding="utf-8") as f:
            n=sum(1 for _ in f)-1
        if n>50000: err(f"shard exceeds 50000 rows: {p.name}={n}")
    return {"rows":count,"shards":len(files),"status_distribution":dict(status)}

stats["transactions"]=validate_fact("fact_transaction_*.csv",180000,"transaction_id",ALLOWED_TX,"transaction_status")
stats["price_history"]=validate_fact("fact_price_history_*.csv",250000,"price_history_id")
stats["reservations"]=validate_fact("fact_reservation_*.csv",70000,"reservation_id",ALLOWED_RES,"status")

# Additional numeric/date consistency on facts
for p,r in csv_rows(sorted(CURATED.glob("fact_transaction_*.csv"))):
    td=parse_date(r["transaction_date"])
    if td<date(2023,1,1) or td>date(2026,9,20): err(f"transaction date out of range: {r['transaction_id']}")
    try:
        gross=int(r["gross_amount"]); disc=int(r["discount_amount"]); net=int(r["net_amount"])
        if gross<0 or disc<0 or net<0 or gross-disc!=net: err(f"transaction amount inconsistency: {r['transaction_id']}")
    except: err(f"transaction numeric parse failure: {r['transaction_id']}")
for p,r in csv_rows(sorted(CURATED.glob("fact_price_history_*.csv"))):
    ed=parse_date(r["effective_date"])
    if ed>date(2026,9,20): err(f"price history date out of range: {r['price_history_id']}")
    try:
        if int(r["new_price"])<=0: err(f"non-positive new_price: {r['price_history_id']}")
    except: err(f"price numeric parse failure: {r['price_history_id']}")
for p,r in csv_rows(sorted(CURATED.glob("fact_reservation_*.csv"))):
    rd=parse_date(r["reservation_date"]); ex=parse_date(r["expiry_date"])
    if rd>ex: err(f"reservation date after expiry: {r['reservation_id']}")
    if ex>date(2026,9,20): err(f"reservation expiry after dataset end: {r['reservation_id']}")

# Quarantine counts/schema
qcounts={}
for p in sorted((BASE/"quarantine").glob("*.csv")):
    n=0
    with p.open("r",encoding="utf-8",newline="") as f:
        for r in csv.DictReader(f):
            n+=1
            for c in ["source_file","source_row_number","error_type","error_message","original_record","detected_at","dataset_version"]:
                if c not in r: err(f"quarantine missing column {c}: {p.name}")
    qcounts[p.name]=n
stats["quarantine_counts"]=qcounts

# Check manifest row counts
for rel,expected in manifest["row_counts"].items():
    p=BASE/rel
    if not p.exists(): err(f"manifest file missing: {rel}"); continue
    with p.open("r",encoding="utf-8",newline="") as f:
        actual=sum(1 for _ in f)-1
    if actual!=expected: err(f"manifest count mismatch {rel}: expected {expected}, got {actual}")

# Check checksums
checksum_fail=[]
for line in (BASE/"checksums.sha256").read_text(encoding="utf-8").splitlines():
    if not line.strip(): continue
    expected,rel=line.split("  ",1)
    p=BASE/rel
    h=hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""): h.update(chunk)
    if h.hexdigest()!=expected: checksum_fail.append(rel)
if checksum_fail: err("checksum mismatch: "+", ".join(checksum_fail))
stats["checksum_failures"]=checksum_fail

total_fact=stats["inventory"]["rows"]+stats["transactions"]["rows"]+stats["price_history"]["rows"]+stats["reservations"]["rows"]
stats["primary_fact_rows"]=total_fact
if total_fact<=1_000_000: err(f"primary fact rows must exceed 1,000,000; got {total_fact}")

report={
    "dataset_version":manifest["dataset_version"],
    "validated_at":"2026-09-20T00:00:00Z",
    "passed":not errors,
    "error_count":len(errors),
    "warning_count":len(warnings),
    "errors":errors[:200],
    "warnings":warnings[:200],
    "stats":stats,
}
(BASE/"validation_report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps({"passed":report["passed"],"error_count":len(errors),"primary_fact_rows":total_fact,
                  "inventory_rows":stats["inventory"]["rows"],"transaction_rows":stats["transactions"]["rows"],
                  "price_history_rows":stats["price_history"]["rows"],"reservation_rows":stats["reservations"]["rows"],
                  "checksum_failures":checksum_fail},ensure_ascii=False,indent=2))
raise SystemExit(0 if report["passed"] else 1)
