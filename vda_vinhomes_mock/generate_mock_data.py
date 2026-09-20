#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import random
import shutil
import uuid
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path

DEFAULT_SEED = 20260920
DEFAULT_VERSION = "2026-09-v1"
ORG_NAME = "Vinhomes Synthetic Demo"
SYNTHETIC_MARKER = "MOCK_ONLY"
COUNTRY_CODE = "VN"
CURRENCY = "VND"
END_DATE = date(2026, 9, 20)
SNAPSHOT_DATES = [
    date(2023,1,31), date(2023,6,30), date(2023,12,31), date(2024,3,31),
    date(2024,9,30), date(2024,12,31), date(2025,3,31), date(2025,9,30),
    date(2025,12,31), date(2026,9,20),
]
MARKETS = [
    ("Hà Nội", "HN"),
    ("Thành phố Hồ Chí Minh", "HCM"),
    ("Hải Phòng", "HP"),
    ("Quảng Ninh", "QN"),
    ("Thành phố vệ tinh quanh Hà Nội và Thành phố Hồ Chí Minh", "SAT"),
]
PROJECT_NAMES = [
    "Vinhomes Mock Grand Urban 01",
    "Vinhomes Mock Grand Urban 02",
    "Vinhomes Mock Riverside 01",
    "Vinhomes Mock Riverside 02",
    "Vinhomes Mock Smart District 01",
    "Vinhomes Mock Smart District 02",
    "Vinhomes Mock Ocean District 01",
    "Vinhomes Mock Ocean District 02",
    "Vinhomes Mock Central Residence 01",
    "Vinhomes Mock Central Residence 02",
    "Vinhomes Mock Green Township 01",
    "Vinhomes Mock Green Township 02",
]
PROJECT_TYPES = ["urban_complex","residential","waterfront","smart_city","mixed_use","township"]
PRICE_SEGMENTS = ["popular","mid_market","premium","luxury"]
UNIT_TYPES = ["studio","1BR","2BR","3BR","4BR","penthouse","shophouse","townhouse","villa","office","retail","parking"]
VIEW_TYPES = ["city","river","lake","park","pool","internal","street","unknown"]
ORIENTATIONS = ["north","south","east","west","northeast","northwest","southeast","southwest","unknown"]
HANDOVER = ["not_started","under_construction","ready_for_handover","handed_over","delayed","unknown"]
CHANNELS = ["direct","agency","online","corporate","partner"]
CUSTOMER_SEGMENTS = ["mass","affluent","investor","business","overseas_vietnamese"]
PAYMENT_METHODS = ["bank_transfer","installment","mortgage","cash_equivalent"]
CONTRACT_TYPES = ["booking_form","reservation_form","sale_purchase_agreement","transfer_agreement"]
CHANGE_REASONS = ["launch_pricing","phase_update","market_adjustment","promotion","inventory_clearance","product_repricing","correction"]
TX_TYPES = ["booking","reservation","sale_contract","deposit","payment","transfer","refund","cancellation","handover"]
TX_STATUSES = ["pending","confirmed","completed","cancelled","refunded","expired"]

INV_HEADER = [
    "org_id","snapshot_id","import_id","snapshot_date","country_code",
    "market_external_id","market_name","project_external_id","project_name",
    "zone_external_id","zone_name","unit_external_id","unit_code","unit_type",
    "area_sqm","list_price","currency","status","available_since","sold_at",
    "bedrooms","floor_number","building_block","view_type","orientation",
    "handover_status","sales_channel","source_system","batch_id","dataset_version",
    "synthetic_marker"
]
TX_HEADER = [
    "transaction_id","org_id","unit_external_id","project_external_id","zone_external_id",
    "transaction_date","transaction_type","transaction_status","currency","gross_amount",
    "discount_amount","net_amount","payment_method","sales_channel","customer_segment",
    "agent_external_id","contract_type","cancellation_reason","dataset_version","synthetic_marker"
]
PRICE_HEADER = [
    "price_history_id","org_id","unit_external_id","project_external_id","effective_date",
    "previous_price","new_price","currency","change_percent","change_reason","approved_by",
    "dataset_version","synthetic_marker"
]
RES_HEADER = [
    "reservation_id","org_id","unit_external_id","project_external_id","reservation_date",
    "expiry_date","status","deposit_amount","currency","sales_channel","customer_segment",
    "cancellation_reason","dataset_version","synthetic_marker"
]
QUAR_HEADER = ["source_file","source_row_number","error_type","error_message","original_record","detected_at","dataset_version"]

def deterministic_uuid(version: str, kind: str, key: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"vda:{version}:{kind}:{key}"))

def iso(d):
    return d.isoformat() if d else ""

def dec(v, digits=0):
    if v is None:
        return ""
    if digits == 0:
        return str(int(round(v)))
    return f"{v:.{digits}f}"

def safe_date(y,m,d=1):
    return date(y,m,min(d,28))

def add_days(d, n):
    return d + timedelta(days=int(n))

