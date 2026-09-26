"""Plan my shop: before shopping, the user types what they need ("milk, crackers,
vegetables"), and Bonwise works out which shops near them are cheapest for it.

Evidence, best first (the app labels each price "Real price" or "Estimate"):
1. Real prices: what Bonwise users paid at that shop chain in the last 90 days, and
   ALDI SÜD shelf prices for ALDI shops.
2. Estimates: a typical discounter price for the item (ALDI's shelf price when we have
   it, otherwise the built-in guide), times the rough price level of that kind of shop.

Shops come from OpenStreetMap (places.nearby); the position is rounded there and never
stored. The typed items are only used to answer this request.
"""

import re

from . import advisor, data, places, storage
from .textutil import norm, pack_size, round2, size_label

MAX_ITEMS = 30

# Words that aren't products: "I'm going to Aldi to buy milk and bread" -> milk, bread
FILLER = {"i", "im", "i'm", "am", "we", "going", "go", "to", "the", "at", "for", "from", "buy", "buying", "need",
          "needs", "want", "get", "some", "a", "an", "please", "shopping", "shop", "today", "tomorrow", "also",
          "my", "list", "ich", "brauche", "kaufen", "einkaufen", "noch", "bitte", "etwas", "zum", "zu", "bei",
          "mujhe", "khareedne", "kharidne", "ja", "raha", "rahi", "hu", "hoon", "hai", "lena", "lene", "ke", "liye"}
SPLIT = re.compile(r"(?<!\d),|,(?!\d)|[;\n+&/•·]|\s(?:and|und|aur|plus|n)\s")
COUNT = re.compile(r"^(\d{1,2})\s*x?\s+(?!(?:kg|g|l|ml|cl|er)\b)(.+)$")


def _chain_words():
    """Shop chains a user might name ("going to aldi")."""
    words = {s: s.upper() for s in data.STORES if " " not in s and "-" not in s}
    words.update({"dm": "dm", "aldi": "ALDI", "lidl": "LIDL", "rossmann": "ROSSMANN"})
    return words


CHAINS = _chain_words()


def _phrases():
    """Every product word or phrase we recognise, for splitting "milk crackers veg" into three items."""
    out = set(data.ALIASES)
    for g in data.GUIDE:
        out.update(g["k"])
        out.add(norm(g["en"]))
    for keys, en, _cat in data.EXTRA_ITEMS:
        out.update(keys)
        out.add(norm(en))
    for sp in data.SPORTS:  # "nike air force", so sneakers split off like any other product
        brand = norm(sp["brand"])
        out.update(k for k in sp["keys"] if not k.isdigit())
        out.update(brand + " " + k for k in sp["keys"])
    return out


PHRASES = _phrases()


def _alias(words):
    """Replace other-language or loose words with the English product name, whole words only."""
    out, i = [], 0
    while i < len(words):
        for n in (3, 2, 1):
            ph = " ".join(words[i:i + n])
            if len(words[i:i + n]) == n and ph in data.ALIASES:
                out.extend(data.ALIASES[ph].split())
                i += n
                break
        else:
            out.append(words[i])
            i += 1
    return out


def _segment(words):
    """Split a run of words into products. Unknown words stick to the next product
    ("bio milk", "2 l milk"); if nothing is recognised the words stay one item."""
    found, i = [], 0
    while i < len(words):
        for n in (3, 2, 1):
            ph = " ".join(words[i:i + n])
            if len(words[i:i + n]) == n and ph in PHRASES:
                found.append((i, i + n))
                i += n
                break
        else:
            i += 1
    if len(found) < 2:
        return [" ".join(words)] if words else []
    items, start = [], 0
    for k, (a, b) in enumerate(found):
        end = len(words) if k == len(found) - 1 else b
        items.append(" ".join(words[start:end]))
        start = end
    return items


def parse_list(text):
    """Free text -> (items, chain the user said they're going to, or '')."""
    text = str(text or "")[:2000]
    going = ""
    items, seen = [], set()
    for part in SPLIT.split(" " + text.lower() + " "):
        words = [w for w in norm(part).split() if w]
        for w in words:
            if not going and w in CHAINS:
                going = CHAINS[w]
        words = [w for w in words if w not in FILLER and w not in CHAINS]
        for item in _segment(_alias(words)):
            item = item.strip(" .-")[:60]
            key = norm(item)
            if len(key) < 2 or key in seen or not re.search(r"[a-z]", key):
                continue
            seen.add(key)
            items.append(item)
    return items[:MAX_ITEMS], going


