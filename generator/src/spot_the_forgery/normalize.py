"""Make real and forged images indistinguishable by their file properties."""

import io
import random

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
    img = _open(data)
    return MIN_ASPECT <= img.width / img.height <= MAX_ASPECT


def normalize(data: bytes) -> bytes:
    img = _open(data)
    icc = img.info.get("icc_profile")
    if icc:
        source = ImageCms.ImageCmsProfile(io.BytesIO(icc))
        converted = ImageCms.profileToProfile(img, source, _SRGB, outputMode="RGB")
        img = converted if converted is not None else img
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        background = Image.new("RGB", img.size, (255, 255, 255))
        background.paste(img, mask=img.getchannel("A"))
        img = background
    else:
        img = img.convert("RGB")

    scale = LONG_EDGE / max(img.width, img.height)
    size = (max(1, round(img.width * scale)), max(1, round(img.height * scale)))
    img = img.resize(size, Image.Resampling.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=JPEG_QUALITY, progressive=True, optimize=True)
    return buf.getvalue()


def random_name(rng: random.Random) -> str:
    return f"{rng.getrandbits(64):016x}.jpg"