def shard_writer(out_dir: Path, stem: str, header, max_rows=50000):
    state = {"idx": -1, "rows": 0, "fh": None, "writer": None, "files": []}
    def write(row):
        if state["fh"] is None or state["rows"] >= max_rows:
            if state["fh"]:
                state["fh"].close()
            state["idx"] += 1
            path = out_dir / f"{stem}_{state['idx']:03d}.csv"
            fh = path.open("w", newline="", encoding="utf-8")
            wr = csv.writer(fh)
            wr.writerow(header)
            state.update(fh=fh, writer=wr, rows=0)
            state["files"].append(path.name)
        state["writer"].writerow(row)
        state["rows"] += 1
    def close():
        if state["fh"]:
            state["fh"].close()
            state["fh"] = None
    write.close = close
    write.files = state["files"]
    return write

def write_csv(path: Path, header, rows):
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        for r in rows:
            w.writerow(r)

def unit_area_and_price(unit_type: str, r: random.Random, idx: int):
    ranges = {
        "studio": (28,45,1_000_000_000,4_000_000_000),
        "1BR": (40,60,1_500_000_000,5_500_000_000),
        "2BR": (58,90,3_000_000_000,9_000_000_000),
        "3BR": (80,130,5_000_000_000,12_000_000_000),
        "4BR": (120,180,10_000_000_000,40_000_000_000),
        "penthouse": (180,450,18_000_000_000,80_000_000_000),
        "shophouse": (80,250,8_000_000_000,60_000_000_000),
        "townhouse": (120,350,12_000_000_000,80_000_000_000),
        "villa": (220,700,20_000_000_000,150_000_000_000),
        "office": (35,250,2_000_000_000,25_000_000_000),
        "retail": (30,300,3_000_000_000,40_000_000_000),
        "parking": (10,25,300_000_000,1_500_000_000),
    }
    amin, amax, pmin, pmax = ranges[unit_type]
    area = round(r.uniform(amin, amax), 6)
    if idx in (777, 20077, 40777):
        area = round(area * 4.5, 6)  # valid positive area outlier
    price = int(r.uniform(pmin, pmax) / 1_000_000) * 1_000_000
    if idx in (1555, 31555, 51555):
        price = int(price * 2.8)
    return area, price

def bedrooms_for(unit_type, idx):
    mp = {"studio":0,"1BR":1,"2BR":2,"3BR":3,"4BR":4,"penthouse":4,"townhouse":4,"villa":5}
    if idx % 997 == 0:
        return ""
    return mp.get(unit_type, "")

def final_status_for(project_idx: int, unit_in_project: int, global_idx: int):
    # Explicit edge cases:
    if project_idx == 0:  # project with inventory = 0 at final snapshot
        return "sold"
    if project_idx == 1:  # very high available
        return "available" if unit_in_project % 100 < 82 else ("sold" if unit_in_project % 100 < 92 else "reserved")
    if project_idx == 2:  # very high sold
        return "sold" if unit_in_project % 100 < 78 else ("available" if unit_in_project % 100 < 90 else "held")
    x = global_idx % 100
    if x < 42: return "available"
    if x < 56: return "reserved"
    if x < 84: return "sold"
    if x < 93: return "held"
    return "unknown"

def status_at_snapshot(final_status, snapshot_date, launch_date, sold_at, reserved_from, held_from, unknown_from):
    if snapshot_date < launch_date:
        return "unknown"
    if final_status == "sold":
        if sold_at and snapshot_date >= sold_at:
            return "sold"
        if sold_at and snapshot_date >= sold_at - timedelta(days=45):
            return "reserved"
        return "available"
    if final_status == "reserved":
        return "reserved" if reserved_from and snapshot_date >= reserved_from else "available"
    if final_status == "held":
        return "held" if held_from and snapshot_date >= held_from else "available"
    if final_status == "unknown":
        return "unknown" if unknown_from and snapshot_date >= unknown_from else "available"
    return "available"

def current_handover(snapshot_date, project_idx, status, expected_handover):
    if status == "sold" and snapshot_date >= expected_handover:
        return "handed_over" if (project_idx % 5) != 4 else "delayed"
    if snapshot_date >= expected_handover - timedelta(days=90):
        return "ready_for_handover"
    if snapshot_date >= expected_handover - timedelta(days=700):
        return "under_construction"
    return "not_started"