def _extra(text):
    words = " " + norm(text) + " "
    best, best_len = None, 0
    for keys, en, cat in data.EXTRA_ITEMS:
        for k in keys:
            if (" " + k + " ") in words and len(k) > best_len:
                best, best_len = (en, cat), len(k)
    return best


def _size_text(v, fam):
    if fam in ("g", "ml", "st"):
        return size_label(v, fam)
    return "%g %s" % (v, "loads" if fam == "wl" else fam)


def resolve(query):
    """One typed item -> what it is, how much it usually costs and where it's cheapest known."""
    q = str(query).strip()
    count = 1
    m = COUNT.match(norm(q))
    if m:
        count, q = max(1, min(20, int(m.group(1)))), m.group(2)
    text = " ".join(_alias(norm(q).split()))
    info = {"query": str(query).strip()[:60], "name": q[:1].upper() + q[1:60], "cat": "Other", "count": count, "size": "",
            "typical": None, "aldi": None, "online": None, "base": None, "community": {}}

    sport = advisor.find_sport(text)
    if sport:
        best = sport["best"]
        info.update(name=sport["brand"] + " " + sport["model"], cat="Clothing & shoes",
                    online={"price": best["total"], "shop": best["shop"], "src": best["src"], "list": sport["list"]})
        return info

    g = advisor.lookup(text)
    size = pack_size(text)
    if g:
        ref = advisor._ref_size(g)
        info["cat"] = g["cat"]
        info["name"] = g["en"]
        expect = g["price"]
        if size and size["fam"] == ref["fam"] and ref["v"] > 0:
            expect = g["price"] * size["v"] / ref["v"]
            info["size"] = _size_text(size["v"], size["fam"])
        else:
            info["size"] = _size_text(ref["v"], ref["fam"])
        info["typical"] = round2(expect)
        bio = bool(re.search(r"\b(bio|organic)\b", norm(text)))
        mk = advisor.market_match(g, {"name": text, "en": text}, size, bio)
        if mk:
            info["aldi"] = {"price": mk["forYours"], "product": mk["name"], "size": mk["yourSize"], "store": mk["store"],
                            "checked": mk["checked"]}
            info["size"] = mk["yourSize"]
    else:
        ex = _extra(text)
        if ex:
            info["name"], info["cat"] = ex
        elif size:
            info["size"] = _size_text(size["v"], size["fam"])
    info["keys"] = list(dict.fromkeys(k for k in (q, text, info["name"], (info["name"] + " " + info["size"]).strip()) if k))
    return info


def _add_community(infos):
    keys = [k for info in infos for k in info.get("keys", [])]
    try:
        found = storage.best_prices(keys)
    except Exception as e:  # noqa: BLE001 - community prices are a bonus; plan without them
        print("community prices unavailable:", repr(e), flush=True)
        found = {}
    for info in infos:
        by_chain = {}
        for k in info.pop("keys", []):
            entry = found.get(storage.price_key(k))
            for chain, price in (entry or {}).get("byChain", {}).items():
                if chain not in by_chain or price < by_chain[chain]:
                    by_chain[chain] = price
        info["community"] = by_chain
        # The discounter price estimates start from: ALDI's shelf price, the guide, or the cheapest user price.
        if info["aldi"]:
            info["base"] = info["aldi"]["price"]
        elif info["typical"] is not None:
            info["base"] = info["typical"]
        elif by_chain:
            info["base"] = min(by_chain.values())


def shop_level(shop):
    """'discounter' | 'supermarket' | 'organic' | 'convenience' | 'drugstore' | 'greengrocer' | 'bakery' | 'butcher'."""
    if shop.get("chain") in data.ORGANIC_CHAINS:
        return "organic"
    if shop.get("discounter"):
        return "discounter"
    return {"Supermarket": "supermarket", "Discounter": "discounter", "Convenience store": "convenience",
            "Drugstore": "drugstore", "Greengrocer": "greengrocer", "Bakery": "bakery",
            "Butcher": "butcher"}.get(shop.get("kind"), "supermarket")


