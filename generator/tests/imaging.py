"""Helpers that build small in-memory images for tests."""

import io

from PIL import Image


def make_image(width: int, height: int, fmt: str = "JPEG", mode: str = "RGB", **save) -> bytes:
    color = (120, 80, 40, 128) if mode == "RGBA" else (120, 80, 40)
    buf = io.BytesIO()
    Image.new(mode, (width, height), color).save(buf, fmt, **save)
    return buf.getvalue()
