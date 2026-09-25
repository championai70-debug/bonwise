"""Savings advice: for each receipt line, find a cheaper like-for-like option.

Order of evidence:
1. Real shelf prices (ALDI SÜD) for the same product type and pack size.
2. Real sneaker prices (brand shop vs cheapest online offer).
3. The built-in guide of typical discounter prices (estimate).
4. The AI's own suggestion, only when nothing above applies (estimate).
"""

import re

from . import data
from .textutil import norm, pack_size, pretty_size, round2, size_label


EN_DE = {"whole": "voll", "ground": "gemahl", "wholegrain": "vollkorn", "wholemeal": "vollkorn", "organic": "bio",
         "sandwich": "sandwich", "butter": "butter", "slices": "scheiben", "rye": "roggen", "orange": "orange",
         "apple": "apfel", "paprika": "paprika", "salted": "salz", "salt": "salz", "dandruff": "schuppen"}


def lookup(name):
    n = " " + norm(name) + " "
    best, best_len = None, 0
    for g in data.GUIDE:
        for k in g["k"]:
            if len(k) > best_len and k in n:
                best, best_len = g, len(k)
    return best


def brand_of(name):
    n = norm(name)
    for b in data.BRANDS:
        if b in n:
            return b
    return None


def _ref_size(g):
    u, q = g["unit"], g["qty"]
    if u == "kg":
        return {"v": q * 1000, "fam": "g"}
    if u == "g":
        return {"v": q, "fam": "g"}
    if u == "l":
        return {"v": q * 1000, "fam": "ml"}
    if u == "ml":
        return {"v": q, "fam": "ml"}
    return {"v": q, "fam": u}


def market_match(g, item, size, bio):
    """Cheapest comparable ALDI SÜD product for this item, or None."""
    if not g or not g.get("mk"):
        return None
    ref = _ref_size(g)
    fam = size["fam"] if size else ref["fam"]
    qty = size["v"] if size else ref["v"]
    cands = [p for p in data.MARKET if p["mk"] == g["mk"] and p["fam"] == fam]
    wants_beans = bool(re.search(r"(bohne|beans|espresso)", norm(item.get("name"))))
    cands = [p for p in cands if wants_beans or "(beans)" not in p["name"]]
    if not cands:
        return None
    pool = [p for p in cands if p["own"] and (p["bio"] if bio else not p["bio"])]
    organic_swap = False
    if not pool and bio:
        pool = [p for p in cands if p["own"]]
        organic_swap = True
    if not pool:
        pool = cands

    def unit(p):
        return p["price"] / p["size"]

    # Like for like: same pack size if available, then the same kind of product by name.
    same_pack = [p for p in pool if p["size"] == qty]
    if same_pack:
        pool = same_pack
    toks = [t for t in norm((item.get("name") or "") + " " + (item.get("en") or "")).split(" ")
            if len(t) >= 4 and not re.search(r"\d", t)]
    # English names from the AI -> the German words on ALDI's labels
    toks += [EN_DE[t] for t in toks if t in EN_DE]
    named = [p for p in pool if any(t in norm(p["name"]) for t in toks)]
    if named:
        pool = named
    best = sorted(pool, key=unit)[0]

    same = None
    brand = brand_of(item.get("name"))
    if brand:
        for p in cands:
            if not p["own"] and brand in norm(p["name"]):
                same = {"name": p["name"], "price": p["price"], "size": size_label(p["size"], p["fam"]),
                        "forYours": round2(unit(p) * qty)}
                break
    return {
        "store": data.MARKET_STORE, "checked": data.MARKET_CHECKED, "organicSwap": organic_swap,
        "name": best["name"], "price": best["price"], "size": size_label(best["size"], best["fam"]),
        "samePack": best["size"] == qty, "forYours": round2(unit(best) * qty),
        "yourSize": size_label(qty, fam), "same": same,
    }


