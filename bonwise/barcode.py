"""Barcode check: a product's barcode (EAN-13/EAN-8/UPC-A, read by the phone's camera or
typed) -> its name, so the app can run the normal price search for it.

The name comes from the Open Prices data first. For barcodes that aren't in it, the server
asks Open Food Facts (free, open data, ODbL) for the product's name; only the barcode
number is sent, never anything about the user. Answers are kept in memory for a day.
"""
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import OrderedDict

from . import config, openprices

_cache, _lock = OrderedDict(), threading.Lock()
CACHE_SIZE, CACHE_SECONDS = 1000, 86400
UA = "Bonwise/1.0 (receipt savings app; https://bonwise.onrender.com)"


def normalise(raw):
    """Digits of a valid EAN-13, EAN-8 or UPC-A barcode as EAN (13 or 8 digits), else None."""
    code = re.sub(r"[\s-]", "", str(raw or ""))
    if not code.isdigit():
        return None
    if len(code) == 12:                 # UPC-A is EAN-13 with a leading zero
        code = "0" + code
    elif len(code) == 14 and code[0] == "0":
        code = code[1:]
    if len(code) not in (8, 13):
        return None
    digits = [int(c) for c in code]
    total = sum(d * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(digits[:-1])))
    return code if (10 - total % 10) % 10 == digits[-1] else None


def search_text(name, size=""):
    """The product as a search: name and pack size, without commas that would split it
    into a list (decimal commas like "1,5 l" stay)."""
    name = name or ""
    has_size = re.search(r"\d+([.,]\d+)?\s*(g|kg|ml|l|cl|x|er|st|stk)\b", name, re.I)
    text = re.sub(r",(?!\d)|(?<!\d),", " ", name + (" " + size if size and not has_size else ""))
    return re.sub(r"\s+", " ", text).strip()[:120]


def _off(code):
    """{"name", "brand", "size"} from Open Food Facts, or None (unknown, switched off, or no answer)."""
    if not config.OFF_PRODUCT_URL:
        return None
    now = time.time()
    with _lock:
        hit = _cache.get(code)
        if hit and now - hit[0] < CACHE_SECONDS:
            _cache.move_to_end(code)
            return hit[1]
    found = None
    url = config.OFF_PRODUCT_URL + urllib.parse.quote(code) + "?fields=product_name,product_name_de,brands,quantity"
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=6) as r:
            data = json.loads(r.read(200_000).decode("utf-8", "replace"))
        p = data.get("product") or {}
        name = str(p.get("product_name_de") or p.get("product_name") or "").strip()
        if data.get("status") == 1 and name:
            found = {"name": name[:100], "brand": str(p.get("brands") or "").split(",")[0].strip()[:60],
                     "size": str(p.get("quantity") or "").strip()[:20]}
    except urllib.error.HTTPError as e:
        if e.code != 404:               # 404 means "not known": remember that too
            return None
    except (OSError, ValueError):
        return None                     # no answer: don't remember, try again next time
    with _lock:
        _cache[code] = (now, found)
        while len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)
    return found


def check(raw):
    """-> (status, answer) for POST /api/barcode."""
    code = normalise(raw)
    if not code:
        return 400, {"error": "bad_code", "message": "That isn’t a barcode number. Type the 8 or 13 digits under the bars."}
    product, source = openprices.by_barcode(code), "open"
    if product is None:
        product, source = _off(code), "off"
    if not product:
        return 200, {"code": code, "found": False,
                     "message": "This product isn’t in the open product data yet. Type its name in the search box instead."}
    return 200, {"code": code, "found": True, "source": source, "name": product["name"], "brand": product["brand"],
                 "size": product["size"], "query": search_text(product["name"], product["size"])}
