"""Real shop prices from Open Prices (Open Food Facts), collected weekly into
bonwise/open_prices.json by tools/import_open_prices.py.

Matching is strict on purpose, so a price is only compared with the same kind of
product in the same pack size:
- items the price guide knows ("milk", "Butter 250 g") match products whose name has one
  of the guide's words as a whole word ("Vollmilch", but not "Milchschokolade") and the
  same pack size;
- anything else ("Kiri Portionen") must have every typed word in the product name or
  brand, and only the most common pack size is compared.
"""

import json
import re
import threading
from pathlib import Path

from .textutil import norm

PATH = Path(__file__).resolve().parent / "open_prices.json"
STOP = {"und", "mit", "the", "and", "bio", "organic", "frisch", "fresh"}
UNIT_WORDS = {"g", "kg", "ml", "l", "cl", "x", "er", "st", "stk", "pcs", "pack", "packung"}
# Open Food Facts categories a product must have to count as one of our product types
# (so "milk" never matches "Cremeseife Milch & Honig" or an oat drink).
KINDS = {
    "Milk": {"milks"}, "Butter": {"butters"}, "Cheese slices": {"cheeses"}, "Mozzarella": {"mozzarella"},
    "Yoghurt": {"yogurts"}, "Quark": {"quarks", "quark", "fresh-cheeses"}, "Cream": {"creams", "whipping-creams"},
    "Eggs": {"eggs", "chicken-eggs"}, "Organic eggs": {"eggs", "chicken-eggs"}, "Bread": {"breads"},
    "Toast bread": {"breads", "sandwich-breads", "white-breads"}, "Bread rolls": {"breads", "bread-rolls"},
    "Pasta": {"pastas"}, "Rice": {"rices"}, "Flour": {"flours"}, "Sugar": {"sugars"},
    "Cooking oil": {"vegetable-oils", "sunflower-oils", "rapeseed-oils"}, "Coffee": {"coffees"},
    "Hazelnut spread": {"hazelnut-spreads", "cocoa-and-hazelnuts-spreads"}, "Cereal": {"breakfast-cereals"},
    "Ketchup": {"ketchup"}, "Orange juice": {"orange-juices"}, "Apple juice": {"apple-juices"},
    "Soft drink": {"sodas", "colas", "soft-drinks"}, "Water": {"waters", "mineral-waters"},
    "Crisps": {"crisps", "chips-and-fries"}, "Chocolate": {"chocolates"}, "Gummy sweets": {"gummies", "candies"},
    "Crackers": {"crackers"}, "Biscuits": {"biscuits"}, "Sausage & ham": {"sausages", "hams"},
    "Tea": {"teas"}, "Salt": {"salts"}, "Lentils": {"lentils"}, "Chickpeas": {"chickpeas"}, "Olive oil": {"olive-oils"},
    "Frozen pizza": {"pizzas"}, "Ice cream": {"ice-creams"}, "Beer": {"beers"}, "Wine": {"wines"},
}
NOT_KINDS = {"Milk": ("plant-based", "milk-substitute", "flavoured-milks", "chocolate")}

# Loose fruit and veg are priced per kg (or per piece) in Open Prices.
CATEGORIES = {"Bananas": "en:bananas", "Apples": "en:apples", "Tomatoes": "en:tomatoes", "Potatoes": "en:potatoes",
              "Onions": "en:onions", "Cucumber": "en:cucumbers"}

_lock = threading.Lock()
_db = None


def _load():
    global _db
    with _lock:
        if _db is None:
            try:
                raw = json.loads(PATH.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                raw = {}
            items = []
            for code, e in (raw.get("products") or {}).items():
                name = norm(e.get("n", "") + " " + e.get("b", ""))
                toks = set(re.findall(r"[a-z][a-z0-9\-]+", name))
                toks |= {part for t in toks for part in t.split("-") if part}  # "coca-cola" -> coca, cola
                items.append((toks, " " + name + " ", e))
            _db = {"meta": {k: raw.get(k) for k in ("source", "generated", "since", "prices")},
                   "items": items, "categories": raw.get("categories") or {}}
    return _db


def reset(path=None):
    """Load another file next time (used by the tests)."""
    global _db, PATH
    with _lock:
        _db = None
        if path:
            PATH = Path(path)


def meta():
    return _load()["meta"]


def _same_size(s, size):
    if not size:
        return True
    if not s or s[1] != size["fam"]:
        return False
    return abs(s[0] - size["v"]) <= max(1, size["v"] * 0.02)


def _words(text):
    return [w for w in norm(text).replace(",", " ").split()
            if len(w) >= 3 and not re.search(r"\d", w) and w not in UNIT_WORDS and w not in STOP]


def _kind_ok(e, en):
    want = KINDS.get(en or "")
    if not want:
        return True
    cats = set(e.get("c") or ())
    return bool(cats & want) and not any(bad in c for c in cats for bad in NOT_KINDS.get(en, ()))


def lookup(query, keys=None, size=None, en=None):
    """-> {CHAIN: {"price", "product", "date", "size"}}, the cheapest matching product per chain.
    keys: the price guide's words for this product type (then en picks the category);
    without keys, every typed word must be in the product's name or brand."""
    db = _load()
    found = []
    if keys:
        singles = [k for k in keys if " " not in k and len(k) >= 3]
        phrases = [" " + k + " " for k in keys if " " in k]
        for toks, name, e in db["items"]:
            if ((any(k in toks for k in singles) or any(p in name for p in phrases)) and _same_size(e.get("s"), size)
                    and _kind_ok(e, en)):
                found.append(e)
    else:
        words = _words(query)
        if not words:
            return {}
        for toks, name, e in db["items"]:
            if all(w in toks or (len(w) >= 4 and any(t.startswith(w) for t in toks)) for w in words) and _same_size(e.get("s"), size):
                found.append(e)
    if found and not size:
        # Compare one pack size only: the most common one among the matches.
        def key(e):
            return tuple(e["s"]) if e.get("s") else None
        counts = {}
        for e in found:
            counts[key(e)] = counts.get(key(e), 0) + 1
        common = max(counts, key=counts.get)
        found = [e for e in found if key(e) == common]
    out = {}
    for e in found:
        for chain, (price, day) in e["p"].items():
            if chain not in out or price < out[chain]["price"]:
                out[chain] = {"price": price, "product": e["n"], "date": day,
                              "size": _size_text(e.get("s"))}
    cat = CATEGORIES.get(en or "")
    if cat and cat in db["categories"] and size:
        c = db["categories"][cat]
        qty = size["v"] / 1000.0 if c["per"] == "kg" and size["fam"] == "g" else (size["v"] if c["per"] == "unit" and size["fam"] == "st" else None)
        if qty:
            for chain, (price, day) in c["p"].items():
                p = round(price * qty + 1e-9, 2)
                if chain not in out or p < out[chain]["price"]:
                    out[chain] = {"price": p, "product": "loose, per " + c["per"], "date": day, "size": ""}
    return out


def _size_text(s):
    if not s:
        return ""
    v, unit = s
    if v >= 1000:
        return ("%g" % (v / 1000)) + (" kg" if unit == "g" else " l")
    return ("%g " % v) + unit
