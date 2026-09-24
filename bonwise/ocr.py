"""Backup reader: Tesseract OCR on the server (German + English when installed).
Used when the AI reader isn't configured or doesn't answer."""

import io
import shutil
import subprocess
import tempfile
from functools import lru_cache

try:
    from PIL import Image, ImageOps, ImageEnhance
except ImportError:  # Pillow is optional; without it the photo goes to Tesseract as is
    Image = None


class OCRError(Exception):
    pass


def available():
    return shutil.which("tesseract") is not None


@lru_cache(maxsize=1)
def languages():
    try:
        out = subprocess.run(["tesseract", "--list-langs"], capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return "eng"
    have = {l.strip() for l in out.splitlines()[1:]}
    langs = [l for l in ("deu", "eng") if l in have]
    return "+".join(langs) or "eng"


def _prepare(image_bytes):
    """Shrink big phone photos, make them grey and a bit more contrasty."""
    if Image is None:
        return image_bytes, ".jpg"
    try:
        img = Image.open(io.BytesIO(image_bytes))
        img = ImageOps.exif_transpose(img).convert("L")
    except Exception as e:  # noqa: BLE001 - any decode problem means "not an image"
        raise OCRError("bad_image") from e
    w, h = img.size
    scale = min(1.0, 1800 / w, 5000 / h)
    if w < 900:  # small photos read better a bit larger
        scale = min(2.0, 1200 / w)
    if scale != 1.0:
        img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    img = ImageEnhance.Contrast(img).enhance(1.25)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue(), ".png"


def read_text(image_bytes, timeout=60):
    if not available():
        raise OCRError("no_tesseract")
    data, suffix = _prepare(image_bytes)
    with tempfile.NamedTemporaryFile(suffix=suffix) as f:
        f.write(data)
        f.flush()
        try:
            res = subprocess.run(
                ["tesseract", f.name, "stdout", "-l", languages(), "--psm", "6",
                 "-c", "preserve_interword_spaces=1"],
                capture_output=True, text=True, timeout=timeout,
            )
        except subprocess.TimeoutExpired as e:
            raise OCRError("timeout") from e
    if res.returncode != 0:
        raise OCRError("failed")
    return res.stdout
