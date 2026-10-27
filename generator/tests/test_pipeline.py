import io
import random
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

import pytest
from imaging import make_image
from PIL import Image

from spot_the_forgery.budget import BudgetExceeded
from spot_the_forgery.models import (
    Brief,
    Candidate,
    Group,
    History,
    Painting,
    Pick,
    RoundFailed,
    Verdict,
)
from spot_the_forgery.pipeline import DayFailed, Deps, build_day, build_round

NO_HISTORY = History(recent_groups=frozenset(), recent_paintings=frozenset())


def width_of(data: bytes) -> int:
    return Image.open(io.BytesIO(data)).width


@dataclass
class FakeFetcher:
    sizes: dict[str, tuple[int, int]] = field(default_factory=dict)
    fetched: list[str] = field(default_factory=list)

    def fetch(self, url: str) -> bytes:
        self.fetched.append(url)
        # The group number is encoded in the URL ("g3/31") and becomes the image width.
        default = (400 + int(url.split("/")[0][1:]), 300)
        return make_image(*self.sizes.get(url, default))


@dataclass
class FakeBriefWriter:
    fail_groups: set[str] = field(default_factory=set)
    calls: int = 0

    def write(self, pick: Pick, reference_images: Sequence[bytes]) -> Brief:
        self.calls += 1
        if pick.group.key in self.fail_groups:
            raise RoundFailed("refused")
        return Brief(prompt="p", aspect_ratio="4:3", forbidden=())


@dataclass
class FakeForger:
    fail_calls: set[int] = field(default_factory=set)
    budget_after: int | None = None
    calls: int = 0

    def generate(self, brief: Brief, reference_images: Sequence[bytes]) -> Candidate:
        self.calls += 1
        if self.budget_after is not None and self.calls > self.budget_after:
            raise BudgetExceeded("out")
        if self.calls in self.fail_calls:
            raise RoundFailed("image failed")
        return Candidate(
            data=make_image(10 + self.calls, 10, "PNG"), media_type="image/png", model="m"
        )


@dataclass
class FakeJudge:
    score: Callable[[Sequence[bytes], int], int]
    calls: list[int] = field(default_factory=list)

    def judge(self, shown: Sequence[bytes], candidates: Sequence[Candidate]) -> list[Verdict]:
        self.calls.append(len(candidates))
        attempt = len(self.calls)
        return [
            Verdict(convincing=self.score(shown, attempt * 10 + i), tells=f"t{i}")
            for i in range(len(candidates))
        ]


def scripted(*rounds: list[int]) -> Callable[[Sequence[bytes], int], int]:
    """Judge attempt n (1-based) returns rounds[n-1][i] for candidate i."""
    return lambda shown, key: rounds[key // 10 - 1][key % 10]


def group(n: int, size: int = 6) -> Group:
    key = f"g{n}"
    paintings = tuple(
        Painting(id=n * 10 + i, title="t", date="d", image_url=f"{key}/{n * 10 + i}", page_url="p")
        for i in range(size)
    )
    return Group(key=key, kind="artist", label=key, paintings=paintings)


def pick_of(g: Group, spares: int = 1) -> Pick:
    p = g.paintings
    return Pick(group=g, shown=p[:3], references=p[3:4], spares=p[4 : 4 + spares])


def deps(
    judge: FakeJudge,
    forger: FakeForger | None = None,
    brief: FakeBriefWriter | None = None,
    fetcher: FakeFetcher | None = None,
) -> Deps:
    return Deps(
        fetcher=fetcher or FakeFetcher(),
        brief_writer=brief or FakeBriefWriter(),
        forger=forger or FakeForger(),
        judge=judge,
    )


def test_build_round_picks_best_candidate():
    forger = FakeForger()
    built = build_round(pick_of(group(1)), deps(FakeJudge(scripted([3, 8, 5])), forger))
    assert built.verdict.convincing == 8
    assert width_of(built.fake.data) == 12  # the second candidate generated
    assert forger.calls == 3
    assert len(built.shown_images) == 3


def test_build_round_regenerates_once_when_too_obvious():
    brief, forger = FakeBriefWriter(), FakeForger()
    judge = FakeJudge(scripted([1, 2, 3], [2, 6, 1]))
    built = build_round(pick_of(group(1)), deps(judge, forger, brief))
    assert built.verdict.convincing == 6
    assert brief.calls == 2
    assert forger.calls == 6


def test_build_round_fails_after_second_low_score():
    with pytest.raises(RoundFailed):
        build_round(pick_of(group(1)), deps(FakeJudge(scripted([1, 2, 3], [3, 3, 3]))))


def test_build_round_tolerates_one_candidate_failure():
    judge = FakeJudge(scripted([5, 7]))
    build_round(pick_of(group(1)), deps(judge, FakeForger(fail_calls={2})))
    assert judge.calls == [2]


def test_build_round_fails_when_no_candidate():
    with pytest.raises(RoundFailed):
        build_round(pick_of(group(1)), deps(FakeJudge(scripted([5])), FakeForger({1, 2, 3})))


def test_extreme_aspect_swapped_from_spares():
    g = group(1)
    fetcher = FakeFetcher(sizes={g.paintings[1].image_url: (1000, 300)})
    built = build_round(pick_of(g), deps(FakeJudge(scripted([5, 5, 5])), fetcher=fetcher))
    assert [p.id for p in built.pick.shown] == [10, 14, 12]
    assert [width_of(i) for i in built.shown_images] == [401, 401, 401]


def test_extreme_aspect_without_spares_fails():
    g = group(1)
    fetcher = FakeFetcher(sizes={g.paintings[0].image_url: (300, 1000)})
    with pytest.raises(RoundFailed):
        build_round(pick_of(g, spares=0), deps(FakeJudge(scripted([5])), fetcher=fetcher))


def by_group_width(shown: Sequence[bytes], key: int) -> int:
    return 4 + width_of(shown[0]) % 5  # groups g0..g4 score 4..8


def test_build_day_swaps_failed_group_and_orders_by_difficulty():
    groups = [group(n) for n in range(8)]
    brief = FakeBriefWriter(fail_groups={"g2", "g5"})
    rounds = build_day(
        groups, NO_HISTORY, random.Random(3), deps(FakeJudge(by_group_width), brief=brief)
    )
    keys = [r.pick.group.key for r in rounds]
    assert len(rounds) == 5
    assert not {"g2", "g5"} & set(keys)
    scores = [r.verdict.convincing for r in rounds]
    assert scores == sorted(scores)


def test_build_day_gives_up_after_max_swaps():
    groups = [group(n) for n in range(12)]
    brief = FakeBriefWriter(fail_groups={g.key for g in groups})
    with pytest.raises(DayFailed):
        build_day(
            groups, NO_HISTORY, random.Random(1), deps(FakeJudge(by_group_width), brief=brief)
        )


def test_build_day_fails_when_groups_run_out():
    groups = [group(n) for n in range(6)]
    brief = FakeBriefWriter(fail_groups={"g0", "g1"})
    with pytest.raises(DayFailed):
        build_day(
            groups, NO_HISTORY, random.Random(1), deps(FakeJudge(by_group_width), brief=brief)
        )


def test_budget_exceeded_bubbles_up():
    groups = [group(n) for n in range(6)]
    forger = FakeForger(budget_after=4)
    with pytest.raises(BudgetExceeded):
        build_day(groups, NO_HISTORY, random.Random(1), deps(FakeJudge(by_group_width), forger))
