"""Languages for what the server says: error messages, notices, tips and hints.

The app and the server share one table, i18n/strings.tsv (English, German, Turkish,
Arabic, Hindi). The server writes English; translate_payload() turns the texts of an
answer into the visitor's language just before it is sent. Sentences with numbers or
names in them are table entries with {placeholders} ("Try {alt} — typically about
{amount}"), matched as patterns, and the parts filled in are translated too.
"""

import csv
import re
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TABLE_PATH = ROOT / "i18n" / "strings.tsv"
LANGS = ["de", "tr", "ar", "hi"]           # besides English
NAMES = {"en": "English", "de": "German", "tr": "Turkish", "ar": "Arabic", "hi": "Hindi"}
FIELDS = {"message", "notice", "tip", "hint", "alt"}   # answer fields that hold text for people

_local = threading.local()
_lock = threading.Lock()
_table = None
_patterns = None


def load_table(path=None):
    """{english: [de, tr, ar, hi]} from the tab-separated table (header row first)."""
    out = {}
    with open(path or TABLE_PATH, encoding="utf-8", newline="") as f:
        rows = csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE)
        next(rows, None)
        for row in rows:
            if row and row[0] and not row[0].startswith("#"):
                out[row[0]] = (row[1:] + [""] * 4)[:4]
    return out


def _load():
    global _table, _patterns
    with _lock:
        if _table is None:
            try:
                _table = load_table()
            except OSError:
                _table = {}
            pats = []
            for key in _table:
                if "{" in key:
                    names = re.findall(r"\{(\w+)\}", key)
                    rx = "^" + re.sub(r"\\\{(\w+)\\\}", "(.+?)", re.escape(key)) + "$"
                    pats.append((re.compile(rx, re.S), key, names))
            pats.sort(key=lambda p: -len(p[1]))   # the most specific pattern first
            _patterns = pats
    return _table, _patterns


def set_lang(header_lang="", accept=""):
    """The language for this request: X-Lang from the app, else the browser's Accept-Language."""
    lang = (header_lang or "").strip().lower()[:2]
    if lang not in NAMES:
        lang = "en"
        for part in (accept or "").split(","):
            code = part.split(";")[0].strip().lower()[:2]
            if code == "ur":
                code = "hi"
            if code in NAMES:
                lang = code
                break
    _local.lang = lang
    return lang


def lang():
    return getattr(_local, "lang", "en")


def _(text, **values):
    """One text in the current language (English when there is no translation yet)."""
    table, _p = _load()
    out = text
    if lang() != "en":
        row = table.get(text)
        if row and row[LANGS.index(lang())]:
            out = row[LANGS.index(lang())]
    for k, v in values.items():
        out = out.replace("{" + k + "}", str(v))
    return out


def translate(text):
    """A finished English sentence -> the current language, using the table's exact texts
    and its {placeholder} patterns. Unknown texts stay as they are."""
    if lang() == "en" or not isinstance(text, str) or not text:
        return text
    table, patterns = _load()
    i = LANGS.index(lang())
    row = table.get(text)
    if row:
        return _money(row[i] or text)
    for rx, key, names in patterns:
        m = rx.match(text)
        if m and table[key][i]:
            out = table[key][i]
            for name, value in zip(names, m.groups()):
                out = out.replace("{" + name + "}", translate(value))
            return _money(out)
    return text


def _money(text):
    """€1.79 -> 1,79 € in German, €1,79 in Turkish (the app shows prices the same way)."""
    if lang() == "de":
        return re.sub(r"€(\d+)\.(\d\d)\b", r"\1,\2 €", text)
    if lang() == "tr":
        return re.sub(r"€(\d+)\.(\d\d)\b", r"€\1,\2", text)
    return text


def translate_payload(obj):
    """Translate the people-facing texts in an answer (in place) and return it."""
    if lang() == "en":
        return obj
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in FIELDS and isinstance(v, str):
                obj[k] = translate(v)
            elif isinstance(v, (dict, list)):
                translate_payload(v)
    elif isinstance(obj, list):
        for v in obj:
            if isinstance(v, (dict, list)):
                translate_payload(v)
    return obj
