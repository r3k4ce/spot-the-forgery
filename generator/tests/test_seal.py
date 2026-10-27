import json
from pathlib import Path

from spot_the_forgery.seal import seal, unseal

FIXTURE = Path(__file__).parents[2] / "fixtures" / "sealed-sample.json"


def test_round_trip_unicode():
    payload = {"rounds": [{"fakeIndex": 2, "note": "Brushwork too even — café light.", "real": []}]}
    assert unseal(seal(payload, "2026-10-28"), "2026-10-28") == payload


def test_date_changes_ciphertext():
    payload = {"rounds": []}
    assert seal(payload, "2026-10-28") != seal(payload, "2026-10-29")


def test_not_plaintext():
    assert "fakeIndex" not in seal({"rounds": [{"fakeIndex": 1}]}, "2026-10-28")


def test_matches_shared_fixture():
    fx = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert seal(fx["payload"], fx["date"]) == fx["sealed"]