def advise_item(item):
    """item: {name, en?, price, pfand?} -> {en, cat, tip, alt, altPrice, save, market}."""
    out = {"en": item.get("name"), "cat": "Other", "tip": "", "alt": "", "altPrice": None, "save": 0, "market": None}
    if item.get("pfand"):
        out.update(en="Bottle deposit (Pfand)", cat="Pfand")
        return out
    price = item.get("price")
    label = (item.get("name") or "") + " " + (item.get("en") or "")
    g, brand = lookup(label), brand_of(item.get("name"))
    if g:
        out["cat"] = g["cat"]
        size = pack_size(label)
        out["en"] = item.get("en") or (g["en"] + (" " + pretty_size(size) if size else ""))
        bio = bool(re.search(r"\b(bio|organic)\b", norm(label)))
        m = market_match(g, item, size, bio)
        if m:
            out["market"] = m
            if price is not None and price > 0:
                d = round2(price - m["forYours"])
                if d >= 0.2 and d / price >= 0.08:
                    out["altPrice"] = m["forYours"]
                    out["save"] = d
                    out["alt"] = ("non-organic: " if m["organicSwap"] else "") + m["name"] + " at " + m["store"]
                    out["tip"] = (("Non-organic option: " if m["organicSwap"] else "") + m["store"] + " sells " + m["name"]
                                  + " (" + m["size"] + ") for €" + f"{m['price']:.2f}"
                                  + ("" if m["samePack"] else " — about €" + f"{m['forYours']:.2f}" + " for " + m["yourSize"]))
            if not out["save"] and m["same"] and price and price - m["same"]["forYours"] >= 0.2:
                out["altPrice"] = m["same"]["forYours"]
                out["save"] = round2(price - m["same"]["forYours"])
                out["alt"] = "same brand at " + m["store"]
                out["tip"] = ("Same brand is cheaper at " + m["store"] + ": " + m["same"]["name"]
                              + " (" + m["same"]["size"] + ") €" + f"{m['same']['price']:.2f}")
            return out
        ref, expect = _ref_size(g), g["price"]
        if size and size["fam"] == ref["fam"] and ref["v"] > 0:
            expect = g["price"] * size["v"] / ref["v"]
        expect = round2(expect)
        if price is not None and price > 0:
            diff = round2(price - expect)
            if diff >= 0.2 and diff / price >= 0.08:
                organic_swap = bio and "bio" not in " ".join(g["k"])
                out["altPrice"] = expect
                out["save"] = diff
                out["alt"] = ("non-organic: " if organic_swap else "") + g["alt"]
                out["tip"] = ("Non-organic option: " if organic_swap else "Try ") + g["alt"] + " — typically about €" + f"{expect:.2f}"
    if not out["save"] and brand and price is not None and price > 0.8:
        out["save"] = round2(price * 0.3)
        out["altPrice"] = round2(price - out["save"])
        out["alt"] = "the store-brand version (usually ~30% cheaper)"
        out["tip"] = "Branded product — the store-brand version is usually ~30% cheaper"
    return out


def find_sport(text):
    """Match a receipt line or a search to a known sneaker model."""
    n = re.sub(r"\s+", " ", re.sub(r"[’']", "", str(text or "").lower()))
    best, best_len = None, 0
    for it in data.SPORTS:
        brand_hit = it["brand"].lower() in n
        for k in it["keys"]:
            if k not in n:
                continue
            # "530", "suede" and "dunk" alone are too generic without the brand name
            if k in ("530", "suede", "dunk") and not brand_hit:
                continue
            if len(k) > best_len:
                best, best_len = it, len(k)
    return best


def _eur(n):
    return "€" + f"{abs(n):.2f}"


def _community_offer(row, community, chain, key_fn):
    """Cheapest price other Bonwise users paid for the same product at another shop chain."""
    if not community or row["pfand"] or row["price"] is None or row["price"] <= 0 or not row.get("en"):
        return None
    entry = community.get(key_fn(row["en"]))
    if not entry:
        return None
    others = {c: p for c, p in entry.get("byChain", {}).items() if c != chain}
    if not others:
        return None
    best_chain = min(others, key=others.get)
    best = others[best_chain]
    diff = round2(row["price"] - best)
    if diff >= 0.2 and diff / row["price"] >= 0.08:
        return best_chain, best, diff
    return None


