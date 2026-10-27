"""Write a day's puzzle into the static site, and read back what was already published."""

import json
import os
import random
import shutil
from collections.abc import Sequence
from datetime import date
from pathlib import Path
from typing import TypedDict

from spot_the_forgery.files import write_text_atomic
from spot_the_forgery.models import BuiltRound, GroupKind, History, Painting
from spot_the_forgery.normalize import normalize, random_name
from spot_the_forgery.picker import GROUP_WINDOW_DAYS, PAINTING_WINDOW_DAYS
from spot_the_forgery.seal import seal

INDEX = "index.json"
PUZZLE = "puzzle.json"


# The published JSON. These mirror frontend/src/lib/types.ts, which reads them.


class PuzzleRound(TypedDict):
    groupKey: str
    kind: GroupKind
    label: str
    images: list[str]  # file names, in the order the player sees them
    realIds: list[int]  # museum ids of the real paintings, for the history windows
    difficulty: int  # 1 = easiest


class Puzzle(TypedDict):
    date: str
    number: int
    rounds: list[PuzzleRound]
    sealed: str  # the RoundReveals, sealed with seal.py


class RealPainting(TypedDict):
    index: int  # position in PuzzleRound.images
    title: str
    date: str
    url: str


class RoundReveal(TypedDict):
    fakeIndex: int  # position in PuzzleRound.images
    note: str
    real: list[RealPainting]


def _write_json(path: Path, data: object) -> None:
    write_text_atomic(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def load_index(puzzles_dir: Path) -> list[str]:
    path = puzzles_dir / INDEX
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def puzzle_dir(puzzles_dir: Path, day: date) -> Path:
    return puzzles_dir / day.isoformat()


def _load_puzzle(puzzles_dir: Path, day: date) -> Puzzle:
    return json.loads((puzzle_dir(puzzles_dir, day) / PUZZLE).read_text(encoding="utf-8"))


def load_history(puzzles_dir: Path, day: date) -> History:
    groups: set[str] = set()
    paintings: set[int] = set()
    for published in map(date.fromisoformat, load_index(puzzles_dir)):
        distance = abs((published - day).days)
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
    built: BuiltRound, difficulty: int, rng: random.Random
) -> tuple[list[tuple[str, bytes]], PuzzleRound, RoundReveal]:
    """Return the round's (filename, jpeg) pairs, its public JSON and its sealed reveal."""
    slots: list[tuple[Painting | None, bytes]] = list(
        zip(built.pick.shown, built.shown_images, strict=True)
    )
    slots.append((None, built.fake.data))  # None marks the fake
    rng.shuffle(slots)
    files = [(random_name(rng), normalize(data)) for _, data in slots]
    group = built.pick.group
    public = PuzzleRound(
        groupKey=group.key,
        kind=group.kind,
        label=group.label,
        images=[name for name, _ in files],
        realIds=[p.id for p in built.pick.shown],
        difficulty=difficulty,
    )
    reveal = RoundReveal(
        fakeIndex=next(i for i, (painting, _) in enumerate(slots) if painting is None),
        note=built.verdict.tells,
        real=[
            RealPainting(index=i, title=painting.title, date=painting.date, url=painting.page_url)
            for i, (painting, _) in enumerate(slots)
            if painting is not None
        ],
    )
    return files, public, reveal


def publish_day(
    puzzles_dir: Path, day: date, rounds: Sequence[BuiltRound], rng: random.Random
) -> Path:
    final = puzzle_dir(puzzles_dir, day)
    if final.exists():
        raise FileExistsError(f"puzzle for {day} already published")
    # Build the folder under a gitignored name and move it into place in one step, so the
    # site never serves half a puzzle. A leftover from a crashed run is simply replaced.
    tmp = puzzles_dir / f".tmp-{day.isoformat()}"
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True)

    public_rounds: list[PuzzleRound] = []
    reveals: list[RoundReveal] = []
    for difficulty, built in enumerate(rounds, start=1):
        files, public, reveal = _round_files(built, difficulty, rng)
        for name, data in files:
            (tmp / name).write_bytes(data)
        public_rounds.append(public)
        reveals.append(reveal)

    puzzle = Puzzle(
        date=day.isoformat(),
        number=puzzle_number(puzzles_dir, day),
        rounds=public_rounds,
        sealed=seal({"rounds": reveals}, day.isoformat()),
    )
    _write_json(tmp / PUZZLE, puzzle)
    os.replace(tmp, final)
    _write_json(puzzles_dir / INDEX, sorted({*load_index(puzzles_dir), day.isoformat()}))
    return final
