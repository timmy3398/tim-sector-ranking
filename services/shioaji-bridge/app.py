import asyncio
import logging
import os
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import requests
import shioaji as sj
from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.responses import JSONResponse

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
log = logging.getLogger("shioaji-bridge")
MAPPING_URL = os.getenv("MAPPING_URL", "https://raw.githubusercontent.com/timmy3398/tim-sector-ranking/main/public/mapping.json")
API_KEY = os.getenv("SHIOAJI_API_KEY", "")
SECRET_KEY = os.getenv("SHIOAJI_SECRET_KEY", "")
PROXY_TOKEN = os.getenv("SHIOAJI_PROXY_TOKEN", "")
MAPPING_REFRESH_SECONDS = max(300, int(os.getenv("MAPPING_REFRESH_SECONDS", "21600")))
api = None
quotes = {}
lock = threading.Lock()
subscribed = set()
last_error = None
started_at = time.time()

def stock_codes():
    try:
        response = requests.get(MAPPING_URL, timeout=10)
        response.raise_for_status()
        mapping = response.json()
        return {str(c).strip() for group in mapping.values() for c in group
                if str(c).strip().isdigit() and len(str(c).strip()) == 4}
    except Exception:
        log.exception("Could not load mapping")
        return set()

def contract_for(code):
    try:
        return api.Contracts.Stocks[code] if api is not None else None
    except Exception:
        return None

def on_tick(exchange, tick):
    code = str(getattr(tick, "code", "") or "")
    if len(code) != 4 or not code.isdigit():
        return
    try:
        price = float(tick.close)
    except (TypeError, ValueError, AttributeError):
        return
    if price <= 0:
        return
    def num(key):
        try:
            value = getattr(tick, key, None)
            return float(value) if value is not None else None
        except (TypeError, ValueError):
            return None
    contract = contract_for(code)
    change_pct = num("price_chg_pct")
    change_amount = None
    if change_pct is not None and change_pct > -100:
        try:
            change_amount = price - (price / (1 + change_pct / 100))
        except ZeroDivisionError:
            change_amount = None
    row = {
        "code": code, "name": getattr(contract, "name", code),
        "close": price, "change": change_amount, "changePct": change_pct,
        "volume": num("total_volume"), "value": num("total_amount"),
        "date": datetime.now().astimezone().strftime("%Y%m%d"),
        "time": str(getattr(tick, "datetime", "") or ""),
        "source": "Shioaji即時", "market": "tw"
    }
    with lock:
        old = quotes.get(code, {})
        for key in ("change", "changePct", "volume", "value"):
            if row[key] is None:
                row[key] = old.get(key)
        quotes[code] = row

def subscribe_codes(codes):
    if api is None:
        return
    for code in sorted(codes - subscribed):
        contract = contract_for(code)
        if contract is None:
            continue
        try:
            api.quote.subscribe(contract, quote_type=sj.constant.QuoteType.Tick,
                                version=sj.constant.QuoteVersion.v1)
            subscribed.add(code)
        except Exception:
            log.exception("Subscribe failed for %s", code)

def connect():
    global api, last_error
    if not API_KEY or not SECRET_KEY:
        last_error = "Missing SHIOAJI_API_KEY / SHIOAJI_SECRET_KEY"
        log.warning(last_error)
        return
    try:
        api = sj.Shioaji()
        api.login(api_key=API_KEY, secret_key=SECRET_KEY)
        api.quote.set_on_tick_stk_v1_callback(on_tick)
        subscribe_codes(stock_codes())
        last_error = None
        log.info("Shioaji connected; quote-only callbacks enabled")
    except Exception as exc:
        last_error = type(exc).__name__
        log.exception("Shioaji connection failed")
        api = None

async def mapping_loop():
    while True:
        if api is not None:
            subscribe_codes(stock_codes())
        await asyncio.sleep(MAPPING_REFRESH_SECONDS)

@asynccontextmanager
async def lifespan(app):
    threading.Thread(target=connect, daemon=True).start()
    task = asyncio.create_task(mapping_loop())
    yield
    task.cancel()
    try:
        if api is not None:
            api.logout()
    except Exception:
        log.exception("Logout failed")

app = FastAPI(title="Read-only Shioaji Quote Bridge", docs_url=None, redoc_url=None, lifespan=lifespan)

def authorize(value):
    if not PROXY_TOKEN:
        raise HTTPException(status_code=503, detail="Bridge token is not configured")
    if value != "Bearer " + PROXY_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")

@app.get("/health")
def health():
    with lock:
        count = len(quotes)
    return {"ok": True, "connected": api is not None, "quote_count": count,
            "subscribed_count": len(subscribed), "last_error": last_error,
            "uptime_seconds": int(time.time() - started_at)}

@app.get("/v1/quotes")
def get_quotes(codes: str = Query(default="", max_length=12000),
               authorization: str | None = Header(default=None)):
    authorize(authorization)
    requested = {c for c in codes.split(",") if len(c) == 4 and c.isdigit()}
    if len(requested) > 600:
        raise HTTPException(status_code=400, detail="Too many codes")
    with lock:
        data = {c: quotes[c] for c in requested if c in quotes}
    return JSONResponse({"ok": True, "updated": datetime.now(timezone.utc).isoformat(), "quotes": data})

@app.get("/")
def root():
    return {"service": "read-only-shioaji-quote-bridge", "health": "/health"}
