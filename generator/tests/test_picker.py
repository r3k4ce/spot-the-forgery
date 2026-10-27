from datetime import date

import pytest

from spot_the_forgery.models import Group, History, Painting
from spot_the_forgery.picker import NotEnoughGroups, day_rng, pick_day, pick_group

NO_HISTORY = History(recent_groups=frozenset(), recent_paintings=frozenset())


def group(key: str, size: int, start: int = 0) -> Group:
    paintings = tuple(
        Painting(id=start + i, title=f"P{start + i}", date="1800", image_url="u", page_url="p")
        for i in range(size)
    )
    return Group(key=key, kind="artist", label=key, paintings=paintings)


def ids(paintings) -> set[int]:
    return {p.id for p in paintings}


def test_pick_group_shapes():
    pick = pick_group(group("a", 8), NO_HISTORY, day_rng(date(2026, 10, 28)))
    assert pick is not None
    assert (len(pick.shown), len(pick.references), len(pick.spares)) == (3, 3, 2)
    assert ids(pick.shown) | ids(pick.references) | ids(pick.spares) == set(range(8))


def test_pick_group_minimum():
    pick = pick_group(group("a", 4), NO_HISTORY, day_rng(date(2026, 10, 28)))
    assert pick is not None
    assert (len(pick.shown), len(pick.references), len(pick.spares)) == (3, 1, 0)


def test_recent_paintings_excluded():
    history = History(recent_groups=frozenset(), recent_paintings=frozenset({0, 1}))
    assert pick_group(group("a", 5), history, day_rng(date(2026, 10, 28))) is None


def test_recent_paintings_never_picked():
    history = History(recent_groups=frozenset(), recent_paintings=frozenset({0, 1}))
    pick = pick_group(group("a", 8), history, day_rng(date(2026, 10, 28)))
    assert pick is not None
    assert not ({0, 1} & (ids(pick.shown) | ids(pick.references) | ids(pick.spares)))


def test_recent_groups_excluded():
    groups = [group(f"g{i}", 4, start=i * 10) for i in range(9)]
    history = History(recent_groups=frozenset({"g0", "g1"}), recent_paintings=frozenset())
    picks = pick_day(groups, history, day_rng(date(2026, 10, 28)), exclude=frozenset({"g2"}))
    assert len(picks) == 5
    assert not {"g0", "g1", "g2"} & {p.group.key for p in picks}


def test_deterministic_per_day():
    groups = [group(f"g{i}", 6, start=i * 10) for i in range(12)]

    def keys(day: date) -> list[tuple[str, tuple[int, ...]]]:
        picks = pick_day(groups, NO_HISTORY, day_rng(day))
        return [(p.group.key, tuple(sorted(ids(p.shown)))) for p in picks]

    assert keys(date(2026, 10, 28)) == keys(date(2026, 10, 28))
    assert keys(date(2026, 10, 28)) != keys(date(2026, 10, 29))


def test_not_enough_groups():
    groups = [group(f"g{i}", 4, start=i * 10) for i in range(4)]
    with pytest.raises(NotEnoughGroups):
        pick_day(groups, NO_HISTORY, day_rng(date(2026, 10, 28)), count=5)
