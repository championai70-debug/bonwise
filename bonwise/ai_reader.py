"""AI receipt reader: sends the photo (or pasted text) to an open multimodal
model on Hugging Face Inference Providers and returns the line items.

The endpoint is OpenAI-compatible: POST {HF_BASE_URL}/chat/completions with
Authorization: Bearer <HF_TOKEN>. Models are tried in order until one answers
with usable JSON.
"""

import json
import re
import socket
import time
import urllib.error
import urllib.request

from . import config

INSTRUCTIONS = (
    "You read shop receipts for a money-saving app used in Germany. The receipt can be in any language or script.\n"
    "Return: store (shop name), date (DD.MM.YYYY if visible, else \"\"), currency (ISO code, e.g. EUR), language (of the receipt), "
    "total (the printed total as a number, or null), and items: every purchased line in order.\n"
    "For each item give: raw (product text exactly as printed, original script), en (short plain-English product name with pack size if shown, e.g. \"Whole milk 1 l\"), "
    "price (the line total as a number; negative for discounts or bottle returns; null if unreadable), deposit (true for bottle-deposit/Pfand lines), "
    "category (one of Dairy, Bakery, Fruit & veg, Meat & fish, Pantry, Drinks, Snacks, Household, Drugstore, Clothing & shoes, Electronics, Pfand, Other), and, only when a clearly cheaper "
    "equivalent is commonly sold in Germany (store brand, Aldi/Lidl, dm/Rossmann own brand, or the same product from a cheaper shop or outlet), cheaper: {name, price} with its typical price in EUR for the same pack size (approximate). "
    "Omit cheaper when the price already looks like a discounter price or for deposit lines.\n"
    "Skip subtotal, tax, payment and change lines. If quantity x unit price is printed, use the line total.\n"
    "Discounts: many receipts print a price before discount, then discount lines under the item (e.g. \"Back to School 30% off -13,50\", "
    "\"Employee Discount -9,45\", \"Rabatt\", \"Aktion\", \"TTD (-22,95)\"). An item's price is the final amount actually paid for that item "
    "after all its discounts (often the \"Selling Price\" / \"Verkaufspreis\" column). Never use a discount amount as an item price, and do not "
    "list those discount lines as separate items when the item's final price already includes them. Put the price before discounts in original "
    "(null if there was no discount). Only list a discount as its own item (with a negative price) when it applies to the whole receipt and isn't "
    "already included in the item prices.\n"
    "Check before answering: the item prices must add up to the printed total. If they don't, re-read the receipt and fix the prices.\n"
    "Also give tips: 2 or 3 short, concrete sentences (with approximate EUR amounts) on how this shopper could spend less on this kind of shop, given the budget context below.\n"
    "Reply with only JSON, no other text: "
    '{"store":"","date":"","currency":"EUR","language":"","total":0,"items":[{"raw":"","en":"","price":0,"original":null,"deposit":false,"category":"","cheaper":{"name":"","price":0}}],"tips":[""]}. '
    'If this is not a receipt, reply {"notReceipt":"short reason"}.'
)

SYSTEM = "You are a receipt reader. Reply with one JSON object only: no explanations, no markdown."

MESSAGES = {
    "not_configured": "The AI reader isn't set up on this server (no HF_TOKEN).",
    "bad_key": "Hugging Face rejected the token. Check HF_TOKEN and that it may call Inference Providers.",
    "no_credit": "The Hugging Face account has used up its free monthly credits.",
    "busy": "The AI model is busy or rate-limited right now.",
    "no_model": "That AI model isn't available on Hugging Face right now.",
    "timeout": "The AI model took too long.",
    "network": "Hugging Face couldn't be reached.",
    "bad_response": "The AI answer couldn't be read.",
    "upstream": "The AI service had a problem.",
    "no_items": "The AI found no products with prices.",
}


class AIError(Exception):
    def __init__(self, code, message="", model=""):
        super().__init__(code)
        self.code = code
        self.message = message
        self.model = model

    def describe(self):
        text = MESSAGES.get(self.code, "The AI reader didn't work.")
        if self.message and self.code not in ("not_configured", "timeout"):
            text += " (Hugging Face said: " + self.message[:200] + ")"
        return text


class NotReceipt(Exception):
    pass


# ---------- JSON extraction (models don't always reply with clean JSON) ----------

def _try_parse(s):
    for candidate in (s, re.sub(r",\s*([}\]])", r"\1", s)):
        try:
            return json.loads(candidate)
        except (ValueError, TypeError):
            pass
    return None


