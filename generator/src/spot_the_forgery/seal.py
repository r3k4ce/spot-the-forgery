"""Light obfuscation of a puzzle's answers so they are not readable at a glance.

This is not security: anyone can reverse it. The frontend implements the same
algorithm in `frontend/src/lib/seal.ts`; `fixtures/sealed-sample.json` keeps
the two in step.
"""

import base64
import hashlib
import json
from collections.abc import Mapping


def _keystream(puzzle_date: str, length: int) -> bytes:
    block = hashlib.sha256(f"{puzzle_date}:spot-the-forgery".encode()).digest()
    out = bytearray()
    while len(out) < length:
        out += block
        block = hashlib.sha256(block).digest()
    return bytes(out[:length])


def _xor(data: bytes, puzzle_date: str) -> bytes:
    return bytes(a ^ b for a, b in zip(data, _keystream(puzzle_date, len(data)), strict=True))


def seal(payload: Mapping[str, object], puzzle_date: str) -> str:
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return base64.b64encode(_xor(raw, puzzle_date)).decode("ascii")


def unseal(sealed: str, puzzle_date: str) -> dict[str, object]:
    raw = _xor(base64.b64decode(sealed), puzzle_date)
    return json.loads(raw.decode("utf-8"))
