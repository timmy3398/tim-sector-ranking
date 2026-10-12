#!/usr/bin/env python3
"""Probe twstock's daily historical data for the four stocks currently missing names/changes."""
import json
import os
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from twstock import Stock, codes

CODES = ["5309", "3211", "4931", "6121"]
TARGET_DATE = os.getenv("TARGET_DATE", "").strip()
if not TARGET_DATE:
    TARGET_DATE = datetime.now(ZoneInfo("Asia/Taipei")).strftime("%Y%m%d")


def main():
    target = datetime.strptime(TARGET_DATE, "%Y%m%d").date()
    results = []
    for index, code in enumerate(CODES):
        if index:
            # twstock documents TWSE's request limit as 3 requests per 5 seconds.
            time.sleep(2.1)
        item = {"code": code, "name": getattr(codes.get(code), "name", code), "target_date": TARGET_DATE}
        try:
            stock = Stock(code, initial_fetch=False)
            rows = stock.fetch(target.year, target.month)
            matches = [row for row in rows if row.date.date() == target]
            latest = max(rows, key=lambda row: row.date) if rows else None
            item["latest_date"] = latest.date.strftime("%Y%m%d") if latest else None
            item["latest_close"] = latest.close if latest else None
            item["latest_turnover"] = latest.turnover if latest else None
            item["target_date_found"] = bool(matches)
            if matches:
                row = matches[-1]
                item["target_close"] = row.close
                item["target_turnover"] = row.turnover
                item["target_volume_shares"] = row.capacity
                item["target_change"] = row.change
            item["status"] = "ok" if matches else "target-date-not-found"
        except Exception as exc:
            item["status"] = "error"
            item["error"] = f"{type(exc).__name__}: {exc}"
        results.append(item)
        print(json.dumps(item, ensure_ascii=False))
    found = sum(bool(x.get("target_date_found")) for x in results)
    print(f"\nRESULT: {found}/{len(CODES)} stocks have data for {TARGET_DATE}.")
    # This is a diagnostic probe: report unavailable data without breaking the production snapshot.


if __name__ == "__main__":
    main()
