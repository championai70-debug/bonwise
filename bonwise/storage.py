"""Server-side storage (SQLite, part of Python's standard library).

Two things live here:
- Households: a shared copy of receipts, shopping list, savings plan and budget, so
  several phones (a couple, flatmates, a new phone) see the same data. A household is
  found by a random code; only a SHA-256 hash of the code is stored.
- Community prices: anonymous price reports (product, shop chain, price, day) taken
  from receipts people add, so everyone sees where the same product was cheaper.
  No user or household id is stored with a price.

Every phone keeps its own full copy, so if the server's database is ever lost (for
example on a free host without a persistent disk) the next sync fills it again.
"""

import hashlib
import json
import re
import secrets
import sqlite3
import threading
import time
from pathlib import Path

from . import config, data
from .textutil import norm

_lock = threading.Lock()
_conn = None

MAX_HOUSEHOLD_BYTES = 1_500_000
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I


def _db():
    global _conn
    if _conn is None:
        path = _writable_dir()
        _conn = sqlite3.connect(str(path / "bonwise.db"), check_same_thread=False, timeout=10)
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.executescript("""
            CREATE TABLE IF NOT EXISTS households (
                id TEXT PRIMARY KEY, data TEXT NOT NULL, updated REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS prices (
                id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, name TEXT NOT NULL,
                chain TEXT NOT NULL, price REAL NOT NULL, day TEXT NOT NULL, created REAL NOT NULL);
            CREATE INDEX IF NOT EXISTS prices_key ON prices(key);
        """)
        _conn.commit()
    return _conn


def _writable_dir():
    """DATA_DIR if we can write there, otherwise a local folder (and say so in the log)."""
    for candidate in (config.DATA_DIR, str(config.ROOT / "data"), "/tmp/bonwise-data"):
        try:
            p = Path(candidate)
            p.mkdir(parents=True, exist_ok=True)
            probe = p / ".write-test"
            probe.write_text("ok")
            probe.unlink()
            if candidate != config.DATA_DIR:
                print("DATA_DIR %s isn't writable; using %s instead" % (config.DATA_DIR, candidate), flush=True)
            return p
        except OSError:
            continue
    raise OSError("no writable folder for the database")


def reset_for_tests(path):
    """Point storage at a fresh folder (used by the tests)."""
    global _conn
    with _lock:
        if _conn is not None:
            _conn.close()
        _conn = None
        config.DATA_DIR = str(path)


# ---------- households ----------

class HouseholdError(Exception):
    def __init__(self, code, message, status=400):
        super().__init__(code)
        self.code, self.message, self.status = code, message, status


def _hash(code):
    return hashlib.sha256(normalize_code(code).encode()).hexdigest()


def normalize_code(code):
    c = re.sub(r"[^A-Z0-9]", "", str(code or "").upper())
    if c.startswith("BW"):
        c = c[2:]
    return c


def pretty_code(raw):
    return "BW-" + "-".join(raw[i:i + 4] for i in range(0, len(raw), 4))


def new_household():
    raw = "".join(secrets.choice(CODE_ALPHABET) for _ in range(12))
    with _lock:
        db = _db()
        db.execute("INSERT INTO households(id, data, updated) VALUES (?, ?, ?)",
                   (_hash(raw), json.dumps(_empty_state()), time.time()))
        db.commit()
    return pretty_code(raw)


def _empty_state():
    return {"receipts": {}, "plan": {}, "list": {}, "budget": None}


def _newer(a, b):
    """Pick the record changed last (records carry an 'updated' timestamp in ms)."""
    if not isinstance(a, dict):
        return b
    if not isinstance(b, dict):
        return a
    return b if (b.get("updated") or 0) > (a.get("updated") or 0) else a


def merge_states(server, client):
    out = _empty_state()
    for part in ("receipts", "plan", "list"):
        s, c = server.get(part) or {}, client.get(part) or {}
        if not isinstance(s, dict):
            s = {}
        if not isinstance(c, dict):
            c = {}
        merged = {}
        for key in set(s) | set(c):
            merged[str(key)[:80]] = _newer(s.get(key), c.get(key))
        out[part] = merged
    out["budget"] = _newer(server.get("budget"), client.get("budget"))
    return out


