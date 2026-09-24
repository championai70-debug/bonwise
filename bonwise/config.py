"""Settings, read from environment variables (or a .env file next to app.py)."""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv():
    env = ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()

# Hugging Face token with the "Make calls to Inference Providers" permission.
HF_TOKEN = os.environ.get("HF_TOKEN", "").strip()

# OpenAI-compatible endpoint of Hugging Face Inference Providers.
HF_BASE_URL = os.environ.get("HF_BASE_URL", "https://router.huggingface.co/v1").rstrip("/")

# Open multimodal models, tried in this order. Qwen3-VL is Apache-2.0 and strong at OCR; the larger
# 235B model gets a turn when the first one's prices don't add up to the receipt total.
DEFAULT_MODELS = [
    "Qwen/Qwen3-VL-30B-A3B-Instruct",
    "Qwen/Qwen3-VL-235B-A22B-Instruct",
    "google/gemma-4-26B-A4B-it",
    "Qwen/Qwen3-VL-8B-Instruct",
]
MODELS = [m.strip() for m in os.environ.get("MODELS", ",".join(DEFAULT_MODELS)).split(",") if m.strip()]

# Seconds each model gets, and the total time before falling back to Tesseract.
MODEL_TIMEOUT = float(os.environ.get("MODEL_TIMEOUT", "45"))
AI_TOTAL_TIMEOUT = float(os.environ.get("AI_TOTAL_TIMEOUT", "110"))

# Scans per visitor (IP address) per hour, so a shared link can't use up your credits.
HOURLY_LIMIT = int(os.environ.get("HOURLY_LIMIT", "20"))

HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "7860"))

MAX_BODY = 12 * 1024 * 1024

# Android app (Trusted Web Activity) verification, served at /.well-known/assetlinks.json.
# Either paste the whole assetlinks.json from PWABuilder into ASSETLINKS_JSON, or set the
# package name and the signing key's SHA-256 fingerprint(s) (comma-separated).
ASSETLINKS_JSON = os.environ.get("ASSETLINKS_JSON", "").strip()
ANDROID_PACKAGE = os.environ.get("ANDROID_PACKAGE", "").strip()
ANDROID_SHA256 = [f.strip() for f in os.environ.get("ANDROID_SHA256", "").split(",") if f.strip()]

# Shown on the privacy page (/privacy) as the contact for data questions.
CONTACT_EMAIL = os.environ.get("CONTACT_EMAIL", "").strip()
