import io
import tempfile
import threading
import time
import unittest
from contextlib import redirect_stdout
from http.server import ThreadingHTTPServer

import app
from bonwise import config, storage


class KeepAwakeTests(unittest.TestCase):
    """The server visits its own public address so the free Render instance stays awake."""

    def setUp(self):
        storage.reset_for_tests(tempfile.mkdtemp())
        self.seen = []
        seen = self.seen

        class Recording(app.Handler):
            def do_GET(self):
                seen.append((self.path, self.headers.get("User-Agent", "")))
                super().do_GET()

        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), Recording)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.base = "http://127.0.0.1:%d" % self.srv.server_address[1]
        self.saved = (config.KEEP_AWAKE, config.KEEP_AWAKE_URL, config.KEEP_AWAKE_MINUTES)

    def tearDown(self):
        self.srv.shutdown()
        config.KEEP_AWAKE, config.KEEP_AWAKE_URL, config.KEEP_AWAKE_MINUTES = self.saved

    def run_for(self, url, seconds, minutes=0.001):
        stop = threading.Event()
        t = threading.Thread(target=app.keep_awake, args=(url, minutes, stop), daemon=True)
        out = io.StringIO()
        with redirect_stdout(out):
            t.start()
            time.sleep(seconds)
            alive = t.is_alive()
            stop.set()
            t.join(5)
        return alive, out.getvalue()

    def test_visits_health_again_and_again(self):
        self.run_for(self.base, 0.6)
        self.assertGreaterEqual(len(self.seen), 3)
        self.assertTrue(all(p == "/api/health" and "Bonwise" in ua for p, ua in self.seen))

    def test_visits_are_not_counted_as_app_use(self):
        self.run_for(self.base, 0.4)
        self.assertTrue(self.seen)
        self.assertEqual(storage.stats(1), {})

    def test_a_dead_address_never_stops_the_loop(self):
        # nothing listens on port 9: every visit fails, the loop keeps going and says so once
        alive, log = self.run_for("http://127.0.0.1:9", 0.5)
        self.assertTrue(alive)
        self.assertIn("keep-awake: no answer", log)
        self.assertNotIn("127.0.0.1", log)          # no addresses in the log

    def test_starts_only_when_on_and_the_address_is_known(self):
        config.KEEP_AWAKE, config.KEEP_AWAKE_URL, config.KEEP_AWAKE_MINUTES = True, "", 10
        self.assertIsNone(app.start_keep_awake())        # not on Render, no address
        config.KEEP_AWAKE, config.KEEP_AWAKE_URL = False, self.base
        self.assertIsNone(app.start_keep_awake())        # switched off (KEEP_AWAKE=0)
        config.KEEP_AWAKE, config.KEEP_AWAKE_MINUTES = True, 0.001
        with redirect_stdout(io.StringIO()):
            stop = app.start_keep_awake()
        self.assertIsNotNone(stop)
        time.sleep(0.3)
        stop.set()
        self.assertTrue(self.seen)


if __name__ == "__main__":
    unittest.main()
