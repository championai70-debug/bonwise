"""Scanning pipeline: AI reader first, Tesseract + rule-based parser as backup,
then savings advice on whatever was read."""

import base64
import binascii
import time

from . import ai_reader, config, ocr
from .advisor import advise_receipt
from .parser import parse_receipt


class ScanError(Exception):
    def __init__(self, code, message, status=422):
        super().__init__(code)
        self.code = code
        self.message = message
        self.status = status


def _from_parsed(parsed, reader):
    return {
        "store": parsed["store"], "date": parsed["date"], "total": parsed["total"], "currency": "EUR",
        "reader": reader, "model": "", "tips": [],
        "items": [{"raw": it["name"], "price": it["price"], "ocrPrice": it.get("ocrPrice"),
                   "pfand": it["pfand"], "flag": it["flag"]} for it in parsed["items"]],
    }


def _finish(receipt, started, notice=""):
    out = advise_receipt(receipt)
    out["seconds"] = round(time.monotonic() - started, 1)
    return {"receipt": out, "notice": notice}


def scan_image(image_b64, media_type="image/jpeg", context=None, use_ai=True):
    started = time.monotonic()
    try:
        image_bytes = base64.b64decode(image_b64, validate=True)
    except (binascii.Error, ValueError, TypeError):
        raise ScanError("bad_image", "That photo couldn't be opened. Try a JPEG or PNG.", 400)
    if not image_bytes:
        raise ScanError("bad_image", "That photo couldn't be opened. Try a JPEG or PNG.", 400)

    notice = ""
    if use_ai and config.HF_TOKEN:
        try:
            return _finish(ai_reader.read_receipt(image_b64=image_b64, media_type=media_type, context=context), started)
        except ai_reader.NotReceipt as e:
            raise ScanError("not_receipt", "No receipt found in that photo: %s. Try a sharper photo taken straight on." % e)
        except ai_reader.AIError as e:
            notice = e.describe() + " This receipt was read by the backup reader (Tesseract OCR) instead."
    elif use_ai:
        notice = "The AI reader isn't set up on this server yet, so the backup reader (Tesseract OCR) read this receipt."

    try:
        text = ocr.read_text(image_bytes)
    except ocr.OCRError as e:
        if e.args and e.args[0] == "bad_image":
            raise ScanError("bad_image", "That photo couldn't be opened. Try a JPEG or PNG.", 400)
        raise ScanError("ocr_failed", (notice + " " if notice else "") +
                        "The backup reader couldn't read it either. Paste the receipt lines as text instead.", 503)
    parsed = parse_receipt(text)
    if not parsed["items"]:
        raise ScanError("no_items", (notice + " " if notice else "") +
                        "Couldn't find any products with prices in that photo. Try a sharper, well-lit photo "
                        "taken straight on, or paste the lines as text.")
    result = _finish(_from_parsed(parsed, "ocr"), started, notice)
    result["ocrText"] = text[:6000]
    return result


def scan_text(text, context=None, use_ai=True):
    started = time.monotonic()
    text = str(text or "").strip()[:6000]
    if not text:
        raise ScanError("empty", "Paste or type a few lines from the receipt first, e.g. “Butter 250g 2,29”.", 400)
    notice = ""
    if use_ai and config.HF_TOKEN:
        try:
            r = ai_reader.read_receipt(text=text, context=context)
            r["reader"] = "ai-text"
            return _finish(r, started)
        except ai_reader.NotReceipt as e:
            raise ScanError("not_receipt", "That doesn't look like a receipt: %s." % e)
        except ai_reader.AIError as e:
            notice = e.describe() + " The lines were read by the built-in parser instead."
    elif use_ai:
        notice = "The AI reader isn't set up on this server yet, so the built-in parser read these lines."
    parsed = parse_receipt(text)
    if not parsed["items"]:
        raise ScanError("no_items", (notice + " " if notice else "") +
                        "Couldn't find products with prices. Put one product per line with its price, "
                        "e.g. “Butter 250g 2,29”.")
    return _finish(_from_parsed(parsed, "text"), started, notice)


def health():
    return {
        "ok": True,
        "aiReader": bool(config.HF_TOKEN),
        "models": config.MODELS,
        "backupReader": ocr.available(),
        "ocrLanguages": ocr.languages() if ocr.available() else "",
    }
