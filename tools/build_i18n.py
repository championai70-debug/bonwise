"""Build static/i18n.js from i18n/strings.tsv, and check that every text has translations.

Run:  python3 tools/build_i18n.py           build static/i18n.js
      python3 tools/build_i18n.py --check   list texts that are missing from the table or
                                            missing a translation (exit code 1 if any)
      python3 tools/build_i18n.py --add     append missing English texts to the table (empty translations)

The table (tab-separated, header row: en de tr ar hi) is the one place for all texts: the
app (static/app.js via t()/tn(), and the words on static/index.html; the same for the landing
page, static/welcome.js and welcome.html), the server's messages
(bonwise/i18n.py) and words from the price data (categories, product and shop kinds).
{name} parts are filled in by the code; translations must keep them.
"""
import csv
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from bonwise import data, footprint, i18n, places  # noqa: E402

TABLE = ROOT / "i18n" / "strings.tsv"
OUT = ROOT / "static" / "i18n.js"
HEADER = ["en"] + i18n.LANGS


# ---------- texts used by the app ----------

def _literal_end(src, i):
    q = src[i]
    j = i + 1
    while src[j] != q:
        j += 2 if src[j] == "\\" else 1
    return j


def js_texts(src):
    """String literals passed to t() and tn() (not the {values} object, not comparisons)."""
    out = []
    for m in re.finditer(r"(?<![\w.$])(t|tn)\(", src):
        i, depth, braces = m.end(), 1, 0
        while depth and i < len(src):
            c = src[i]
            if c in "\"'":
                j = _literal_end(src, i)
                before = src[max(0, i - 5):i]
                if braces == 0 and depth == 1 and not re.search(r"[!=]==\s*$", before):
                    out.append(json.loads('"' + src[i + 1:j].replace('\\"', '"').replace('"', '\\"') + '"') if c == '"' else src[i + 1:j])
                i = j
            elif c == "(":
                depth += 1
            elif c == ")":
                depth -= 1
            elif c == "{":
                braces += 1
            elif c == "}":
                braces -= 1
            i += 1
    return out


class _Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.texts, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.skip += 1
        for k, v in attrs:
            if k in ("placeholder", "aria-label", "title", "alt") and v and "\n" not in v and re.search(r"[A-Za-z]{2}", v):
                self.texts.append(v.strip())

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.skip -= 1

    def handle_data(self, d):
        t = re.sub(r"\s+", " ", d).strip()
        if not self.skip and re.search(r"[A-Za-z]{2}", t):
            self.texts.append(t)


def page_texts(html):
    p = _Page()
    p.feed(html[html.index("<body"):])
    # Placeholders the app replaces at once (month, zero amounts) need no translation.
    skip = {"Bonwise", "BW-XXXX-XXXX-XXXX", "0.00", "September 2026", "0% less", "~0 kg CO₂e"}
    return [x for x in p.texts if x not in skip and not x.startswith("€")]


def data_words():
    """Words the app shows from the server's data: categories, product names, shop kinds."""
    words = set(data.FOOD) | set(data.NON_FOOD) | {"Other", "Pfand", "Clothing & shoes", "Electronics", "Shop"}
    words |= {g["en"] for g in data.GUIDE} | {e[1] for e in data.EXTRA_ITEMS}
    words |= set(places.KINDS.values()) | {n for n, _ in footprint.SWAPS.values()}
    return sorted(words)


def server_texts():
    """Fixed texts the server sends (messages, notices, hints). Sentences with values in them
    are table entries with {placeholders}; see bonwise/i18n.py."""
    out = set()
    for f in [ROOT / "app.py"] + sorted((ROOT / "bonwise").glob("*.py")):
        src = f.read_text(encoding="utf-8")
        for rx in (r'"message":\s*"((?:[^"\\]|\\.)+)"', r'(?:ScanError|HouseholdError)\(\s*"\w+",\s*"((?:[^"\\]|\\.)+)"',
                   r'notice = "((?:[^"\\]|\\.)+)"'):
            for m in re.finditer(rx, src):
                if "%s" not in m.group(1) and "%d" not in m.group(1):
                    out.add(m.group(1))
    out |= set(data.CHEAPEST_AT.values()) | {g["alt"] for g in data.GUIDE} | {f[2] for f in data.FASHION}
    out |= {"discounters (Aldi, Lidl, Penny, Netto)"}
    from bonwise import ai_reader
    out |= set(ai_reader.MESSAGES.values())
    return sorted(out)


def all_texts():
    js = js_texts((ROOT / "static" / "app.js").read_text(encoding="utf-8"))
    js += js_texts((ROOT / "static" / "welcome.js").read_text(encoding="utf-8"))
    page = page_texts((ROOT / "static" / "index.html").read_text(encoding="utf-8"))
    page += page_texts((ROOT / "static" / "welcome.html").read_text(encoding="utf-8"))
    return list(dict.fromkeys(js + page + data_words() + server_texts()))


# ---------- the table ----------

def read_table():
    rows = {}
    with open(TABLE, encoding="utf-8", newline="") as f:
        for row in csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE):
            if row and row[0] != "en" and not row[0].startswith("#"):
                rows[row[0]] = (row[1:] + [""] * 4)[:4]
    return rows


def build():
    table = read_table()
    payload = {"langs": i18n.LANGS, "t": {k: v for k, v in table.items() if any(v)}}
    OUT.write_text("/* Made by tools/build_i18n.py from i18n/strings.tsv. Don't edit here. */\n"
                   "window.BW_I18N = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n",
                   encoding="utf-8")
    return payload


def problems():
    table = read_table()
    missing = [t for t in all_texts() if t not in table]
    untranslated = [k for k, v in table.items() if not all(v)]
    bad = []
    for k, v in table.items():
        want = sorted(re.findall(r"\{\w+\}", k))
        for lang, tr in zip(i18n.LANGS, v):
            if tr and sorted(re.findall(r"\{\w+\}", tr)) != want:
                bad.append("%s [%s]: %s" % (k, lang, tr))
            if tr and re.findall(r"</?\w+", tr) and sorted(re.findall(r"</?\w+", tr)) != sorted(re.findall(r"</?\w+", k)):
                bad.append("tags differ %s [%s]" % (k, lang))
    return missing, untranslated, bad


def main():
    if "--add" in sys.argv:
        missing, _, _ = problems()
        with open(TABLE, "a", encoding="utf-8") as f:
            for t in missing:
                f.write(t + "\t\t\t\t\n")
        print("added", len(missing))
        return
    if "--check" in sys.argv:
        missing, untranslated, bad = problems()
        for label, items in (("not in the table", missing), ("missing a translation", untranslated), ("placeholders/tags differ", bad)):
            if items:
                print("%d texts %s:" % (len(items), label))
                for x in items[:40]:
                    print("  " + x)
        sys.exit(1 if (missing or untranslated or bad) else 0)
    p = build()
    print("static/i18n.js: %d texts, %.0f kB" % (len(p["t"]), OUT.stat().st_size / 1024))


if __name__ == "__main__":
    main()
