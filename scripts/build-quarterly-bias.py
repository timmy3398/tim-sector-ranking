#!/usr/bin/env python3
"""Refresh 60-trading-day moving-average bias for stocks in public/mapping.json."""
import json
import os
import time
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
from FinMind.data import DataLoader

ROOT = Path(__file__).resolve().parents[1]
MAPPING = ROOT / "public" / "mapping.json"
OUTPUT = ROOT / "public" / "quarterly-bias.json"


def main():
    mapping = json.loads(MAPPING.read_text(encoding="utf-8"))
    codes = sorted({str(code) for group in mapping.values() for code in group
                    if str(code).isdigit() and len(str(code)) == 4})
    previous = {}
    if OUTPUT.exists():
        try:
            previous = json.loads(OUTPUT.read_text(encoding="utf-8")).get("stocks", {})
        except Exception:
            previous = {}

    api = DataLoader()
    token = os.getenv("FINMIND_TOKEN", "").strip()
    if token:
        api.login_by_token(api_token=token)

    # 120 calendar days normally cover at least 60 trading sessions, including holidays.
    start_date = (date.today() - timedelta(days=120)).isoformat()
    results = dict(previous)
    updated = 0
    failed = []
    for index, code in enumerate(codes, 1):
        try:
            df = api.taiwan_stock_daily(stock_id=code, start_date=start_date)
            if df is None or df.empty or "close" not in df.columns:
                raise ValueError("FinMind returned no close-price history")
            df = df[["date", "close"]].copy()
            df["close"] = pd.to_numeric(df["close"], errors="coerce")
            df = df.dropna(subset=["close"]).sort_values("date").drop_duplicates("date")
            df = df[df["close"] > 0]
            if len(df) < 60:
                raise ValueError(f"only {len(df)} valid closes; need 60")
            close = float(df["close"].iloc[-1])
            ma60 = float(df["close"].tail(60).mean())
            if ma60 <= 0:
                raise ValueError("invalid 60-day moving average")
            latest_date = str(df["date"].iloc[-1]).replace("-", "")[:8]
            results[code] = {
                "bias60": (close / ma60 - 1) * 100,
                "ma60": ma60,
                "close": close,
                "date": latest_date,
                "source": "FinMind TaiwanStockPrice"
            }
            updated += 1
        except Exception as exc:
            failed.append((code, str(exc)))
            print(f"[WARN] {code}: {exc}")
        if index % 25 == 0:
            print(f"progress {index}/{len(codes)}; updated={updated}; failed={len(failed)}")
        # Stay comfortably below the unauthenticated request rate; token can be supplied
        # as the GitHub Actions secret FINMIND_TOKEN for the account's higher limit.
        time.sleep(0.35)

    if updated == 0:
        raise RuntimeError("FinMind returned no usable quarterly-bias data; keeping previous output")
    payload = {
        "generatedAt": date.today().isoformat(),
        "source": "FinMind TaiwanStockPrice; 60-trading-day simple moving average",
        "stocks": results,
        "stats": {"mapped": len(codes), "updated": updated, "failed": len(failed)}
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"quarterly bias complete: mapped={len(codes)} updated={updated} failed={len(failed)}")


if __name__ == "__main__":
    main()