def shop_chain(shop):
    label = (shop.get("brand") or "") + " " + (shop.get("name") or "")
    chain = storage.chain_of(label)
    if not chain and re.search(r"\bdm\b", label.lower()):
        chain = "dm"
    return chain


def price_at(shop, info):
    """Price of one item at one shop: {price, real, src}, {price: None} if sold but unpriced, None if not sold."""
    level = data.SHOP_LEVELS[shop["level"]]
    if info["cat"] not in level["sells"]:
        return None
    count = info["count"]
    chain = shop.get("chain")
    if chain and chain in info["community"]:
        return {"price": round2(info["community"][chain] * count), "real": True, "src": "users"}
    if chain == "ALDI" and info["aldi"]:
        return {"price": round2(info["aldi"]["price"] * count), "real": True, "src": "aldi"}
    base = info["base"]
    if shop["level"] == "drugstore" and info["typical"] is not None:
        base = info["typical"]  # the guide's drugstore prices are dm / Rossmann own brands
    if base is None:
        return {"price": None, "real": False, "src": ""}
    factor = level["level"]
    if info["cat"] == "Drugstore" and shop["level"] in ("supermarket", "convenience"):
        factor = data.DRUGSTORE_AT_SUPERMARKET
    return {"price": round2(base * factor * count), "real": False, "src": "estimate"}


def _cheapest_near(cands, tol_abs=0.30, tol_rel=0.03):
    """Cheapest option, but a nearer one wins if it costs (almost) the same."""
    if not cands:
        return None
    cheapest = min(c[0] for c in cands)
    close = [c for c in cands if c[0] <= cheapest + max(tol_abs, cheapest * tol_rel)]
    return min(close, key=lambda c: (c[1], c[0]))


