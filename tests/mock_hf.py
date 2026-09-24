"""A stand-in for Hugging Face's /v1/chat/completions, for tests.
The model name decides how it behaves."""

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

RECEIPT = {
    "store": "REWE", "date": "23.09.2026", "currency": "EUR", "language": "German", "total": 12.26,
    "items": [
        {"raw": "Bio Eier 10er", "en": "Organic eggs 10", "price": 2.79, "deposit": False, "category": "Dairy"},
        {"raw": "Butter 250g", "en": "Butter 250 g", "price": 2.29, "deposit": False, "category": "Dairy"},
        {"raw": "Coca Cola 1,5L", "en": "Coca-Cola 1.5 l", "price": 1.89, "deposit": False, "category": "Drinks"},
        {"raw": "Pfand", "en": "Bottle deposit", "price": 0.25, "deposit": True, "category": "Pfand"},
        {"raw": "Rinderhack 500g", "en": "Minced beef 500 g", "price": 5.04, "deposit": False, "category": "Meat & fish",
         "cheaper": {"name": "discounter minced beef 500 g", "price": 3.99}},
    ],
    "tips": ["Buy store-brand butter to save about €1 a week."],
}

# The adidas employee-sale receipt: (name, price before discount, price paid, employee-discount amount)
ADIDAS_LINES = [("VL COURT 2.0 FTW", 45.00, 22.05, 9.45), ("VL COURT 2.0 CREW", 45.00, 22.05, 9.45),
                ("3S TEE DKB", 23.00, 11.27, 4.83), ("M 3S SJ T WHI", 19.00, 9.31, 3.99),
                ("M 3S FT SHO LEG", 21.00, 10.29, 4.41), ("SST TT BLA", 52.00, 25.48, 10.92),
                ("ESS PANTS FT BLA", 38.00, 18.62, 7.98), ("NEU C HD BLA", 52.00, 25.48, 10.92)]


def adidas(correct):
    items = [{"raw": n, "en": n, "price": paid if correct else disc, "original": orig if correct else None,
              "deposit": False, "category": "Clothing & shoes"} for n, orig, paid, disc in ADIDAS_LINES]
    items.append({"raw": "Paper Bag", "en": "Paper bag", "price": 0.30, "deposit": False, "category": "Other"})
    return {"store": "adidas Herzogenaurach", "date": "05.09.2026", "currency": "EUR", "total": 144.85, "items": items, "tips": []}


calls = []


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _reply(self, status, obj):
        body = json.dumps(obj).encode() if not isinstance(obj, bytes) else obj
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        model = req["model"]
        parts = req["messages"][-1]["content"]
        has_image = isinstance(parts, list) and any(p.get("type") == "image_url" for p in parts)
        calls.append({"model": model, "auth": self.headers.get("Authorization"), "image": has_image,
                      "check": "printed total on the receipt is" in json.dumps(req["messages"][-1])})
        if "bad-key" in model:
            return self._reply(401, {"error": "Invalid credentials in Authorization header"})
        if "no-credit" in model:
            return self._reply(402, {"error": "You have exceeded your monthly included credits for Inference Providers."})
        if "busy" in model:
            return self._reply(429, {"error": {"message": "Rate limit reached"}})
        if "missing" in model:
            return self._reply(400, {"error": {"message": "The requested model 'x' is not supported by any provider you have enabled."}})
        if "slow" in model:
            time.sleep(3)
        text = json.dumps(RECEIPT)
        asked_to_check = "printed total on the receipt is" in json.dumps(req["messages"][-1])
        if "adidas" in model:
            # "adidas-learns": wrong first, right after the self-check; "adidas-stubborn": always wrong
            text = json.dumps(adidas(asked_to_check and "learns" in model))
        if "junk" in model:
            text = "Sorry, I cannot help with that."
        elif "fenced" in model:
            text = "Here you go:\n```json\n" + text + "\n```"
        elif "cut" in model:
            text = text[: text.index('{"raw": "Rinderhack')] + '{"raw": "Rinderh'
        elif "think" in model:
            text = "<think>let me read the lines {not json}</think>" + text
        elif "notreceipt" in model:
            text = '{"notReceipt": "a photo of a cat"}'
        return self._reply(200, {"choices": [{"message": {"role": "assistant", "content": text}}]})


def start():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, "http://127.0.0.1:%d/v1" % srv.server_address[1]
