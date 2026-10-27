import io
import json
import random
from datetime import date, timedelta
from pathlib import Path

import pytest
from imaging import make_image
from PIL import Image

from spot_the_forgery.models import BuiltRound, Candidate, Group, Painting, Pick, Verdict
from spot_the_forgery.publish import load_history, load_index, publish_day, puzzle_number
from spot_the_forgery.seal import unseal

DAY = date(2026, 10, 28)


def built_round(n: int, score: int) -> BuiltRound:
    paintings = tuple(
        Painting(
            id=n * 10 + i,
            title=f"Title {n}-{i}",
            date=f"18{n}{i}",
            image_url=f"https://cdn.test/{n}/{i}.jpg",
            page_url=f"https://clevelandart.org/art/{n}.{i}",
        )
        for i in range(4)
    )
    group = Group(key=f"artist:{n}", kind="artist", label=f"Painter {n}", paintings=paintings)
    pick = Pick(group=group, shown=paintings[:3], references=paintings[3:], spares=())
    fake = Candidate(data=make_image(64, 32, "PNG"), model="m")
    return BuiltRound(
        pick=pick,
        shown_images=tuple(make_image(40, 40) for _ in range(3)),
        fake=fake,
        verdict=Verdict(convincing=score, tells=f"Curator note {n}: the sky is too smooth."),
    )


def rounds() -> list[BuiltRound]:
    return [built_round(n, 4 + n) for n in range(5)]


def read_puzzle(puzzles: Path, day: date) -> dict:
    return json.loads((puzzles / day.isoformat() / "puzzle.json").read_text(encoding="utf-8"))


def test_publish_writes_folder_and_index(tmp_path: Path):
    folder = publish_day(tmp_path, DAY, rounds(), random.Random(1))
    assert folder == tmp_path / "2026-10-28"
    assert len(list(folder.glob("*.jpg"))) == 20
    assert load_index(tmp_path) == ["2026-10-28"]
    puzzle = read_puzzle(tmp_path, DAY)
    assert puzzle["date"] == "2026-10-28"
    assert puzzle["number"] == 1
    assert [r["difficulty"] for r in puzzle["rounds"]] == [1, 2, 3, 4, 5]
    first = puzzle["rounds"][0]
    assert (first["groupKey"], first["kind"], first["label"]) == ("artist:0", "artist", "Painter 0")
    assert first["realIds"] == [0, 1, 2]
    for r in puzzle["rounds"]:
        assert len(set(r["images"])) == 4


def test_sealed_answers_point_at_fake(tmp_path: Path):
    publish_day(tmp_path, DAY, rounds(), random.Random(2))
    puzzle = read_puzzle(tmp_path, DAY)
    sealed = unseal(puzzle["sealed"], "2026-10-28")
    fake_positions = set()
    for public, secret in zip(puzzle["rounds"], sealed["rounds"], strict=True):  # type: ignore[arg-type]
        fake_file = tmp_path / "2026-10-28" / public["images"][secret["fakeIndex"]]
        assert Image.open(io.BytesIO(fake_file.read_bytes())).size == (1024, 512)
        fake_positions.add(secret["fakeIndex"])
        real_indexes = [r["index"] for r in secret["real"]]
        assert sorted([*real_indexes, secret["fakeIndex"]]) == [0, 1, 2, 3]
        assert secret["note"].startswith("Curator note")
    assert len(fake_positions) > 1  # the fake is not always in the same slot
    first_real = sealed["rounds"][0]["real"][0]  # type: ignore[index]
    assert first_real["url"].startswith("https://clevelandart.org/art/0.")
    assert first_real["title"].startswith("Title 0-")


def test_no_answer_leak_in_public_json(tmp_path: Path):
    publish_day(tmp_path, DAY, rounds(), random.Random(1))
    text = (tmp_path / "2026-10-28" / "puzzle.json").read_text(encoding="utf-8")
    assert "fakeIndex" not in text
    assert "Curator note" not in text
    assert "Title 0-" not in text


def test_refuses_overwrite(tmp_path: Path):
    publish_day(tmp_path, DAY, rounds(), random.Random(1))
    before = (tmp_path / "2026-10-28" / "puzzle.json").read_bytes()
    with pytest.raises(FileExistsError):
        publish_day(tmp_path, DAY, rounds(), random.Random(9))
    assert (tmp_path / "2026-10-28" / "puzzle.json").read_bytes() == before


def test_leftover_tmp_is_replaced(tmp_path: Path):
    stale = tmp_path / ".tmp-2026-10-28"
    stale.mkdir()
    (stale / "junk.txt").write_text("x")
    folder = publish_day(tmp_path, DAY, rounds(), random.Random(1))
    assert not stale.exists()
    assert not (folder / "junk.txt").exists()


def test_index_sorted_unique(tmp_path: Path):
    publish_day(tmp_path, date(2026, 10, 30), rounds(), random.Random(1))
    publish_day(tmp_path, DAY, rounds(), random.Random(1))
    assert load_index(tmp_path) == ["2026-10-28", "2026-10-30"]


def test_load_index_missing_is_empty(tmp_path: Path):
    assert load_index(tmp_path / "nothing") == []


def test_history_windows(tmp_path: Path):
    day = date(2026, 12, 1)
    publish_day(
        tmp_path, day - timedelta(days=21), [built_round(n, 5) for n in range(5)], random.Random(1)
    )
    publish_day(
        tmp_path,
        day - timedelta(days=20),
        [built_round(n, 5) for n in range(5, 10)],
        random.Random(1),
    )
    publish_day(
        tmp_path,
        day - timedelta(days=150),
        [built_round(n, 5) for n in range(10, 15)],
        random.Random(1),
    )
    publish_day(
        tmp_path,
        day + timedelta(days=2),
        [built_round(n, 5) for n in range(15, 20)],
        random.Random(1),
    )
    history = load_history(tmp_path, day)
    assert history.recent_groups == {f"artist:{n}" for n in [*range(5, 10), *range(15, 20)]}
    expected_paintings = {n * 10 + i for n in [*range(0, 10), *range(15, 20)] for i in range(3)}
    assert history.recent_paintings == expected_paintings


def test_puzzle_number_counts_puzzles_not_days(tmp_path: Path):
    assert puzzle_number(tmp_path, DAY) == 1
    publish_day(tmp_path, DAY, rounds(), random.Random(1))
    # A week later is the second puzzle, not the eighth.
    assert puzzle_number(tmp_path, DAY + timedelta(days=7)) == 2
    assert puzzle_number(tmp_path, DAY) == 1
    assert read_puzzle(tmp_path, DAY)["number"] == 1
