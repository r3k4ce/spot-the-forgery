import random
import re

import pytest
from imaging import SVG, make_image, open_image
from PIL import Image, ImageCms

from spot_the_forgery.normalize import (
    aspect_of,
    aspect_ok,
    crop_to_aspect,
    normalize,
    random_name,
    sniff_media_type,
)


def _exif_jpeg() -> bytes:
    exif = Image.Exif()
    exif[0x010F] = "CameraMaker"
    return make_image(2000, 3000, exif=exif.tobytes())


def _icc_jpeg() -> bytes:
    srgb = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB"))
    return make_image(900, 600, icc_profile=srgb.tobytes())


def _inputs() -> list[bytes]:
    return [make_image(700, 500, "PNG", "RGBA"), _exif_jpeg(), _icc_jpeg()]


def test_normalize_long_edge_both_ways():
    small = open_image(normalize(make_image(700, 500, "PNG", "RGBA")))
    assert small.width == 1024
    assert abs(small.height - 731) <= 1
    tall = open_image(normalize(_exif_jpeg()))
    assert tall.height == 1024
    assert abs(tall.width - 683) <= 1


def test_normalize_strips_metadata_and_format():
    for data in _inputs():
        img = open_image(normalize(data))
        assert img.format == "JPEG"
        assert img.mode == "RGB"
        assert len(img.getexif()) == 0
        assert "icc_profile" not in img.info


def test_normalize_identical_settings():
    outputs = [open_image(normalize(data)) for data in _inputs()]
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


def test_transparency_is_flattened_the_same_with_a_colour_profile():
    srgb = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    plain = open_image(normalize(make_image(40, 30, "PNG", "RGBA")))
    profiled = open_image(normalize(make_image(40, 30, "PNG", "RGBA", icc_profile=srgb)))
    plain_px, profiled_px = plain.getpixel((20, 15)), profiled.getpixel((20, 15))
    assert isinstance(plain_px, tuple) and isinstance(profiled_px, tuple)
    assert all(abs(a - b) <= 2 for a, b in zip(plain_px, profiled_px, strict=True))


@pytest.mark.parametrize(
    ("mode", "fmt", "profile"),
    [
        ("P", "PNG", ImageCms.createProfile("sRGB")),  # describes the palette's colours
        ("RGB", "JPEG", ImageCms.createProfile("LAB")),  # wrong colour space for the pixels
        ("RGB", "JPEG", None),  # not a profile at all
    ],
)
def test_unusable_colour_profile_is_ignored(mode: str, fmt: str, profile):
    icc = ImageCms.ImageCmsProfile(profile).tobytes() if profile else b"not a profile"
    img = open_image(normalize(make_image(40, 30, fmt, mode, icc_profile=icc)))
    assert (img.format, img.mode) == ("JPEG", "RGB")


def test_exif_rotation_is_applied_not_dropped():
    """Browsers show a photo tagged "rotate 90°" upright; stripping the tag must not tip it over."""
    exif = Image.Exif()
    exif[0x0112] = 6  # Orientation: rotate 90° clockwise to display
    sideways = make_image(200, 100, exif=exif.tobytes())
    assert aspect_of(sideways) == 0.5
    assert open_image(normalize(sideways)).size == (512, 1024)
    assert open_image(crop_to_aspect(sideways, 0.25)).size == (50, 200)


def test_random_name_deterministic_and_shape():
    a = random_name(random.Random(1))
    assert a == random_name(random.Random(1))
    assert re.fullmatch(r"[0-9a-f]{16}\.jpg", a)
