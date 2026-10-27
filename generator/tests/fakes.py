"""Fake pipeline services shared by the pipeline and CLI tests."""

import io
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

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
from spot_the_forgery.pipeline import Deps

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


def by_group_width(shown: Sequence[bytes], key: int) -> int:
    return 4 + width_of(shown[0]) % 5  # groups g0..g4 score 4..8