def _repair_cut(s):
    """Close a JSON answer that was cut off part-way, keeping every complete item."""
    stack, in_str, esc, last_safe, safe_stack = [], False, False, -1, None
    for k, c in enumerate(s):
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
            continue
        if c == '"':
            in_str = True
        elif c in "{[":
            stack.append(c)
        elif c in "}]":
            if stack:
                stack.pop()
            last_safe, safe_stack = k + 1, list(stack)
    if last_safe < 0:
        return None
    body = re.sub(r",\s*$", "", s[:last_safe])
    for opener in reversed(safe_stack):
        body += "}" if opener == "{" else "]"
    return _try_parse(body)


def extract_json(text):
    t = str(text or "").strip()
    # Some models think out loud first
    t = re.sub(r"<think>[\s\S]*?</think>", "", t).strip()
    r = _try_parse(t)
    if isinstance(r, dict):
        return r
    f = re.search(r"```(?:json)?\s*([\s\S]*?)(```|$)", t)
    if f:
        r = _try_parse(f.group(1).strip())
        if isinstance(r, dict):
            return r
        t = f.group(1).strip()
    a = t.find("{")
    if a == -1:
        return None
    b = t.rfind("}")
    if b > a:
        r = _try_parse(t[a:b + 1])
        if isinstance(r, dict):
            return r
    r = _repair_cut(t[a:])
    return r if isinstance(r, dict) else None


def _message_text(msg):
    if not msg:
        return ""
    c = msg.get("content")
    if isinstance(c, list):
        c = "".join(x if isinstance(x, str) else (x or {}).get("text", "") for x in c)
    c = str(c or "")
    if not c.strip():
        c = str(msg.get("reasoning_content") or msg.get("reasoning") or "")
    return c


# ---------- the call ----------

def _context_line(ctx):
    ctx = ctx if isinstance(ctx, dict) else {}

    def n(key):
        try:
            return float(ctx.get(key) or 0)
        except (TypeError, ValueError):
            return 0.0

    return ("\nBudget context: monthly spending budget %g EUR, already spent %g EUR this month before this receipt, "
            "today is day %d of %d." % (n("budget"), n("spent"), n("day"), n("daysInMonth")))


def _build_messages(image_b64=None, media_type="image/jpeg", text=None, context=None):
    prompt = INSTRUCTIONS + _context_line(context)
    if text:
        prompt += "\n\nThe receipt was typed or pasted as text (it may have typos):\n" + text[:6000]
    parts = []
    if image_b64:
        parts.append({"type": "image_url", "image_url": {"url": "data:%s;base64,%s" % (media_type, image_b64)}})
    parts.append({"type": "text", "text": prompt})
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": parts}]


def _error_code(status, message):
    if status in (401, 403):
        return "bad_key"
    if status == 402 or re.search(r"(exceeded|depleted|credits|payment required|pre-paid)", message, re.I):
        return "no_credit"
    if status == 404 or re.search(r"(not supported|no provider|does not exist|not found)", message, re.I):
        return "no_model"
    if status in (429, 503):
        return "busy"
    return "upstream"


