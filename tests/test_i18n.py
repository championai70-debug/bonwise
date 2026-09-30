import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import app
from bonwise import i18n, storage
from tools import build_i18n

ROOT = Path(__file__).resolve().parent.parent


class TableTests(unittest.TestCase):
    def test_every_text_is_translated(self):
        # Every t() text in app.js, every word on the page, the server's messages and data words
        # are in i18n/strings.tsv with German, Turkish, Arabic and Hindi, with the same {placeholders}.
        missing, untranslated, bad = build_i18n.problems()
        self.assertEqual(missing, [])
        self.assertEqual(untranslated, [])
        self.assertEqual(bad, [])

    def test_app_file_is_up_to_date(self):
        table = {k: v for k, v in build_i18n.read_table().items() if any(v)}
        text = (ROOT / "static" / "i18n.js").read_text(encoding="utf-8")
        built = json.loads(text[text.index("=") + 1:].rstrip().rstrip(";"))
        self.assertEqual(built["t"], table, "run python3 tools/build_i18n.py")


class TranslateTests(unittest.TestCase):
    def tearDown(self):
        i18n.set_lang("en")

    def test_language_choice(self):
        self.assertEqual(i18n.set_lang("de"), "de")
        self.assertEqual(i18n.set_lang("", "tr-TR,tr;q=0.9,en;q=0.8"), "tr")
        self.assertEqual(i18n.set_lang("", "ur-PK"), "hi")
        self.assertEqual(i18n.set_lang("xx", "fr-FR"), "en")

    def test_exact_and_pattern(self):
        i18n.set_lang("de")
        self.assertEqual(i18n.translate("Too many searches. Try again in a while."),
                         "Zu viele Suchen. Versuch es etwas später nochmal.")
        # A sentence with values: the pattern is found, the parts are translated too, € in German style.
        self.assertEqual(i18n.translate("Try store-brand butter — typically about €1.79"),
                         "Probier Eigenmarken-Butter – meist etwa 1,79 €")
        self.assertEqual(i18n.translate("Usually cheaper at dm or Rossmann."), "Meist günstiger: dm oder Rossmann.")
        self.assertEqual(i18n.translate("Something nobody wrote down"), "Something nobody wrote down")

    def test_payload_fields_only(self):
        i18n.set_lang("tr")
        body = {"message": "No photo was sent.", "name": "No photo was sent.", "items": [{"tip": "Try store-brand rice — typically about €1.69"}]}
        out = i18n.translate_payload(body)
        self.assertEqual(out["message"], "Fotoğraf gönderilmedi.")
        self.assertEqual(out["name"], "No photo was sent.")          # only people-facing fields
        self.assertTrue(out["items"][0]["tip"].startswith("market markası pirinç dene"))


class ServerLanguageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        storage.reset_for_tests(tempfile.mkdtemp())
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.srv.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def post(self, path, body, lang):
        req = urllib.request.Request(self.base + path, data=json.dumps(body).encode(), method="POST",
                                     headers={"Content-Type": "application/json", "X-Lang": lang})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_messages_in_the_chosen_language(self):
        self.assertEqual(self.post("/api/trip", {"text": ""}, "de")[1]["message"],
                         "Schreib, was du kaufen willst, z. B. „Milch, Brot, Cracker“.")
        self.assertEqual(self.post("/api/trip", {"text": ""}, "ar")[1]["message"],
                         "اكتب ما تريد شراءه، مثل «حليب، خبز، مقرمشات».")
        self.assertIn("Type what you want", self.post("/api/trip", {"text": ""}, "en")[1]["message"])

    def test_hints_and_tips_translated(self):
        s, j = self.post("/api/trip", {"text": "दूध, केले"}, "hi")
        self.assertEqual(s, 200)
        bananas = [it for it in j["items"] if it["name"] == "Bananas"][0]
        self.assertEqual(bananas["hint"], "डिस्काउंट दुकानें या पास की सब्ज़ी की दुकान")

    def test_compressed_when_asked(self):
        req = urllib.request.Request(self.base + "/static/i18n.js", headers={"Accept-Encoding": "gzip"})
        with urllib.request.urlopen(req) as r:
            self.assertEqual(r.headers.get("Content-Encoding"), "gzip")
            self.assertLess(len(r.read()), (ROOT / "static" / "i18n.js").stat().st_size / 2)
