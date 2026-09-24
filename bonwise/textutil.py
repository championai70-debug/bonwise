"""Small text and number helpers shared by the parser and the advisor."""

import math
import re


def round2(n):
    """Round to cents, half up (like JavaScript's Math.round), not banker's rounding."""
    return math.floor(n * 100 + 0.5) / 100


def num(s):
    return float(re.sub(r"\s", "", str(s)).replace(",", ".", 1))


def jsnum(x):
    """1500.0 -> '1500', 1.5 -> '1.5'."""
    return "%g" % x


def norm(s):
    s = str(s or "").lower()
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        s = s.replace(a, b)
    s = re.sub(r"[^a-z0-9.,\- ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def pack_size(name):
    """Pack size printed in a name: 500g, 1kg, 1,5L, 250 ml, 10er, 8 Rollen."""
    n = norm(name)
    m = re.search(r"(\d+(?:[.,]\d+)?)\s?(kg|g|l|ml|cl)\b", n)
    if m:
        v, u = num(m.group(1)), m.group(2)
        if u == "kg":
            return {"v": v * 1000, "fam": "g"}
        if u == "g":
            return {"v": v, "fam": "g"}
        if u == "l":
            return {"v": v * 1000, "fam": "ml"}
        if u == "cl":
            return {"v": v * 10, "fam": "ml"}
        return {"v": v, "fam": "ml"}
    m = re.search(r"(\d+)\s?(er|stk|st|x|rollen)\b", n)
    if m:
        return {"v": float(m.group(1)), "fam": "st"}
    return None


def pretty_size(s):
    if s["fam"] == "g":
        return jsnum(s["v"] / 1000) + " kg" if s["v"] >= 1000 else jsnum(s["v"]) + " g"
    if s["fam"] == "ml":
        return jsnum(s["v"] / 1000) + " L" if s["v"] >= 1000 else jsnum(s["v"]) + " ml"
    return "×" + jsnum(s["v"])


def size_label(v, fam):
    fmt = lambda x: jsnum(round2(x)).replace(".", ",")
    if fam == "g":
        return fmt(v / 1000) + " kg" if v >= 1000 else jsnum(v) + " g"
    if fam == "ml":
        return fmt(v / 1000) + " l" if v >= 1000 else jsnum(v) + " ml"
    return jsnum(v) + " pcs"
