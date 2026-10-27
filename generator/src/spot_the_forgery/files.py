"""File writes that never leave a half-written file in place of a good one."""

import os
from pathlib import Path


def write_text_atomic(path: Path, text: str) -> None:
    # The ".tmp-" prefix is gitignored, so a leftover from a crash never gets committed.
    tmp = path.with_name(f".tmp-{path.name}")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)
