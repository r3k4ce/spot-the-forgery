"""Helpers that build and inspect small in-memory images for tests."""

import io

from PIL import Image

SVG = b'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'


def make_image(width: int, height: int, fmt: str = "JPEG", mode: str = "RGB", **save) -> bytes:
    color = (120, 80, 40, 128) if mode == "RGBA" else (120, 80, 40)
    buf = io.BytesIO()
    Image.new(mode, (width, height), color).save(buf, fmt, **save)
    return buf.getvalue()


def open_image(data: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(data))
    img.load()
    return img