def plan(text=None, items=None, lat=None, lon=None, dow=None, minute=None, radius=1500, osm=None):
    if items:
        names, going = [], ""
        for it in items[:MAX_ITEMS]:
            got, g = parse_list(str(it)[:80])
            names.extend(got)
            going = going or g
        names = list(dict.fromkeys(names))[:MAX_ITEMS]
        if text:
            going = parse_list(text)[1] or going
    else:
        names, going = parse_list(text)
    infos, seen = [], set()
    for n in names:  # "butter" and "Butter 250 g" on the same list are one product
        info = resolve(n)
        key = (info["name"].lower(), info["size"], info["count"])
        if key not in seen:
            seen.add(key)
            infos.append(info)
    _add_community(infos)

    notice, shops = "", []
    if lat is not None and lon is not None:
        try:
            shops = places.nearby(lat, lon, radius, dow, minute, osm=osm)
        except places.PlacesError:
            notice = "The map service is busy right now, so shops near you couldn’t be compared. Below are the best prices we know."
    for s in shops:
        s["chain"] = shop_chain(s)
        s["level"] = shop_level(s)

    local = [i for i, info in enumerate(infos) if not info["online"]]
    rows = []
    for s in shops:
        prices = [price_at(s, info) if i in local else None for i, info in enumerate(infos)]
        sold = [i for i in local if prices[i] is not None]
        total = round2(sum(prices[i]["price"] for i in sold if prices[i]["price"] is not None))
        rows.append({"shop": s, "prices": prices, "sold": sold, "total": total,
                     "real": sum(1 for i in sold if prices[i]["real"])})

    def usable(r):
        return r["shop"].get("open") is not False

    # Best single stop: sells everything on the list, open (when we know), cheapest; nearer wins a near-tie.
    full = [r for r in rows if local and len(r["sold"]) == len(local)]
    pool = [r for r in full if usable(r)] or full
    best = _cheapest_near([(r["total"], r["shop"]["distance"], k) for k, r in enumerate(rows) if r in pool])
    best_i = best[2] if best else None

    going_i = None
    if going:
        mine = [k for k, r in enumerate(rows) if r["shop"]["chain"] == going]
        if mine:
            going_i = min(mine, key=lambda k: rows[k]["shop"]["distance"])

    # Cheapest place for each item.
    item_best = []
    for i, info in enumerate(infos):
        cands = [(r["prices"][i]["price"], r["shop"]["distance"], k) for k, r in enumerate(rows)
                 if r["prices"][i] and r["prices"][i]["price"] is not None and usable(r)]
        pick = _cheapest_near(cands, tol_abs=0.05, tol_rel=0.0)
        if not pick and i in local:
            # No price anywhere: point to the best stop if it sells it, else the nearest open shop that does.
            sells = [k for k, r in enumerate(rows) if r["prices"][i] is not None and usable(r)]
            pick = (None, None, best_i if best_i in sells else min(sells, key=lambda k: rows[k]["shop"]["distance"])) if sells else None
        item_best.append(pick[2] if pick else None)

    # Two or three stops, only if that saves a real amount over the best single stop.
    split = None
    if best_i is not None:
        stops = {}
        for i in local:
            k = item_best[i]
            if k is None or rows[k]["prices"][i]["price"] is None or rows[best_i]["prices"][i]["price"] is None:
                k = best_i
            stops.setdefault(k, []).append(i)
        split_total = round2(sum(rows[k]["prices"][i]["price"] or 0 for k, idx in stops.items() for i in idx))
        save = round2(rows[best_i]["total"] - split_total)
        if 1 < len(stops) <= 3 and save >= max(1.5, rows[best_i]["total"] * 0.1):
            split = {"stops": [{"shop": k, "items": idx, "total": round2(sum(rows[k]["prices"][i]["price"] or 0 for i in idx))}
                               for k, idx in sorted(stops.items(), key=lambda kv: rows[kv[0]]["shop"]["distance"])],
                     "total": split_total, "save": save}

    # Keep the shops worth showing: the picks plus the next cheapest full-list stops.
    keep = [k for k in [best_i, going_i] + item_best if k is not None]
    if split:
        keep += [st["shop"] for st in split["stops"]]
    keep += [k for k, r in sorted(((k, r) for k, r in enumerate(rows) if r in full), key=lambda kr: (kr[1]["total"], kr[1]["shop"]["distance"]))][:4]
    keep = list(dict.fromkeys(keep))
    index = {k: n for n, k in enumerate(keep)}

    out_shops = []
    for k in keep:
        r, s = rows[k], rows[k]["shop"]
        out_shops.append({
            "name": s["name"], "brand": s["brand"], "chain": s["chain"], "kind": s["kind"], "level": s["level"],
            "distance": s["distance"], "open": s["open"], "address": s["address"], "hours": s["hours"],
            "lat": s["lat"], "lon": s["lon"], "total": r["total"], "real": r["real"],
            "priced": sum(1 for i in r["sold"] if r["prices"][i]["price"] is not None),
            "covers": len(r["sold"]), "missing": [infos[i]["name"] for i in local if i not in r["sold"]],
            "prices": r["prices"],
        })

    out_items = []
    for i, info in enumerate(infos):
        k = item_best[i]
        best_price = rows[k]["prices"][i] if k is not None else None
        known = None
        if info["community"]:
            ch = min(info["community"], key=info["community"].get)
            known = {"price": round2(info["community"][ch] * info["count"]), "chain": ch, "src": "users"}
        if info["aldi"] and (known is None or info["aldi"]["price"] * info["count"] < known["price"]):
            known = {"price": round2(info["aldi"]["price"] * info["count"]), "chain": "ALDI", "src": "aldi"}
        out_items.append({
            "query": info["query"], "name": info["name"], "cat": info["cat"], "count": info["count"], "size": info["size"],
            "typical": round2(info["typical"] * info["count"]) if info["typical"] is not None else None,
            "aldi": info["aldi"], "online": info["online"], "known": known,
            "best": ({"shop": index[k], "price": best_price["price"], "real": best_price["real"], "src": best_price["src"]}
                     if k is not None else None),
            "hint": data.CHEAPEST_AT.get(info["cat"], "discounters (Aldi, Lidl, Penny, Netto)"),
        })

    return {
        "items": out_items, "goingTo": going, "located": lat is not None and lon is not None and not notice,
        "shops": out_shops,
        "best": index.get(best_i) if best_i is not None else None,
        "going": index.get(going_i) if going_i is not None else None,
        "split": ({"stops": [dict(st, shop=index[st["shop"]]) for st in split["stops"]], "total": split["total"], "save": split["save"]}
                  if split else None),
        "notice": notice, "retry": bool(notice), "checked": data.MARKET_CHECKED,
    }
