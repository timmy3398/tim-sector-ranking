#!/usr/bin/env python3
"""Refresh stale mapped quotes with upstream twstock, only when target-day data exists."""
import argparse
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
import twstock
from twstock import Stock, codes

ROOT = Path(__file__).resolve().parents[1]
LOW_BASE = ROOT / "public" / "low-base.json"
MAPPING = ROOT / "public" / "mapping.json"
HISTORY = ROOT / "public" / "rank-history.json"
MARKET_TZ = ZoneInfo("Asia/Taipei")

# twstock's upstream README documents a TWSE limit of 3 requests per 5 seconds.
# Also apply a timeout because twstock's built-in requests do not set one.
_original_request = requests.sessions.Session.request
def _request_with_timeout(self, method, url, **kwargs):
    kwargs.setdefault("timeout", 25)
    return _original_request(self, method, url, **kwargs)
requests.sessions.Session.request = _request_with_timeout


def fetch_one(code, target):
    try:
        info = codes.get(code)
        stock = Stock(code, initial_fetch=False)
        rows = stock.fetch(target.year, target.month)
        row = next((r for r in reversed(rows) if r.date.date() == target), None)
        if row is None or row.close is None or row.close <= 0:
            return code, None, "target-date-not-found"
        turnover = row.turnover
        if turnover is None or turnover <= 0:
            return code, None, "no-positive-turnover"
        market = "otc" if getattr(info, "data_source", "") == "tpex" else "tse"
        quote = {
            "name": getattr(info, "name", code) or code,
            "close": row.close,
            "change": row.change,
            "value": turnover,
            "volume": row.capacity,
            "date": target.strftime("%Y%m%d"),
            "market": market,
            "source": "twstock 官方個股日行情",
        }
        return code, quote, "ok"
    except Exception as exc:
        return code, None, f"error: {type(exc).__name__}: {exc}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="fetch and report without writing low-base.json")
    parser.add_argument("--codes", default="", help="optional comma-separated codes to test")
    args = parser.parse_args()

    history = json.loads(HISTORY.read_text(encoding="utf-8"))
    target_text = str(history.get("latestDate") or "")
    if len(target_text) != 8 or not target_text.isdigit():
        raise SystemExit(f"Invalid latestDate in rank-history.json: {target_text!r}")
    target = datetime.strptime(target_text, "%Y%m%d").date()

    mapping = json.loads(MAPPING.read_text(encoding="utf-8"))
    mapped = sorted({str(c) for group in mapping.values() for c in group if str(c).isdigit() and len(str(c)) == 4})
    data = json.loads(LOW_BASE.read_text(encoding="utf-8"))
    stocks = data.setdefault("stocks", {})

    if args.codes.strip():
        candidates = sorted({c.strip() for c in args.codes.split(",") if c.strip().isdigit() and len(c.strip()) == 4})
    else:
        candidates = mapped
    stale = [c for c in candidates if str((stocks.get(c) or {}).get("date") or "") < target_text]
    print(f"twstock target={target_text}; mapped={len(mapped)}; candidates={len(candidates)}; stale_to_fetch={len(stale)}; dry_run={args.dry_run}")

    updated = 0
    failed = 0
    # Batches of three with a pause between batches respect the upstream documented rate limit.
    for start in range(0, len(stale), 3):
        batch = stale[start:start + 3]
        with ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(lambda c: fetch_one(c, target), batch))
        for code, quote, status in results:
            if quote:
                updated += 1
                if not args.dry_run:
                    old = stocks.get(code, {})
                    stocks[code] = {**old, **quote}
                print(json.dumps({"code": code, **quote, "status": status}, ensure_ascii=False))
            else:
                failed += 1
                print(json.dumps({"code": code, "status": status}, ensure_ascii=False))
        if start + 3 < len(stale):
            time.sleep(5.2)

    print(f"twstock result: updated={updated}; failed_or_unavailable={failed}; target={target_text}; dry_run={args.dry_run}")
    if not args.dry_run and updated:
        data["generatedAt"] = datetime.now(MARKET_TZ).isoformat()
        data["dataDate"] = target_text
        data["source"] = "TWSE/TPEx official daily close snapshot + twstock official per-stock fallback"
        LOW_BASE.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
