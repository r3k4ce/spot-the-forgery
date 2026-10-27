import io
import random
import re

import pytest
from imaging import make_image
from PIL import Image, ImageCms

from spot_the_forgery.normalize import aspect_ok, normalize, random_name, sniff_media_type

SVG = b'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'


def _exif_jpeg() -> bytes:
    exif = Image.Exif()
    exif[0x010F] = "CameraMaker"
    return make_image(2000, 3000, exif=exif.tobytes())


def _icc_jpeg() -> bytes:
    srgb = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB"))
    return make_image(900, 600, icc_profile=srgb.tobytes())


def _inputs() -> list[bytes]:
    return [make_image(700, 500, "PNG", "RGBA"), _exif_jpeg(), _icc_jpeg()]


def _open(data: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(data))
    img.load()
    return img


def test_normalize_long_edge_both_ways():
    small = _open(normalize(make_image(700, 500, "PNG", "RGBA")))
    assert small.width == 1024
    assert abs(small.height - 731) <= 1
    tall = _open(normalize(_exif_jpeg()))
    assert tall.height == 1024
    assert abs(tall.width - 683) <= 1


def test_normalize_strips_metadata_and_format():
    for data in _inputs():
        img = _open(normalize(data))
        assert img.format == "JPEG"
        assert img.mode == "RGB"
        assert len(img.getexif()) == 0
        assert "icc_profile" not in img.info


def test_normalize_identical_settings():
    outputs = [_open(normalize(data)) for data in _inputs()]
    for img in outputs:
        assert img.info.get("progressive") or img.info.get("progression")
    tables = [img.quantization for img in outputs]  # type: ignore[attr-defined]
    assert all(t == tables[0] for t in tables)


def test_aspect_ok_bounds():
    assert aspect_ok(make_image(1000, 500))
    assert not aspect_ok(make_image(1010, 500))
    assert aspect_ok(make_image(500, 1000))
    assert not aspect_ok(make_image(499, 1000))


def test_sniff_media_type():
    assert sniff_media_type(make_image(10, 10, "PNG")) == "image/png"
    assert sniff_media_type(make_image(10, 10, "JPEG")) == "image/jpeg"
    assert sniff_media_type(make_image(10, 10, "WEBP")) == "image/webp"
    with pytest.raises(ValueError):
        sniff_media_type(SVG)


def test_random_name_deterministic_and_shape():
    a = random_name(random.Random(1))
    assert a == random_name(random.Random(1))
    assert re.fullmatch(r"[0-9a-f]{16}\.jpg", a)
