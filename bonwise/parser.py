"""Turn OCR text from a (mostly German) receipt into line items.

Used when the AI reader isn't available: Tesseract reads the photo, this
module finds the product lines, prices and the printed total, and repairs the
most common OCR slips using the total.
"""

import re

from .data import STORES
from .textutil import norm, num, pack_size, round2

SKIP = re.compile(
    r"(summe|zwischensumme|gesamt|zu zahlen|total|betrag|geg\.|gegeben|ec-?karte|girocard|kartenzahlung|karte|visa|"
    r"mastercard|maestro|bar\b|rueckgeld|ruckgeld|mwst|netto|brutto|steuer|ust|tse|beleg|bon-?nr|kasse|uhrzeit|datum|"
    r"payback|punkte|coupon|rabatt gesamt|kundenbeleg|terminal|trace|genehmigung)",
    re.I,
)
TOTAL = re.compile(r"(summe|gesamt|zu zahlen|total|betrag)", re.I)
PRICE_END = re.compile(r"(-?\d{1,3}[.,]\s?\d{2})\s*(?:€|eur|euro)?\s*(?:[a-z*]{1,2}|\d)?\s*$", re.I)
LETTERS3 = re.compile(r"[a-zäöüß]{3,}", re.I)
LETTERS2 = re.compile(r"[a-zäöüß]{2,}", re.I)
WEIGHT_LINE = re.compile(r"^\s*[-\d.,]*\s*(kg|x|stk|st|€/kg|eur/kg)\b", re.I)
QTY_LINE = re.compile(r"^\d+\s*x\b", re.I)
PFAND = re.compile(r"(pfand|leergut|einweg|mehrweg)", re.I)
NOT_PRODUCT = re.compile(r"(tel|fax|str\b|strasse|www|uid|ust|filiale|markt\s*nr|plz)", re.I)


def fix_ocr(s):
    """Common OCR slips inside product names: 1l0er -> 10er, IL -> 1L."""
    s = re.sub(r"(\d)[lI|](\d)", r"\g<1>1\g<2>", str(s))
    s = re.sub(r"\b[Iil|](L|l|kg|Kg|KG)\b", r"1\1", s)
    return re.sub(r"\b[Il|]0er\b", "10er", s)


def _one_char_apart(a, b):
    return len(a) == len(b) and sum(1 for x, y in zip(a, b) if x != y) == 1


def parse_receipt(text):
    """Return {store, date, total, items: [{name, price, pfand, flag, ocrPrice?}]}."""
    lines = [re.sub(r"\s+", " ", l).strip() for l in re.split(r"\r?\n", str(text or ""))]
    lines = [l for l in lines if l]
    store, date, total, items, pending, ended = "", "", None, [], None, False

    for line in lines[:6]:
        ln = norm(line)
        if any(re.search(r"\b" + re.escape(s) + r"\b", ln) for s in STORES):
            store = line
            break

    dm = re.search(r"(\d{2})[./](\d{2})[./](\d{2,4})", str(text or ""))
    if dm:
        year = dm.group(3)
        date = f"{dm.group(1)}.{dm.group(2)}.{'20' + year if len(year) == 2 else year}"

    for line in lines:
        if ended:
            break
        m = PRICE_END.search(line)
        if TOTAL.search(line) and m:
            total = abs(num(m.group(1)))
            ended = True
            continue
        if SKIP.search(line):
            pending = None
            continue
        if m:
            name = re.sub(r"[\s:.*]+$", "", line[: m.start()]).strip()
            price = num(m.group(1))
            weightish = bool(WEIGHT_LINE.search(name) or QTY_LINE.search(name) or not LETTERS3.search(name))
            if weightish and pending:
                w = re.search(r"(\d+[.,]\d+)\s*kg", name, re.I)
                name = pending + (" " + w.group(1) + "kg" if w and not pack_size(pending) else "")
            pending = None
            if not LETTERS2.search(name):
                continue
            items.append({"name": fix_ocr(name), "price": price, "pfand": bool(PFAND.search(name)), "flag": ""})
            continue
        # A line with a name but no readable price
        if LETTERS3.search(line):
            if (re.search(r"(?:^|\s)\d{3,4}\s*[a-z]?\s*$", line, re.I) and not NOT_PRODUCT.search(line)
                    and re.search(r"[a-zäöüß]{3,}.*\s\d{3,4}\s*[a-z]?\s*$", line, re.I)):
                name = re.sub(r"\s*\d{3,4}\s*[a-z]?\s*$", "", line, flags=re.I).strip()
                items.append({"name": fix_ocr(name), "price": None, "pfand": False, "flag": "unreadable"})
                pending = None
            else:
                pending = line

    # If exactly one price is missing and the total is known, the gap is that price.
    missing = [it for it in items if it["price"] is None]
    if total is not None and len(missing) == 1:
        known = sum(it["price"] or 0 for it in items)
        gap = round2(total - known)
        if gap > 0:
            missing[0]["price"] = gap
            missing[0]["flag"] = "from-total"

    # If the items don't add up to the printed total, look for one price where a
    # single misread digit explains the gap (e.g. 6,25 read for 0,25).
    if total is not None:
        s = round2(sum(it["price"] or 0 for it in items))
        diff = round2(s - total)
        if abs(diff) >= 0.01:
            cands = []
            for it in items:
                if it["price"] is None or it["flag"]:
                    continue
                fixed = round2(it["price"] - diff)
                if fixed > 0 and _one_char_apart(f"{it['price']:.2f}", f"{fixed:.2f}"):
                    cands.append(it)
            if len(cands) == 1:
                c = cands[0]
                c["ocrPrice"] = c["price"]
                c["price"] = round2(c["price"] - diff)
                c["flag"] = "corrected"

    if not store and lines:
        store = lines[0]
    return {"store": store, "date": date, "items": items, "total": total}