def sync_household(code, client_state, create=False):
    """Merge a phone's data into the household and return the merged data.
    create=True is used by phones that are already members: if the server lost the
    household (e.g. after a restart without a persistent disk), it is set up again."""
    if len(normalize_code(code)) != 12:
        raise HouseholdError("bad_code", "That household code isn't complete. It looks like BW-XXXX-XXXX-XXXX.")
    if not isinstance(client_state, dict):
        client_state = {}
    hid = _hash(code)
    with _lock:
        db = _db()
        row = db.execute("SELECT data FROM households WHERE id = ?", (hid,)).fetchone()
        if row is None and not create:
            raise HouseholdError("unknown_code", "No household with that code. Check the code, or create a new one.", 404)
        if row is None:
            db.execute("INSERT INTO households(id, data, updated) VALUES (?, ?, ?)", (hid, json.dumps(_empty_state()), time.time()))
        merged = merge_states(json.loads(row[0]) if row else _empty_state(), client_state)
        blob = json.dumps(merged, ensure_ascii=False, separators=(",", ":"))
        if len(blob.encode()) > MAX_HOUSEHOLD_BYTES:
            raise HouseholdError("too_large", "This household has too much data to sync. Delete some old receipts.", 413)
        db.execute("UPDATE households SET data = ?, updated = ? WHERE id = ?", (blob, time.time(), hid))
        db.commit()
    return merged


def delete_household(code):
    """Delete the shared copy on the server (the phones keep their own data)."""
    with _lock:
        db = _db()
        cur = db.execute("DELETE FROM households WHERE id = ?", (_hash(code),))
        db.commit()
    return cur.rowcount > 0


# ---------- community prices ----------

CHAIN_NAMES = {"budnikowsky": "BUDNI", "muller": "MUELLER", "hol ab": "HOL AB"}


def chain_of(store):
    """'REWE Markt GmbH Berlin' -> 'REWE'. Unknown shops return ''."""
    n = " " + norm(store) + " "
    for s in data.STORES:
        if re.search(r"\b" + re.escape(s) + r"\b", n):
            return "dm" if s.startswith("dm") else CHAIN_NAMES.get(s, s.upper())
    return ""


def price_key(name):
    """Comparable key for a product across shops: the plain-English name with pack size."""
    k = norm(name)
    k = re.sub(r"(\d),(\d)", r"\1.\2", k)
    k = re.sub(r"\b(litre|liter|ltr)\b", "l", k)
    k = re.sub(r"\b(gramm|gram|grams|gr)\b", "g", k)
    k = re.sub(r"(\d)\s*(kg|g|ml|cl|l|er|pcs|st)\b", r"\1 \2", k)
    k = re.sub(r"\b(the|a|an|pack|of)\b", " ", k)
    return re.sub(r"\s+", " ", k).strip()[:80]


def report_prices(store, day, items):
    """Store anonymous price observations. Returns how many were kept."""
    chain = chain_of(store)
    if not chain:
        return 0
    day = day if re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(day or "")) else time.strftime("%Y-%m-%d")
    rows = []
    for it in (items or [])[:120]:
        if not isinstance(it, dict) or it.get("pfand"):
            continue
        name = str(it.get("en") or "").strip()[:80]
        try:
            price = round(float(it.get("price")), 2)
        except (TypeError, ValueError):
            continue
        if not name or not (0.05 <= price <= 2000):
            continue
        key = price_key(name)
        if len(key) < 3:
            continue
        rows.append((key, name, chain, price, day, time.time()))
    if rows:
        with _lock:
            db = _db()
            db.executemany("INSERT INTO prices(key, name, chain, price, day, created) VALUES (?,?,?,?,?,?)", rows)
            db.commit()
    return len(rows)


def best_prices(keys, days=90):
    """Cheapest recent community price per key: {key: {price, chain, day, reports}}."""
    keys = [k for k in {price_key(k) for k in keys} if k][:200]
    if not keys:
        return {}
    since = time.strftime("%Y-%m-%d", time.localtime(time.time() - days * 86400))
    out = {}
    with _lock:
        db = _db()
        for i in range(0, len(keys), 50):
            chunk = keys[i:i + 50]
            q = ("SELECT key, chain, MIN(price), MAX(day), COUNT(*) FROM prices WHERE day >= ? AND key IN (%s) "
                 "GROUP BY key, chain" % ",".join("?" * len(chunk)))
            for key, chain, price, day, n in db.execute(q, [since] + chunk):
                entry = out.setdefault(key, {"price": None, "chain": "", "day": "", "reports": 0, "byChain": {}})
                entry["byChain"][chain] = price
                entry["reports"] += n
                if entry["price"] is None or price < entry["price"]:
                    entry.update(price=price, chain=chain, day=day)
    return out
