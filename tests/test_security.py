import io
import json
import sqlite3
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from contextlib import redirect_stdout
from http.server import ThreadingHTTPServer
from pathlib import Path

import app
from bonwise import config, storage


class ClientKeyTests(unittest.TestCase):
    def test_faked_forwarded_for_is_ignored(self):
        # Render's proxy (private address) appends the real visitor on the right.
        self.assertEqual(app.client_key("10.1.2.3", "6.6.6.6, 81.2.3.4"), "81.2.3.4")
        self.assertEqual(app.client_key("10.1.2.3", "1.1.1.1, 2.2.2.2, 81.2.3.4, 162.158.1.1"), "81.2.3.4")
        self.assertEqual(app.client_key("10.1.2.3", "81.2.3.4"), "81.2.3.4")

    def test_direct_visitor_uses_connection_address(self):
        self.assertEqual(app.client_key("127.0.0.1", ""), "127.0.0.1")
        config.TRUST_FORWARDED = False
        try:
            self.assertEqual(app.client_key("81.2.3.4", "6.6.6.6"), "81.2.3.4")
        finally:
            config.TRUST_FORWARDED = True

    def test_ipv6_grouped_by_64(self):
        a = app.client_key("10.0.0.1", "2a02:8108:1:2:aaaa::1")
        b = app.client_key("10.0.0.1", "2a02:8108:1:2:bbbb::9")
        self.assertEqual(a, b)
        self.assertEqual(a, "2a02:8108:1:2::/64")

    def test_garbage_header(self):
        self.assertEqual(app.client_key("10.0.0.1", "not-an-ip"), "10.0.0.1")

    def test_limiter_never_resets_everyone(self):
        lim = app.RateLimiter(1)
        self.assertTrue(lim.allow("victim"))
        for i in range(20100):
            lim.allow("k%d" % i)
        self.assertFalse(lim.allow("victim"))


class HouseholdEncryptionTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        storage.reset_for_tests(self.dir)

    def tearDown(self):
        config.HOUSEHOLD_SECRET = ""

    def raw_rows(self):
        storage._db().commit()
        with sqlite3.connect(str(Path(self.dir) / "bonwise.db")) as db:
            return [r[0] for r in db.execute("SELECT data FROM households")]

    def test_data_is_encrypted_on_disk(self):
        code = storage.new_household()
        state = {"receipts": {"r1": {"store": "REWE Berlin", "items": [{"en": "Secret Butter", "price": 1.99}], "updated": 5}}}
        merged = storage.sync_household(code, state)
        self.assertEqual(merged["receipts"]["r1"]["store"], "REWE Berlin")
        rows = self.raw_rows()
        self.assertEqual(len(rows), 1)
        self.assertTrue(rows[0].startswith("e1:"))
        self.assertNotIn("Secret", rows[0])
        self.assertNotIn("REWE", rows[0])
        # Another phone with the same code reads it back.
        self.assertEqual(storage.sync_household(code, {})["receipts"]["r1"]["items"][0]["en"], "Secret Butter")

    def test_wrong_key_or_tampering_is_refused(self):
        sealed = storage.seal("ABCDEFGHJKLM", '{"a":1}')
        self.assertEqual(storage.unseal("ABCDEFGHJKLM", sealed), '{"a":1}')
        self.assertIsNone(storage.unseal("ABCDEFGHJKLN", sealed))
        flipped = sealed[:-5] + ("A" if sealed[-5] != "A" else "B") + sealed[-4:]
        self.assertIsNone(storage.unseal("ABCDEFGHJKLM", flipped))
        self.assertNotEqual(storage.seal("ABCDEFGHJKLM", '{"a":1}'), sealed)  # fresh nonce each time

    def test_old_plain_rows_are_read_and_then_encrypted(self):
        code = "BW-ABCD-EFGH-JKLM"
        db = storage._db()
        db.execute("INSERT INTO households(id, data, updated) VALUES (?, ?, 0)",
                   (storage._hash(code), json.dumps({"receipts": {"old": {"store": "LIDL", "updated": 1}}})))
        db.commit()
        merged = storage.sync_household(code, {})
        self.assertEqual(merged["receipts"]["old"]["store"], "LIDL")
        self.assertTrue(self.raw_rows()[0].startswith("e1:"))

    def test_changed_secret_rebuilds_from_phone(self):
        code = storage.new_household()
        storage.sync_household(code, {"list": {"l1": {"name": "milk", "updated": 1}}})
        config.HOUSEHOLD_SECRET = "a-new-secret"
        merged = storage.sync_household(code, {"list": {"l2": {"name": "bread", "updated": 2}}})
        self.assertEqual(set(merged["list"]), {"l2"})  # old copy unreadable; the phone's copy wins
        self.assertEqual(set(storage.sync_household(code, {})["list"]), {"l2"})


class SecurityServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        storage.reset_for_tests(tempfile.mkdtemp())
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.srv.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def open(self, path, body=None, headers=None):
        req = urllib.request.Request(self.base + path, data=None if body is None else json.dumps(body).encode(),
                                     method="GET" if body is None else "POST",
                                     headers={"Content-Type": "application/json", **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, r.headers, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.headers, e.read()

    def test_security_headers(self):
        for path in ("/", "/api/health", "/static/app.js", "/nope"):
            _, h, _ = self.open(path)
            csp = h.get("Content-Security-Policy", "")
            self.assertIn("script-src 'self'", csp, path)
            self.assertIn("frame-ancestors 'none'", csp)
            self.assertNotIn("unsafe-eval", csp)
            self.assertEqual(h.get("X-Frame-Options"), "DENY")
            self.assertIn("max-age=", h.get("Strict-Transport-Security", ""))
            self.assertEqual(h.get("X-Content-Type-Options"), "nosniff")
            self.assertNotIn("Python", h.get("Server", ""))

    def test_page_has_no_inline_scripts_or_google_fonts(self):
        # The CSP allows scripts only from this site, and fonts are served by Bonwise itself.
        for path in ("/", "/offline.html", "/privacy", "/impressum"):
            html = self.open(path)[2].decode()
            self.assertNotIn("fonts.googleapis.com", html)
            self.assertNotRegex(html, r"<script(?![^>]*\bsrc=)")
            self.assertNotRegex(html, r"\son[a-z]+=")
        page = self.open("/")[2].decode()
        self.assertRegex(page, r'/static/fonts/fonts\.css\?v=\d+"')
        css = self.open("/static/fonts/fonts.css")[2].decode()
        for name in __import__("re").findall(r"url\(([^)]+)\)", css):
            s, h, _ = self.open("/static/fonts/" + name)
            self.assertEqual((s, h.get("Content-Type")), (200, "font/woff2"), name)

    def test_app_js_only_calls_allowed_services(self):
        js = self.open("/static/app.js")[2].decode()
        csp = self.open("/")[1].get("Content-Security-Policy")
        import re
        for host in set(re.findall(r'fetch\(\s*"(https://[^/"]+)', js)) | set(re.findall(r'"(https://[a-z.-]+)/api/', js)):
            self.assertIn(host, csp)

    def test_faked_address_cant_skip_scan_limit(self):
        saved = app.limiter
        app.limiter = app.RateLimiter(2)
        try:
            codes = [self.open("/api/scan-text", {"text": "Butter 2,29", "useAi": False},
                               {"X-Forwarded-For": "9.9.9.%d, 81.2.3.4" % i})[0] for i in range(3)]
        finally:
            app.limiter = saved
        self.assertEqual(codes, [200, 200, 429])

    def test_ai_test_is_rate_limited(self):
        saved = app.limiter
        app.limiter = app.RateLimiter(1)
        try:
            codes = [self.open("/api/test-ai", {})[0] for _ in range(2)]
        finally:
            app.limiter = saved
        self.assertEqual(codes, [200, 429])

    def test_global_cap(self):
        saved = app.global_limiter
        app.global_limiter = app.RateLimiter(1)
        try:
            codes = [self.open("/api/scan-text", {"text": "Butter 2,29", "useAi": False})[0] for _ in range(2)]
        finally:
            app.global_limiter = saved
        self.assertEqual(codes, [200, 429])

    def test_price_reports_are_limited(self):
        saved = app.report_limiter
        app.report_limiter = app.RateLimiter(1)
        try:
            body = {"store": "LIDL", "day": "2026-09-01", "items": [{"en": "Milk", "price": 0.99}]}
            codes = [self.open("/api/prices/report", body)[0] for _ in range(2)]
        finally:
            app.report_limiter = saved
        self.assertEqual(codes, [200, 429])

    def test_other_sites_cant_post(self):
        s = self.open("/api/household/new", {}, {"Origin": "https://evil.example"})[0]
        self.assertEqual(s, 403)

    def test_bad_content_length(self):
        req = urllib.request.Request(self.base + "/api/trip", data=b"{}", method="POST",
                                     headers={"Content-Type": "application/json", "Content-Length": "abc"})
        try:
            urllib.request.urlopen(req, timeout=10)
            code = 200
        except urllib.error.HTTPError as e:
            code = e.code
        self.assertEqual(code, 400)

    def test_log_has_no_position(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            self.open("/api/shops?lat=52.5200&lon=13.4050")
        log = buf.getvalue()
        self.assertIn("/api/shops", log)
        self.assertNotIn("52.52", log)
        self.assertNotIn("13.405", log)

    def test_slow_client_is_dropped(self):
        self.assertTrue(0 < app.Handler.timeout <= 60)


if __name__ == "__main__":
    unittest.main()


class JarFilesTests(unittest.TestCase):
    """The 3D jar's files: versioned together, Three.js cached for long, progress header."""

    @classmethod
    def setUpClass(cls):
        storage.reset_for_tests(tempfile.mkdtemp())
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.srv.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def get(self, path, headers=None):
        req = urllib.request.Request(self.base + path, headers=headers or {})
        with urllib.request.urlopen(req) as r:
            return r.status, r.headers, r.read()

    def test_jar_entry_is_versioned(self):
        page = self.get("/")[2].decode()
        self.assertRegex(page, r'data-jar="/static/jar/index\.js\?v=\d+"')
        self.assertIn('class="simple"', page)        # no layout jump when the simple view applies

    def three_url(self, folder):
        import re
        src = (Path(app.STATIC) / folder / "loader.js").read_text()
        return re.search(r'THREE_URL = "([^"]+)"', src).group(1)

    def test_three_url_changes_with_the_file(self):
        # The file is cached for a year under its URL, so the URL must name this exact file;
        # tools/3d/build_three.sh writes the hash into both loaders.
        import hashlib
        digest = hashlib.sha256((Path(app.STATIC) / "vendor" / "three-jar.min.js").read_bytes()).hexdigest()[:10]
        for folder in ("jar", "mascot"):
            self.assertTrue(self.three_url(folder).endswith("-" + digest), folder)

    def test_three_cached_and_progress_header(self):
        s, h, body = self.get(self.three_url("jar"), {"Accept-Encoding": "gzip"})
        self.assertEqual(s, 200)
        self.assertIn("immutable", h.get("Cache-Control"))
        self.assertEqual(h.get("Content-Encoding"), "gzip")
        self.assertGreater(int(h.get("X-Raw-Length")), len(body))
        self.assertLess(len(body), 160 * 1024)         # stays a small download
        self.assertIn("no-cache", self.get("/static/jar/index.js")[1].get("Cache-Control"))

    def test_jar_modules_have_no_outside_imports(self):
        # Only this site's files (the CSP allows scripts from 'self' only).
        import re
        for f in list((Path(app.STATIC) / "jar").glob("*.js")) + list((Path(app.STATIC) / "mascot").glob("*.js")):
            for spec in re.findall(r'(?:import\s*\(|from\s+)\s*["\']([^"\']+)', f.read_text()):
                self.assertFalse(spec.startswith("http"), (f.name, spec))


class WelcomePageTests(unittest.TestCase):
    """The landing page (/welcome) and its 3D Bonni (static/mascot)."""

    @classmethod
    def setUpClass(cls):
        storage.reset_for_tests(tempfile.mkdtemp())
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.srv.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def get(self, path):
        req = urllib.request.Request(self.base + path, headers={"User-Agent": "Mozilla/5.0 test"})
        with urllib.request.urlopen(req) as r:
            return r.status, r.headers, r.read().decode()

    def test_page_is_served_with_the_security_headers(self):
        s, h, page = self.get("/welcome")
        self.assertEqual(s, 200)
        self.assertIn("text/html", h.get("Content-Type"))
        self.assertIn("script-src 'self'", h.get("Content-Security-Policy"))
        self.assertEqual(h.get("X-Bonwise"), "1")

    def test_scripts_are_versioned(self):
        page = self.get("/welcome")[2]
        for name in ("i18n.js", "welcome.js", "fonts/fonts.css"):
            self.assertRegex(page, r'/static/%s\?v=\d+"' % name.replace(".", r"\."))
        self.assertRegex(page, r'data-mascot="/static/mascot/index\.js\?v=\d+"')

    def test_no_inline_scripts_or_handlers(self):
        import re
        page = (Path(app.STATIC) / "welcome.html").read_text()
        self.assertEqual(re.findall(r"<script(?![^>]*\bsrc=)[^>]*>", page), [])
        self.assertEqual(re.findall(r"\son[a-z]+\s*=", page), [])

    def test_every_section_has_its_still_picture(self):
        import re
        page = (Path(app.STATIC) / "welcome.html").read_text()
        scenes = re.findall(r'data-scene="(\d)"', page)
        self.assertEqual(scenes, [str(i) for i in range(6)])
        for i in scenes:
            poster = Path(app.STATIC) / "mascot" / "posters" / ("%s.webp" % i)
            self.assertTrue(poster.is_file(), poster)
            self.assertLess(poster.stat().st_size, 60 * 1024)
            self.assertIn("/static/mascot/posters/%s.webp" % i, page)
        # the 3D has a pose for each section
        sections = (Path(app.STATIC) / "mascot" / "sections.js").read_text()
        self.assertEqual(len(re.findall(r"^  \{ b: \[", sections, re.M)), len(scenes))

    def test_scene_parts_exist(self):
        import re
        root = Path(app.STATIC) / "mascot"
        for spec in re.findall(r'"(\.{1,2}/[\w/]+\.js)"', (root / "index.js").read_text()):
            self.assertTrue((root / spec).resolve().is_file(), spec)

    def test_visits_are_a_daily_total(self):
        before = storage.stats(1)
        self.get("/welcome")
        after = storage.stats(1)
        day = max(after)
        self.assertEqual(after[day].get("welcome", 0), before.get(day, {}).get("welcome", 0) + 1)