def call_model(model, messages, timeout):
    body = json.dumps({"model": model, "messages": messages, "temperature": 0, "max_tokens": 4000}).encode()
    req = urllib.request.Request(
        config.HF_BASE_URL + "/chat/completions", data=body, method="POST",
        headers={"Authorization": "Bearer " + config.HF_TOKEN, "Content-Type": "application/json",
                 "User-Agent": "bonwise/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            data = json.loads(res.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        message = raw
        try:
            j = json.loads(raw)
            err = j.get("error", j)
            message = err.get("message") if isinstance(err, dict) else str(err)
        except ValueError:
            pass
        message = re.sub(r"\s+", " ", str(message or "")).strip()[:300]
        raise AIError(_error_code(e.code, message), message, model)
    except (socket.timeout, TimeoutError):
        raise AIError("timeout", "", model)
    except urllib.error.URLError as e:
        if isinstance(e.reason, (socket.timeout, TimeoutError)):
            raise AIError("timeout", "", model)
        raise AIError("network", str(e.reason)[:200], model)
    except ValueError:
        raise AIError("bad_response", "", model)
    if isinstance(data, dict) and data.get("error"):
        err = data["error"]
        message = err.get("message") if isinstance(err, dict) else str(err)
        raise AIError(_error_code(0, str(message)), str(message)[:300], model)
    choice = ((data or {}).get("choices") or [{}])[0]
    return _message_text(choice.get("message"))


def _clean(res, model):
    items = []
    for it in (res.get("items") or [])[:150]:
        if not isinstance(it, dict) or not (it.get("raw") or it.get("en")):
            continue
        try:
            price = round(float(it.get("price")), 2) if it.get("price") is not None else None
        except (TypeError, ValueError):
            price = None
        try:
            original = round(float(it.get("original")), 2) if it.get("original") is not None else None
        except (TypeError, ValueError):
            original = None
        if original is not None and (price is None or original <= price):
            original = None
        raw = str(it.get("raw") or it.get("en"))[:120]
        items.append({
            "raw": raw, "en": str(it.get("en") or "")[:80], "price": price, "original": original,
            "pfand": bool(it.get("deposit")) or bool(re.search(r"pfand|deposit", raw, re.I)),
            "cat": str(it.get("category") or "")[:24],
            "cheaper": it.get("cheaper") if isinstance(it.get("cheaper"), dict) else None,
        })
    try:
        total = float(res["total"]) if res.get("total") is not None else None
    except (TypeError, ValueError):
        total = None
    return {
        "store": str(res.get("store") or "")[:80], "date": str(res.get("date") or "")[:20], "total": total,
        "currency": str(res.get("currency") or "EUR")[:5], "language": str(res.get("language") or "")[:30],
        "tips": [str(t)[:300] for t in (res.get("tips") or []) if t][:3] if isinstance(res.get("tips"), list) else [],
        "items": items, "reader": "ai", "model": model,
    }


CHECK = ("Your item prices add up to %.2f, but the printed total on the receipt is %.2f. Look at the receipt again. "
         "Common mistakes: using a discount amount (e.g. an employee or promotion discount) as an item price instead of the final "
         "price paid, listing discount lines that are already included in an item's price, or missing or doubling a line. "
         "Reply with the complete corrected JSON only.")


def total_gap(r):
    """How far the item prices are from the printed total (0 when no total was read)."""
    if r.get("total") is None:
        return 0.0
    return abs(round(sum(it["price"] or 0 for it in r["items"]) - r["total"], 2))


def adds_up(r):
    return total_gap(r) <= max(0.05, 0.005 * abs(r.get("total") or 0))


def read_receipt(image_b64=None, media_type="image/jpeg", text=None, context=None, models=None):
    """Try each model in turn. When the item prices don't add up to the printed total, the model is shown
    the difference and asked to check again. Returns a receipt dict; raises AIError or NotReceipt."""
    if not config.HF_TOKEN:
        raise AIError("not_configured")
    messages = _build_messages(image_b64, media_type, text, context)
    deadline = time.monotonic() + config.AI_TOTAL_TIMEOUT
    last, best = AIError("upstream"), None

    def keep(candidate):
        nonlocal best
        if best is None or total_gap(candidate) < total_gap(best):
            best = candidate

    for model in models or config.MODELS:
        left = deadline - time.monotonic()
        if left < 5:
            break
        try:
            reply = call_model(model, messages, min(config.MODEL_TIMEOUT, left))
        except AIError as e:
            last = e
            if e.code in ("bad_key", "no_credit"):
                if best:
                    break
                raise  # the next model would fail the same way
            continue
        res = extract_json(reply)
        if res and res.get("notReceipt"):
            if best:
                break
            raise NotReceipt(str(res["notReceipt"])[:200])
        if not res or not isinstance(res.get("items"), list):
            last = AIError("bad_response", reply[:200], model)
            continue
        cleaned = _clean(res, model)
        if not cleaned["items"]:
            last = AIError("no_items", "", model)
            continue
        if adds_up(cleaned):
            return cleaned
        keep(cleaned)

        # Self-check: show the model its sum vs the printed total and ask it to fix the prices.
        left = deadline - time.monotonic()
        if left < 8:
            break
        item_sum = sum(it["price"] or 0 for it in cleaned["items"])
        retry = messages + [{"role": "assistant", "content": reply},
                            {"role": "user", "content": CHECK % (item_sum, cleaned["total"])}]
        try:
            reply2 = call_model(model, retry, min(config.MODEL_TIMEOUT, left))
        except AIError as e:
            last = e
            if e.code in ("bad_key", "no_credit"):
                break
            continue
        res2 = extract_json(reply2)
        if res2 and isinstance(res2.get("items"), list):
            fixed = _clean(res2, model)
            if fixed["items"]:
                if fixed["total"] is None:
                    fixed["total"] = cleaned["total"]
                fixed["selfChecked"] = True
                if adds_up(fixed):
                    return fixed
                keep(fixed)
    if best:
        best["totalMismatch"] = True
        return best
    raise last
