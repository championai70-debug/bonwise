import json
import sqlite3
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import app
from bonwise import config, storage


class StatsTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        storage.reset_for_tests(self.dir)
        app.stats_limiter = app.RateLimiter(100)
        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.base = "http://127.0.0.1:%d" % self.srv.server_address[1]

    def tearDown(self):
        self.srv.shutdown()
        config.STATS_KEY = ""

    def call(self, path, body=None, headers=None):
        req = urllib.request.Request(self.base + path, data=None if body is None else json.dumps(body).encode(),
                                     method="GET" if body is None else "POST",
                                     headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0 test", **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    def test_only_daily_totals_are_stored(self):
        self.call("/")
        self.call("/")
        self.call("/api/health", headers={"X-Lang": "de"})
        self.call("/api/trip", {"text": "milk"})
        self.call("/", headers={"User-Agent": "curl/8.5"})                    # keep-awake: not counted
        self.call("/", headers={"User-Agent": "Bonwise monitor (GitHub Actions)"})
        today = list(storage.stats(1).values())[0]
        self.assertEqual(today["open"], 2)
        self.assertEqual(today["lang.de"], 1)
        self.assertEqual(today["trip"], 1)
        storage._db().commit()
        with sqlite3.connect(str(Path(self.dir) / "bonwise.db")) as db:
            cols = [r[1] for r in db.execute("PRAGMA table_info(stats)")]
        self.assertEqual(cols, ["day", "key", "n"])                             # nothing about the visitor

    def test_page_needs_the_key(self):
        self.assertEqual(self.call("/api/stats", {})[0], 404)                  # off without STATS_KEY
        config.STATS_KEY = "a-long-secret"
        self.assertEqual(self.call("/api/stats", {}, {"X-Stats-Key": "wrong"})[0], 403)
        self.call("/")
        s, body = self.call("/api/stats", {}, {"X-Stats-Key": "a-long-secret"})
        self.assertEqual(s, 200)
        self.assertEqual(list(json.loads(body)["days"].values())[0]["open"], 1)
        self.assertIn(b"Bonwise usage", self.call("/stats")[1])

    def test_bad_keys_are_ignored(self):
        storage.count("drop table; --")
        self.assertEqual(storage.stats(1), {})