def advise_receipt(receipt, community=None, chain="", key_fn=None):
    """receipt: {store, date, total, currency, items: [{raw, en?, price, pfand?, cat?, flag?, ocrPrice?, cheaper?}]}
    community: optional {price_key: {byChain: {CHAIN: price}}} from other users' receipts.
    Returns the same receipt with every item advised, plus summary numbers."""
    currency = str(receipt.get("currency") or "EUR").upper()
    foreign = currency != "EUR"
    rows = []
    for it in receipt.get("items") or []:
        raw, en, price = it.get("raw") or "", it.get("en") or "", it.get("price")
        if foreign:
            a = {"en": en or raw, "cat": "Other", "tip": "", "alt": "", "altPrice": None, "save": 0, "market": None}
        else:
            a = advise_item({"name": raw, "en": en, "price": price, "pfand": it.get("pfand")})
        sp = None if foreign else find_sport(raw + " " + en)
        if sp:
            best = sp["best"]
            a = {"en": en or (sp["brand"] + " " + sp["model"]), "cat": "Clothing & shoes", "tip": "", "alt": "",
                 "altPrice": None, "save": 0,
                 "market": {"sport": True, "store": best["shop"], "forYours": best["total"], "list": sp["list"],
                            "listSrc": sp["listSrc"], "src": best["src"]}}
            if price is not None and price - best["total"] >= 1:
                a["save"] = round2(price - best["total"])
                a["altPrice"] = best["total"]
                a["alt"] = "same " + sp["model"] + " at " + best["shop"]
                a["tip"] = ("Cheapest online: from " + _eur(best["price"])
                            + (" + " + _eur(best["ship"]) + " shipping" if best["ship"] else " incl. shipping")
                            + " at " + best["shop"] + " (" + best["src"] + "). Brand shop price: " + _eur(sp["list"]) + ".")
        cat = "Pfand" if it.get("pfand") else ("Clothing & shoes" if sp else (it.get("cat") or a["cat"]))
        row = {"raw": raw, "en": en or a["en"], "cat": cat, "price": price, "original": it.get("original"), "aiPrice": it.get("aiPrice"), "ocrPrice": it.get("ocrPrice"),
               "pfand": bool(it.get("pfand")), "flag": it.get("flag") or "", "tip": a["tip"], "alt": a["alt"],
               "altPrice": a["altPrice"], "save": a["save"], "market": a["market"]}
        # AI estimate only where the real-price data and the built-in guide found nothing
        ch = it.get("cheaper")
        orig = it.get("original")
        if orig and price is not None and price <= orig * 0.8:
            ch = None  # already bought at 20%+ off: an estimated "cheaper" option isn't a real saving
        cp = _to_float(ch.get("price")) if isinstance(ch, dict) else None
        if (not foreign and not row["market"] and not row["save"] and isinstance(ch, dict) and ch.get("name")
                and cp is not None and cp > 0 and price is not None and price - cp >= 0.2):
            row["altPrice"] = round2(cp)
            row["save"] = round2(price - cp)
            row["alt"] = str(ch["name"])[:80]
            row["tip"] = "Try " + row["alt"] + " — typically about " + _eur(cp)
        # Real prices other users paid elsewhere beat estimates (but not our checked shop prices)
        offer = None if foreign or not key_fn else _community_offer(row, community, chain, key_fn)
        if offer and not row["market"]:
            c_chain, c_price, c_diff = offer
            row.update(altPrice=c_price, save=c_diff, alt="same product at " + c_chain,
                       tip="Bonwise users paid " + _eur(c_price) + " for this at " + c_chain + " recently",
                       market={"community": True, "store": c_chain, "forYours": c_price, "yourSize": ""})
        rows.append(row)

    out = dict(receipt)
    out["currency"] = currency
    out["foreign"] = foreign
    out["items"] = rows
    out["itemTotal"] = round2(sum(r["price"] or 0 for r in rows))
    out["couldSave"] = round2(sum(r["save"] for r in rows if r["save"] and r["save"] > 0))
    out["discounts"] = round2(sum(r["original"] - r["price"] for r in rows
                                  if r.get("original") is not None and r["price"] is not None and r["original"] > r["price"]))
    return out


def _to_float(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and f not in (float("inf"), float("-inf")) else None
