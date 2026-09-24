import unittest

from bonwise import ai_reader, config
from tests import mock_hf


class ExtractJsonTests(unittest.TestCase):
    def test_plain_fenced_thinking_and_trailing_commas(self):
        self.assertEqual(ai_reader.extract_json('{"a":1}'), {"a": 1})
        self.assertEqual(ai_reader.extract_json('text ```json\n{"a":1,}\n``` more'), {"a": 1})
        self.assertEqual(ai_reader.extract_json('<think>{no}</think>{"a":2}'), {"a": 2})
        self.assertIsNone(ai_reader.extract_json("no json here"))

    def test_cut_off_answer_keeps_complete_items(self):
        r = ai_reader.extract_json('{"store":"X","items":[{"raw":"A","price":1},{"raw":"B","pri')
        self.assertEqual(r["items"], [{"raw": "A", "price": 1}])


class ReadReceiptTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv, url = mock_hf.start()
        cls.saved = (config.HF_TOKEN, config.HF_BASE_URL, config.MODEL_TIMEOUT)
        config.HF_TOKEN, config.HF_BASE_URL = "hf_test", url

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        config.HF_TOKEN, config.HF_BASE_URL, config.MODEL_TIMEOUT = cls.saved

    def setUp(self):
        mock_hf.calls.clear()

    def test_reads_image_and_sends_token(self):
        r = ai_reader.read_receipt(image_b64="AAAA", models=["ok-model"])
        self.assertEqual(r["model"], "ok-model")
        self.assertEqual(len(r["items"]), 5)
        self.assertTrue(r["items"][3]["pfand"])
        self.assertEqual(mock_hf.calls[0]["auth"], "Bearer hf_test")
        self.assertTrue(mock_hf.calls[0]["image"])

    def test_falls_back_to_next_model(self):
        r = ai_reader.read_receipt(text="Butter 2,29", models=["busy-model", "missing-model", "junk-model", "fenced-model"])
        self.assertEqual(r["model"], "fenced-model")
        self.assertEqual([c["model"] for c in mock_hf.calls], ["busy-model", "missing-model", "junk-model", "fenced-model"])

    def test_bad_key_stops_at_once(self):
        with self.assertRaises(ai_reader.AIError) as cm:
            ai_reader.read_receipt(text="x", models=["bad-key", "ok-model"])
        self.assertEqual(cm.exception.code, "bad_key")
        self.assertEqual(len(mock_hf.calls), 1)

    def test_no_credit(self):
        with self.assertRaises(ai_reader.AIError) as cm:
            ai_reader.read_receipt(text="x", models=["no-credit", "ok-model"])
        self.assertEqual(cm.exception.code, "no_credit")

    def test_timeout_moves_on(self):
        config.MODEL_TIMEOUT = 1
        try:
            r = ai_reader.read_receipt(text="x", models=["slow-model", "ok-model"])
        finally:
            config.MODEL_TIMEOUT = 45
        self.assertEqual(r["model"], "ok-model")

    def test_cut_and_thinking_replies(self):
        self.assertEqual(len(ai_reader.read_receipt(text="x", models=["cut-model"])["items"]), 4)
        self.assertEqual(len(ai_reader.read_receipt(text="x", models=["think-model"])["items"]), 5)

    def test_not_a_receipt(self):
        with self.assertRaises(ai_reader.NotReceipt):
            ai_reader.read_receipt(image_b64="AAAA", models=["notreceipt-model"])

    def test_not_configured(self):
        config.HF_TOKEN = ""
        try:
            with self.assertRaises(ai_reader.AIError) as cm:
                ai_reader.read_receipt(text="x")
        finally:
            config.HF_TOKEN = "hf_test"
        self.assertEqual(cm.exception.code, "not_configured")


if __name__ == "__main__":
    unittest.main()