def generate(out: Path, seed: int, version: str):
    if out.exists():
        for child in out.iterdir():
            if child.name not in {"generate_mock_data.py","validate_mock_data.py"}:
                if child.is_dir(): shutil.rmtree(child)
                else: child.unlink()
    curated = out / "curated"
    raw = out / "raw"
    quarantine = out / "quarantine"
    curated.mkdir(parents=True, exist_ok=True)
    raw.mkdir(parents=True, exist_ok=True)
    quarantine.mkdir(parents=True, exist_ok=True)

    r = random.Random(seed)
    org_id = deterministic_uuid(version, "org", ORG_NAME)

    # Dimensions
    write_csv(curated/"dim_organizations.csv",
              ["org_id","organization_name","country_code","dataset_version","synthetic_marker"],
              [[org_id,ORG_NAME,COUNTRY_CODE,version,SYNTHETIC_MARKER]])

    market_rows, market_ids = [], {}
    for i,(name,code) in enumerate(MARKETS):
        mid = deterministic_uuid(version,"market",code)
        market_ids[i] = mid
        market_rows.append([mid,code,name,COUNTRY_CODE,CURRENCY,version,SYNTHETIC_MARKER])
    write_csv(curated/"dim_markets.csv",
              ["market_external_id","market_code","market_name","country_code","currency","dataset_version","synthetic_marker"],
              market_rows)

    projects = []
    project_rows = []
    launch_dates = [
        date(2023,1,1), date(2023,4,1), date(2023,7,1), date(2023,10,1),
        date(2024,1,1), date(2024,4,1), date(2024,7,1), date(2024,10,1),
        date(2025,1,1), date(2025,4,1), date(2025,7,1), date(2025,10,1),
    ]
    for pidx,name in enumerate(PROJECT_NAMES):
        midx = pidx % len(MARKETS)
        pid = deterministic_uuid(version,"project",f"P{pidx+1:02d}")
        launch = launch_dates[pidx]
        handover = launch + timedelta(days=900 + (pidx%4)*120)
        pstatus = "completed" if handover <= END_DATE else ("selling" if launch <= END_DATE else "planned")
        row = {
            "project_external_id":pid, "project_name":name, "market_external_id":market_ids[midx],
            "market_name":MARKETS[midx][0], "project_type":PROJECT_TYPES[pidx%len(PROJECT_TYPES)],
            "launch_date":launch, "expected_handover_date":handover, "total_units":5000,
            "project_status":pstatus, "price_segment":PRICE_SEGMENTS[pidx%len(PRICE_SEGMENTS)]
        }
        projects.append(row)
        project_rows.append([
            pid,name,market_ids[midx],MARKETS[midx][0],row["project_type"],iso(launch),iso(handover),
            5000,pstatus,row["price_segment"],SYNTHETIC_MARKER
        ])
    write_csv(curated/"dim_projects.csv",
              ["project_external_id","project_name","market_external_id","market_name","project_type","launch_date",
               "expected_handover_date","total_units","project_status","price_segment","synthetic_marker"],
              project_rows)

    zones = []
    zone_rows = []
    for pidx,p in enumerate(projects):
        for z in range(25):
            zid = deterministic_uuid(version,"zone",f"P{pidx+1:02d}-Z{z+1:02d}")
            zname = f"Mock Zone {pidx+1:02d}-{z+1:02d}"
            block_count = 1 if (pidx in (3,8) and z < 5) else 4 + (z % 5)
            zones.append((pidx,z,zid,zname,block_count))
            zone_rows.append([zid,zname,p["project_external_id"],p["project_name"],z+1,block_count,200,version,SYNTHETIC_MARKER])
    write_csv(curated/"dim_zones.csv",
              ["zone_external_id","zone_name","project_external_id","project_name","zone_sequence","building_block_count",
               "total_units","dataset_version","synthetic_marker"], zone_rows)

    # Dates
    date_rows = []
    d = date(2023,1,1)
    while d <= END_DATE:
        date_rows.append([iso(d),d.year,d.month,d.day,d.isocalendar().week,d.strftime("%A"),int(d.weekday()>=5),version,SYNTHETIC_MARKER])
        d += timedelta(days=1)
    write_csv(curated/"dim_dates.csv",
              ["date","year","month","day","iso_week","day_name","is_weekend","dataset_version","synthetic_marker"], date_rows)

    # Unit dimensions + reusable lightweight lifecycle index
    unit_header = [
        "unit_external_id","unit_code","org_id","market_external_id","project_external_id","zone_external_id",
        "unit_type","area_sqm","bedrooms","floor_number","building_block","view_type","orientation",
        "initial_list_price","currency","launch_date","dataset_version","synthetic_marker"
    ]
    unit_path = curated/"dim_units.csv"
    unit_meta_path = out/"_unit_meta.csv"
    with unit_path.open("w",newline="",encoding="utf-8") as uf, unit_meta_path.open("w",newline="",encoding="utf-8") as mf:
        uw = csv.writer(uf); mw=csv.writer(mf)
        uw.writerow(unit_header)
        mw.writerow(["idx","project_idx","unit_in_project","unit_external_id","unit_code","market_external_id","project_external_id","zone_external_id",
                     "zone_name","unit_type","area_sqm","bedrooms","floor_number","building_block","view_type","orientation","base_price",
                     "launch_date","expected_handover_date","final_status","available_since","sold_at","reserved_from","held_from","unknown_from","sales_channel"])
        for idx in range(60000):
            pidx = idx // 5000
            unit_in_project = idx % 5000
            zlocal = unit_in_project // 200
            zone_tuple = zones[pidx*25 + zlocal]
            _,z,zid,zname,block_count = zone_tuple
            ur = random.Random(seed * 1000003 + idx)
            uid = deterministic_uuid(version,"unit",f"U{idx+1:06d}")
            ucode = f"MOCK-P{pidx+1:02d}-Z{z+1:02d}-U{unit_in_project%200+1:03d}"
            utype = UNIT_TYPES[(idx*7 + pidx) % len(UNIT_TYPES)]
            area, price = unit_area_and_price(utype, ur, idx)
            # curated null edge cases (valid missing values)
            area_out = "" if idx % 9973 == 0 else dec(area,6)
            base_price = price
            price_out = "" if idx % 12347 == 0 else dec(base_price)
            bedrooms = bedrooms_for(utype,idx)
            floor = 0 if utype in ("villa","townhouse","shophouse") else 1 + (idx % 45)
            block = f"Block-{1 + (unit_in_project % block_count):02d}"
            view = VIEW_TYPES[idx % len(VIEW_TYPES)]
            ori = ORIENTATIONS[(idx*3) % len(ORIENTATIONS)]
            launch = projects[pidx]["launch_date"]
            expected = projects[pidx]["expected_handover_date"]
            final_status = final_status_for(pidx, unit_in_project, idx)
            available_since = "" if idx % 1301 == 0 else launch + timedelta(days=(idx % 120))
            sold_at = None
            reserved_from = held_from = unknown_from = None
            if final_status == "sold":
                earliest = max(launch + timedelta(days=30), date(2023,2,1))
                span = max(1,(END_DATE-earliest).days)
                sold_at = earliest + timedelta(days=(idx*37) % span)
            elif final_status == "reserved":
                reserved_from = max(launch, END_DATE - timedelta(days=60 + (idx%180)))
            elif final_status == "held":
                held_from = max(launch, END_DATE - timedelta(days=90 + (idx%300)))
            elif final_status == "unknown":
                unknown_from = max(launch, END_DATE - timedelta(days=30 + (idx%400)))
            sales_channel = CHANNELS[idx % len(CHANNELS)]
            uw.writerow([uid,ucode,org_id,projects[pidx]["market_external_id"],projects[pidx]["project_external_id"],zid,
                         utype,area_out,bedrooms,floor,block,view,ori,price_out,CURRENCY,iso(launch),version,SYNTHETIC_MARKER])
            mw.writerow([idx,pidx,unit_in_project,uid,ucode,projects[pidx]["market_external_id"],projects[pidx]["project_external_id"],zid,
                         zname,utype,area_out,bedrooms,floor,block,view,ori,base_price,iso(launch),iso(expected),final_status,
                         iso(available_since) if available_since else "",iso(sold_at),iso(reserved_from),iso(held_from),iso(unknown_from),sales_channel])

    # Inventory snapshots: 600,000 rows + latest compatibility extract 60,000.
    invw = shard_writer(curated,"fact_inventory_snapshot",INV_HEADER,50000)
    compat_path = curated/"vda_unit_snapshots.csv"
    cf = compat_path.open("w",newline="",encoding="utf-8"); cw=csv.writer(cf); cw.writerow(INV_HEADER)
    status_counter = Counter()
    with unit_meta_path.open("r",encoding="utf-8",newline="") as mf:
        for m in csv.DictReader(mf):
            idx=int(m["idx"]); pidx=int(m["project_idx"])
            launch=date.fromisoformat(m["launch_date"]); expected=date.fromisoformat(m["expected_handover_date"])
            sold_at=date.fromisoformat(m["sold_at"]) if m["sold_at"] else None
            reserved_from=date.fromisoformat(m["reserved_from"]) if m["reserved_from"] else None
            held_from=date.fromisoformat(m["held_from"]) if m["held_from"] else None
            unknown_from=date.fromisoformat(m["unknown_from"]) if m["unknown_from"] else None
            available_since=date.fromisoformat(m["available_since"]) if m["available_since"] else None
            for sidx,snap in enumerate(SNAPSHOT_DATES):
                status=status_at_snapshot(m["final_status"],snap,launch,sold_at,reserved_from,held_from,unknown_from)
                status_counter[status]+=1
                snapshot_id=deterministic_uuid(version,"snapshot",f"{m['unit_external_id']}:{iso(snap)}")
                import_id=deterministic_uuid(version,"import",iso(snap))
                # deterministic price drift / trend by project; null preservation on selected units
                if idx % 12347 == 0:
                    list_price=""
                else:
                    trend = 1.0 + ((pidx%4)-1)*0.008*sidx
                    seasonal = 1.0 + 0.015*math.sin((sidx + pidx) * 1.6)
                    list_price = dec(int(float(m["base_price"])*trend*seasonal/1_000_000)*1_000_000)
                sold_out=iso(sold_at) if sold_at and sold_at <= snap else ""
                avail_out=iso(available_since) if available_since and available_since <= snap else ""
                hand=current_handover(snap,pidx,status,expected)
                row=[
                    org_id,snapshot_id,import_id,iso(snap),COUNTRY_CODE,m["market_external_id"],projects[pidx]["market_name"],
                    m["project_external_id"],projects[pidx]["project_name"],m["zone_external_id"],m["zone_name"],m["unit_external_id"],
                    m["unit_code"],m["unit_type"],m["area_sqm"],list_price,CURRENCY,status,avail_out,sold_out,m["bedrooms"],
                    m["floor_number"],m["building_block"],m["view_type"],m["orientation"],hand,m["sales_channel"],
                    "SYNTHETIC_GENERATOR",f"BATCH-{snap.strftime('%Y%m%d')}",version,SYNTHETIC_MARKER
                ]
                invw(row)
                if sidx == len(SNAPSHOT_DATES)-1:
                    cw.writerow(row)
    invw.close(); cf.close()

    # Transactions: exactly 180,000 with some units having 0 and some 6.
    txw = shard_writer(curated,"fact_transaction",TX_HEADER,50000)
    tx_count=0
    with unit_meta_path.open("r",encoding="utf-8",newline="") as mf:
        for m in csv.DictReader(mf):
            idx=int(m["idx"]); pidx=int(m["project_idx"]); launch=date.fromisoformat(m["launch_date"])
            sold_at=date.fromisoformat(m["sold_at"]) if m["sold_at"] else None
            mod=idx%10
            n=0 if mod==0 else (6 if mod==1 else 3)
            end = sold_at or END_DATE
            if end < launch: end = launch
            span=max(1,(end-launch).days+1)
            for j in range(n):
                tdate=launch+timedelta(days=min(span-1, ((idx*19+j*71) % span)))
                if m["final_status"]=="sold":
                    seq=["booking","reservation","deposit","sale_contract","payment","handover"]
                    ttype=seq[j % len(seq)]
                    tstatus="completed" if tdate <= END_DATE else "pending"
                elif m["final_status"]=="reserved":
                    seq=["booking","reservation","deposit","payment","reservation","payment"]
                    ttype=seq[j % len(seq)]
                    tstatus="confirmed" if j < n-1 else "pending"
                elif m["final_status"]=="held":
                    seq=["booking","reservation","cancellation","refund","booking","cancellation"]
                    ttype=seq[j % len(seq)]
                    tstatus={"cancellation":"cancelled","refund":"refunded"}.get(ttype,"completed")
                else:
                    seq=["booking","deposit","payment","booking","cancellation","refund"]
                    ttype=seq[j % len(seq)]
                    tstatus={"cancellation":"cancelled","refund":"refunded"}.get(ttype,"completed")
                base=int(m["base_price"])
                gross = max(10_000_000, int(base * ([0.02,0.05,0.1,1.0,0.2,0.63][j%6])))
                discount = int(gross * ((idx+j)%6) * 0.005)
                net=gross-discount
                cancel_reason = "customer_changed_plan" if ttype=="cancellation" else ("booking_expired" if tstatus=="expired" else "")
                txid=deterministic_uuid(version,"transaction",f"{m['unit_external_id']}:{j}")
                agent=deterministic_uuid(version,"agent",f"A{idx%350:03d}")
                txw([txid,org_id,m["unit_external_id"],m["project_external_id"],m["zone_external_id"],iso(tdate),ttype,tstatus,
                     CURRENCY,dec(gross),dec(discount),dec(net),PAYMENT_METHODS[(idx+j)%len(PAYMENT_METHODS)],
                     m["sales_channel"],CUSTOMER_SEGMENTS[(idx+j)%len(CUSTOMER_SEGMENTS)],agent,
                     CONTRACT_TYPES[j%len(CONTRACT_TYPES)],cancel_reason,version,SYNTHETIC_MARKER])
                tx_count+=1
    txw.close()

    # Price history: 270,000 rows (4 or 5 per unit).
    phw = shard_writer(curated,"fact_price_history",PRICE_HEADER,50000)
    ph_count=0
    with unit_meta_path.open("r",encoding="utf-8",newline="") as mf:
        for m in csv.DictReader(mf):
            idx=int(m["idx"]); launch=date.fromisoformat(m["launch_date"]); base=int(m["base_price"])
            n=5 if idx%2==0 else 4
            prev=None
            current=base
            for j in range(n):
                eff=launch+timedelta(days=min((END_DATE-launch).days, 30+j*180+(idx%45)))
                reason=CHANGE_REASONS[(idx+j)%len(CHANGE_REASONS)]
                if j==0:
                    new=current
                    change=""
                else:
                    delta=[0.03,0.05,-0.02,0.00,0.08,-0.05,0.015][(idx+j)%7]
                    if reason=="correction":
                        delta=-0.01 if idx%2 else 0.01
                    new=max(100_000_000,int(current*(1+delta)/1_000_000)*1_000_000)
                    change=dec((new-current)*100/current,6)
                phid=deterministic_uuid(version,"price_history",f"{m['unit_external_id']}:{j}")
                phw([phid,org_id,m["unit_external_id"],m["project_external_id"],iso(eff),dec(prev) if prev is not None else "",
                     dec(new),CURRENCY,change,reason,f"MOCK_APPROVER_{(idx+j)%25:02d}",version,SYNTHETIC_MARKER])
                prev=current=new
                ph_count+=1
    phw.close()

    # Reservations: 70,000 rows; project 12 intentionally has none.
    rw = shard_writer(curated,"fact_reservation",RES_HEADER,50000)
    res_count=0
    with unit_meta_path.open("r",encoding="utf-8",newline="") as mf:
        eligible_idx=0
        for m in csv.DictReader(mf):
            pidx=int(m["project_idx"])
            if pidx==11:
                continue
            idx=int(m["idx"]); launch=date.fromisoformat(m["launch_date"])
            sold_at=date.fromisoformat(m["sold_at"]) if m["sold_at"] else None
            n=2 if eligible_idx < 15000 else 1
            eligible_idx+=1
            upper=sold_at or END_DATE
            span=max(1,(upper-launch).days+1)
            for j in range(n):
                rdate=launch+timedelta(days=min(span-1, (idx*13+j*97)%span))
                expiry=min(END_DATE,rdate+timedelta(days=7+(idx+j)%35))
                if m["final_status"]=="sold":
                    status="converted" if sold_at and expiry <= sold_at else "active"
                else:
                    status=["active","expired","cancelled","refunded"][(idx+j)%4]
                if expiry < END_DATE and status=="active":
                    status="expired"
                dep=max(5_000_000,int(int(m["base_price"])*0.02/1_000_000)*1_000_000)
                rid=deterministic_uuid(version,"reservation",f"{m['unit_external_id']}:{j}")
                cancel_reason="customer_changed_plan" if status=="cancelled" else ("reservation_expired" if status=="expired" else "")
                rw([rid,org_id,m["unit_external_id"],m["project_external_id"],iso(rdate),iso(expiry),status,dec(dep),CURRENCY,
                    m["sales_channel"],CUSTOMER_SEGMENTS[(idx+j)%len(CUSTOMER_SEGMENTS)],cancel_reason,version,SYNTHETIC_MARKER])
                res_count+=1
    rw.close()

    # Raw synthetic extracts with deliberate errors for DQ testing.
    detected_at="2026-09-20T00:00:00Z"
    raw_inv_header=["source_row_number","unit_external_id","project_external_id","zone_external_id","snapshot_date","area_sqm","list_price","currency","status","sold_at","available_since","synthetic_marker"]
    raw_inv=[]
    for i in range(1,201):
        uid=deterministic_uuid(version,"unit",f"U{i:06d}")
        pidx=(i-1)//5000
        raw_inv.append([i,uid,projects[pidx]["project_external_id"],zones[pidx*25]["2"] if False else zones[pidx*25][2],"2026-09-20","65.000000","5500000000","VND","available","","2025-01-01",SYNTHETIC_MARKER])
    raw_inv += [
        [201,"not-a-uuid",projects[0]["project_external_id"],zones[0][2],"2026-09-20","70.000000","6000000000","VND","available","","2024-01-01",SYNTHETIC_MARKER],
        [202,deterministic_uuid(version,"unit","U000202"),projects[0]["project_external_id"],zones[0][2],"2026-13-40","70.000000","6000000000","VND","available","","2024-01-01",SYNTHETIC_MARKER],
        [203,deterministic_uuid(version,"unit","U000203"),projects[0]["project_external_id"],zones[0][2],"2026-09-20","70.000000","-1","VND","available","","2024-01-01",SYNTHETIC_MARKER],
        [204,deterministic_uuid(version,"unit","U000204"),projects[0]["project_external_id"],zones[0][2],"2026-09-20","0","6000000000","VND","available","","2024-01-01",SYNTHETIC_MARKER],
        [205,deterministic_uuid(version,"unit","U000205"),projects[0]["project_external_id"],zones[0][2],"2026-09-20","70.000000","6000000000","USD","available","","2024-01-01",SYNTHETIC_MARKER],
        [206,deterministic_uuid(version,"unit","U000206"),projects[0]["project_external_id"],zones[0][2],"2026-09-20","70.000000","6000000000","VND","BROKEN","","2024-01-01",SYNTHETIC_MARKER],
    ]
    write_csv(raw/"raw_inventory_records.csv",raw_inv_header,raw_inv)

    raw_tx_header=["source_row_number","transaction_id","unit_external_id","project_external_id","transaction_date","transaction_type","transaction_status","currency","gross_amount","synthetic_marker"]
    raw_tx=[]
    for i in range(1,101):
        raw_tx.append([i,deterministic_uuid(version,"rawtx",str(i)),deterministic_uuid(version,"unit",f"U{i:06d}"),
                       projects[0]["project_external_id"],"2026-01-15","payment","completed","VND","100000000",SYNTHETIC_MARKER])
    raw_tx += [
        [101,deterministic_uuid(version,"rawtx","bad-unit"),deterministic_uuid(version,"unit","U999999"),projects[0]["project_external_id"],"2026-01-15","payment","completed","VND","100000000",SYNTHETIC_MARKER],
        [102,deterministic_uuid(version,"rawtx","bad-cur"),deterministic_uuid(version,"unit","U000102"),projects[0]["project_external_id"],"2026-01-15","payment","completed","USD","100000000",SYNTHETIC_MARKER],
    ]
    write_csv(raw/"raw_transactions.csv",raw_tx_header,raw_tx)

    raw_price_header=["source_row_number","price_history_id","unit_external_id","project_external_id","effective_date","new_price","currency","synthetic_marker"]
    raw_price=[[1,deterministic_uuid(version,"rawph","missing-unit"),deterministic_uuid(version,"unit","U999998"),projects[0]["project_external_id"],"2026-01-01","7000000000","VND",SYNTHETIC_MARKER]]
    write_csv(raw/"raw_price_changes.csv",raw_price_header,raw_price)

    raw_res_header=["source_row_number","reservation_id","unit_external_id","project_external_id","reservation_date","expiry_date","status","currency","synthetic_marker"]
    raw_res=[[1,deterministic_uuid(version,"rawres","bad-lifecycle"),deterministic_uuid(version,"unit","U000001"),projects[0]["project_external_id"],"2026-08-01","2026-07-01","cancelled","VND",SYNTHETIC_MARKER]]
    write_csv(raw/"raw_reservations.csv",raw_res_header,raw_res)

    # Quarantine examples. Each file is self-describing and has the required envelope.
    qspec = {
        "invalid_dates.csv": [
            ("raw_inventory_records.csv",202,"invalid_date","snapshot_date is not a valid ISO date",raw_inv[-5]),
            ("raw_reservations.csv",1,"invalid_date_range","expiry_date precedes reservation_date",raw_res[0]),
        ],
        "invalid_status.csv": [
            ("raw_inventory_records.csv",206,"invalid_status","inventory status is outside allowed domain",raw_inv[-1]),
            ("raw_transactions.csv",99,"invalid_status","example invalid transaction status isolated during raw validation",{"transaction_status":"BROKEN"}),
        ],
        "invalid_currency.csv": [
            ("raw_inventory_records.csv",205,"invalid_currency","currency must equal VND",raw_inv[-2]),
            ("raw_transactions.csv",102,"invalid_currency","currency must equal VND",raw_tx[-1]),
        ],
        "invalid_prices.csv": [
            ("raw_inventory_records.csv",203,"invalid_price","list_price must be non-negative when present",raw_inv[-4]),
            ("raw_price_changes.csv",2,"invalid_price","new_price must be positive",{"new_price":"-500000000"}),
        ],
        "invalid_area.csv": [
            ("raw_inventory_records.csv",204,"invalid_area","area_sqm must be > 0 when present",raw_inv[-3]),
            ("raw_inventory_records.csv",210,"invalid_area","area_sqm is not numeric",{"area_sqm":"N/A"}),
        ],
        "duplicate_records.csv": [
            ("raw_inventory_records.csv",220,"duplicate_business_key","duplicate unit_external_id + snapshot_date",{"unit_external_id":deterministic_uuid(version,"unit","U000010"),"snapshot_date":"2026-09-20"}),
            ("raw_inventory_records.csv",221,"duplicate_business_key","duplicate unit_external_id + snapshot_date",{"unit_external_id":deterministic_uuid(version,"unit","U000010"),"snapshot_date":"2026-09-20"}),
        ],
        "missing_dimensions.csv": [
            ("raw_transactions.csv",101,"missing_unit","transaction references a unit that does not exist",raw_tx[-2]),
            ("raw_price_changes.csv",1,"missing_unit","price history references a unit that does not exist",raw_price[0]),
            ("raw_inventory_records.csv",230,"missing_project","project_external_id not found",{"project_external_id":deterministic_uuid(version,"project","MISSING")}),
            ("raw_inventory_records.csv",231,"missing_zone","zone_external_id not found",{"zone_external_id":deterministic_uuid(version,"zone","MISSING")}),
        ],
        "inconsistent_lifecycle.csv": [
            ("raw_inventory_records.csv",240,"inconsistent_lifecycle","sold_at precedes available_since",{"available_since":"2026-06-01","sold_at":"2026-05-01"}),
            ("raw_reservations.csv",1,"inconsistent_lifecycle","reservation lifecycle dates are inconsistent",raw_res[0]),
        ],
    }
    for fname, items in qspec.items():
        rows=[]
        for src,rownum,etype,msg,original in items:
            rows.append([src,rownum,etype,msg,json.dumps(original,ensure_ascii=False,separators=(",",":")),detected_at,version])
        write_csv(quarantine/fname,QUAR_HEADER,rows)

    # Data dictionary
    dd_rows=[]
    def add_dict(table, header, grain, notes=""):
        for c in header:
            dd_rows.append([table,c,"string","yes" if c in {"area_sqm","list_price","available_since","sold_at","bedrooms","previous_price","change_percent","cancellation_reason"} else "no",grain,notes])
    add_dict("fact_inventory_snapshot",INV_HEADER,"one unit per snapshot_date","decimal values are serialized as plain numeric strings")
    add_dict("fact_transaction",TX_HEADER,"one synthetic transaction event")
    add_dict("fact_price_history",PRICE_HEADER,"one unit price change event")
    add_dict("fact_reservation",RES_HEADER,"one reservation lifecycle record")
    write_csv(out/"data_dictionary.csv",["table","column","storage_type","nullable","grain","notes"],dd_rows)

    # Counts for manifest
    file_counts={}
    for root in [curated,raw,quarantine]:
        for p in sorted(root.glob("*.csv")):
            with p.open("r",encoding="utf-8",newline="") as f:
                count=sum(1 for _ in f)-1
            file_counts[str(p.relative_to(out))]=count
    total_curated=sum(v for k,v in file_counts.items() if k.startswith("curated/"))
    manifest={
        "dataset_name":ORG_NAME,
        "description":"Fully synthetic real-estate analytics warehouse for VDaAgent demo/testing only.",
        "synthetic_warning":"MOCK_ONLY. Not real Vinhomes operational, customer, transaction, or market-price data.",
        "seed":seed,"dataset_version":version,"country_code":COUNTRY_CODE,"currency":CURRENCY,
        "generated_through":iso(END_DATE),
        "row_counts":file_counts,
        "totals":{
            "curated_rows_including_compatibility_extract":total_curated,
            "fact_inventory_snapshot":600000,
            "fact_transaction":tx_count,
            "fact_price_history":ph_count,
            "fact_reservation":res_count,
            "dim_units":60000,
            "zones":300,"projects":12,"markets":5
        },
        "snapshot_dates":[iso(x) for x in SNAPSHOT_DATES],
        "sharding":{"target_rows_per_large_csv":50000},
        "synthetic_marker":SYNTHETIC_MARKER
    }
    (out/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")

    # README
    readme=f"""# VDaAgent — Vinhomes Synthetic Demo

> **SYNTHETIC / MOCK ONLY**  
> This dataset is entirely generated for demo, QA, analytics, lineage, governance and warehouse testing.  
> It does **not** contain internal Vinhomes data, real customer data, real transaction prices, or claims about actual Vinhomes operations.

## Reproducibility

- Seed: `{seed}`
- Dataset version: `{version}`
- Country: `VN`
- Currency: `VND`
- Required marker: `{SYNTHETIC_MARKER}`
- Deterministic UUIDs: UUIDv5 derived from stable business keys + dataset version.

Run:

```bash
python generate_mock_data.py --seed {seed} --version {version}
python validate_mock_data.py
```

## Scale

- 1 organization
- 5 Vietnam market/city groups
- 12 synthetic projects
- 300 zones
- 60,000 units
- 10 unit snapshots each
- 600,000 inventory snapshot rows
- {tx_count:,} transaction rows
- {ph_count:,} price-history rows
- {res_count:,} reservation rows
- `vda_unit_snapshots.csv`: 60,000-row compatibility extract for the latest snapshot (2026-09-20)

Large facts are split into ~50,000-row CSV shards.

## Folder layout

- `curated/`: valid dimensions and facts only.
- `raw/`: raw synthetic examples, including intentionally malformed records.
- `quarantine/`: rejected examples with source row, error type/message, original record, detection timestamp and dataset version.
- `manifest.json`: row counts, scale and generation metadata.
- `data_dictionary.csv`: column-level data dictionary.
- `validation_report.json`: generated by the validator.
- `checksums.sha256`: deterministic SHA-256 checksums for generated source/data files.

## Core table mapping

`dim_organizations` → `dim_markets` → `dim_projects` → `dim_zones` → `dim_units`

Facts reference the stable unit/project/zone keys:

- `fact_inventory_snapshot_*`
- `fact_transaction_*`
- `fact_price_history_*`
- `fact_reservation_*`

`vda_unit_snapshots.csv` follows the same schema as inventory snapshot facts and contains the latest snapshot only.

## Import order

1. `dim_organizations.csv`
2. `dim_markets.csv`
3. `dim_projects.csv`
4. `dim_zones.csv`
5. `dim_units.csv`
6. `dim_dates.csv`
7. `fact_inventory_snapshot_*.csv`
8. `fact_transaction_*.csv`
9. `fact_price_history_*.csv`
10. `fact_reservation_*.csv`

## Edge cases intentionally represented in curated data

Null area/list price/available date/sold date/bedrooms; units with no transactions; units with multiple transactions and price changes; a project with no reservations; high-sold and high-available projects; a project with zero final available inventory; price corrections; expired/cancelled/refunded lifecycle records; area/price outliers; project-specific growth/decline/flat price patterns; delayed handover values; and snapshot/state transitions.

## Data quality / quarantine

The raw area intentionally includes examples such as invalid dates, negative price, zero area, invalid currency/status, bad UUID, missing dimensions, and inconsistent lifecycle dates. These records are isolated in `quarantine/` and are not present in curated facts.

## Decimal representation

Money and decimal-like values are written as plain numeric strings (for example `3500000000` and `125.500000`) without currency symbols or thousands separators.

## Validation

`validate_mock_data.py` checks row totals, shard sizes, UUIDs, duplicate business keys, FK consistency, date/numeric rules, status/project/city/null distributions, fact totals, snapshot coverage, curated markers/currency, quarantine counts and file checksums.

## ZIP

After validation, package this directory as:

`vda_vinhomes_mock_{version}.zip`

## Future Codex / upload workflow

This package deliberately contains no credentials and performs no upload. A later automation can:
1. unzip,
2. validate,
3. read `manifest.json`,
4. import dimensions in the order above,
5. import fact shards,
6. compare post-load row counts to the manifest.

Do not place database URLs, service-role keys, access tokens or other secrets into this package.
"""
    (out/"README.md").write_text(readme,encoding="utf-8")

    # Remove internal generation helper before checksums/package.
    unit_meta_path.unlink()

    # Checksums (exclude mutable validation report and checksum file itself).
    checksum_targets=[]
    for p in sorted(out.rglob("*")):
        if p.is_file() and p.name not in {"checksums.sha256","validation_report.json"}:
            checksum_targets.append(p)
    lines=[]
    for p in checksum_targets:
        h=hashlib.sha256()
        with p.open("rb") as f:
            for chunk in iter(lambda:f.read(1024*1024),b""):
                h.update(chunk)
        lines.append(f"{h.hexdigest()}  {p.relative_to(out).as_posix()}")
    (out/"checksums.sha256").write_text("\n".join(lines)+"\n",encoding="utf-8")

    print(json.dumps(manifest["totals"], ensure_ascii=False, indent=2))

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--seed",type=int,default=DEFAULT_SEED)
    ap.add_argument("--version",default=DEFAULT_VERSION)
    ap.add_argument("--out",default=str(Path(__file__).resolve().parent))
    args=ap.parse_args()
    generate(Path(args.out),args.seed,args.version)

if __name__=="__main__":
    main()
