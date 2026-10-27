"""Write a day's puzzle into the static site, and read back what was already published."""

import json
import os
import random
import shutil
from collections.abc import Sequence
from datetime import date
from pathlib import Path
from typing import Any

from spot_the_forgery.models import BuiltRound, History
from spot_the_forgery.normalize import normalize, random_name
from spot_the_forgery.picker import GROUP_WINDOW_DAYS, PAINTING_WINDOW_DAYS
from spot_the_forgery.seal import seal

INDEX = "index.json"
PUZZLE = "puzzle.json"


def _write_json(path: Path, data: Any) -> None:
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def load_index(puzzles_dir: Path) -> list[str]:
    path = puzzles_dir / INDEX
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def _load_puzzle(puzzles_dir: Path, day: str) -> dict[str, Any]:
    return json.loads((puzzles_dir / day / PUZZLE).read_text(encoding="utf-8"))


def load_history(puzzles_dir: Path, day: date) -> History:
    groups: set[str] = set()
    paintings: set[int] = set()
    for published in load_index(puzzles_dir):
        distance = abs((date.fromisoformat(published) - day).days)
        if distance == 0 or distance >= PAINTING_WINDOW_DAYS:
            continue
        for round_ in _load_puzzle(puzzles_dir, published)["rounds"]:
            paintings.update(round_["realIds"])
            if distance < GROUP_WINDOW_DAYS:
                groups.add(round_["groupKey"])
    return History(recent_groups=frozenset(groups), recent_paintings=frozenset(paintings))


def puzzle_number(puzzles_dir: Path, day: date) -> int:
    # Count puzzles, not days, so weekly puzzles are numbered 1, 2, 3...
    return sum(1 for d in load_index(puzzles_dir) if d < day.isoformat()) + 1


def _round_files(
    built: BuiltRound, rng: random.Random
) -> tuple[list[tuple[str, bytes]], dict[str, Any], dict[str, Any]]:
    """Return the round's (filename, jpeg) pairs, its public JSON and its sealed reveal."""
    slots: list[tuple[int | None, bytes]] = [(i, data) for i, data in enumerate(built.shown_images)]
    slots.append((None, built.fake.data))
    rng.shuffle(slots)
    files = [(random_name(rng), normalize(data)) for _, data in slots]
    real = []
    fake_index = -1
    for position, (shown_index, _) in enumerate(slots):
        if shown_index is None:
            fake_index = position
            continue
        painting = built.pick.shown[shown_index]
        real.append(
            {
                "index": position,
                "title": painting.title,
                "date": painting.date,
                "url": painting.page_url,
            }
        )
    group = built.pick.group
    public = {
        "groupKey": group.key,
        "kind": group.kind,
        "label": group.label,
        "images": [name for name, _ in files],
        "realIds": [p.id for p in built.pick.shown],
    }
    reveal = {"fakeIndex": fake_index, "note": built.verdict.tells, "real": real}
    return files, public, reveal


def publish_day(
    puzzles_dir: Path, day: date, rounds: Sequence[BuiltRound], rng: random.Random
) -> Path:
    final = puzzles_dir / day.isoformat()
    if final.exists():
        raise FileExistsError(f"puzzle for {day} already published")
    tmp = puzzles_dir / f".tmp-{day.isoformat()}"
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True)

    public_rounds = []
    reveals = []
    for difficulty, built in enumerate(rounds, start=1):
        files, public, reveal = _round_files(built, rng)
        for name, data in files:
            (tmp / name).write_bytes(data)
        public_rounds.append({**public, "difficulty": difficulty})
        reveals.append(reveal)

    puzzle = {
        "date": day.isoformat(),
        "number": puzzle_number(puzzles_dir, day),
        "rounds": public_rounds,
        "sealed": seal({"rounds": reveals}, day.isoformat()),
    }
    _write_json(tmp / PUZZLE, puzzle)
    os.replace(tmp, final)
    _write_json(puzzles_dir / INDEX, sorted({*load_index(puzzles_dir), day.isoformat()}))
    return final
