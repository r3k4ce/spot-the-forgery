"""Make real and forged images indistinguishable by their file properties."""

import io
import random
from collections.abc import Sequence

from PIL import Image, ImageCms

LONG_EDGE = 1024
JPEG_QUALITY = 85
MIN_ASPECT = 0.5
MAX_ASPECT = 2.0

_MEDIA_TYPES = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
_SRGB = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB"))


def _open(data: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(data))
    img.load()
    return img


def sniff_media_type(data: bytes) -> str:
    """Media type of a raster image we accept; ValueError for anything else."""
    try:
        fmt = _open(data).format
    except Exception as exc:  # Pillow raises several types for undecodable data
        raise ValueError("not a decodable image") from exc
    if fmt not in _MEDIA_TYPES:
        raise ValueError(f"unsupported image format: {fmt}")
    return _MEDIA_TYPES[fmt]


def aspect_ok(data: bytes) -> bool:
    """True for a decodable image whose width/height is within the allowed range."""
    try:
        img = _open(data)
    except Exception:  # Pillow raises several types for undecodable data
        return False
    return MIN_ASPECT <= img.width / img.height <= MAX_ASPECT


def aspect_of(data: bytes) -> float:
    img = _open(data)
    return img.width / img.height


def nearest_aspect(ratio: float, allowed: Sequence[str]) -> str:
    """The allowed "w:h" string closest to `ratio`."""

    def value(aspect: str) -> float:
        w, h = aspect.split(":")
        return int(w) / int(h)

    return min(allowed, key=lambda a: abs(value(a) - ratio))


def crop_to_aspect(data: bytes, ratio: float) -> bytes:
    """Centre-crop to exactly `ratio`, so the fake's shape matches a real painting's."""
    img = _open(data)
    w, h = img.size
    if w / h > ratio:
        new_w = round(h * ratio)
        box = ((w - new_w) // 2, 0, (w - new_w) // 2 + new_w, h)
    else:
        new_h = round(w / ratio)
        box = (0, (h - new_h) // 2, w, (h - new_h) // 2 + new_h)
    out = io.BytesIO()
    cropped = img.crop(box)
    icc = img.info.get("icc_profile")
    cropped.save(out, "PNG", **({"icc_profile": icc} if icc else {}))
    return out.getvalue()


def _flatten_to_srgb(img: Image.Image) -> Image.Image:
    """Plain sRGB pixels, with any transparency laid over white."""
    icc = img.info.get("icc_profile")
    if img.mode == "P":
        img = img.convert("RGBA")
    # Set the alpha aside: the colour conversion below would otherwise drop it.
    alpha = img.getchannel("A") if img.mode in ("RGBA", "LA") else None
    colour = img.convert(img.mode[:-1]) if alpha is not None else img
    if icc:
        source = ImageCms.ImageCmsProfile(io.BytesIO(icc))
        converted = ImageCms.profileToProfile(colour, source, _SRGB, outputMode="RGB")
        colour = converted if converted is not None else colour
    colour = colour.convert("RGB")
    if alpha is None:
        return colour
    background = Image.new("RGB", img.size, (255, 255, 255))
    background.paste(colour, mask=alpha)
    return background


def normalize(data: bytes) -> bytes:
    img = _flatten_to_srgb(_open(data))

    scale = LONG_EDGE / max(img.width, img.height)
    size = (max(1, round(img.width * scale)), max(1, round(img.height * scale)))
    img = img.resize(size, Image.Resampling.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=JPEG_QUALITY, progressive=True, optimize=True)
    return buf.getvalue()


def random_name(rng: random.Random) -> str:
    return f"{rng.getrandbits(64):016x}.jpg"
