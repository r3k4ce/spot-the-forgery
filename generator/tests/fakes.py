"""Fake pipeline services shared by the pipeline and CLI tests."""

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

import httpx
from imaging import make_image, open_image

from spot_the_forgery.budget import Budget
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


@dataclass
class FakeFetcher:
    sizes: dict[str, tuple[int, int]] = field(default_factory=dict)
    broken: set[str] = field(default_factory=set)  # raise like a dead link
    junk: set[str] = field(default_factory=set)  # answer with an HTML error page
    fetched: list[str] = field(default_factory=list)

    def fetch(self, url: str) -> bytes:
        self.fetched.append(url)
        if url in self.broken:
            raise httpx.HTTPStatusError(
                "404", request=httpx.Request("GET", url), response=httpx.Response(404)
            )
        if url in self.junk:
            return b"<html>Service unavailable</html>"
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
    """Makes a PNG per call. Call n (1-based) is `10 + n` pixels wide unless `size` is set."""

    fail_calls: set[int] = field(default_factory=set)
    budget: Budget | None = None  # spent once per call, failed or not, like the real forger
    size: tuple[int, int] | None = None
    calls: int = 0
    briefs: list[Brief] = field(default_factory=list)

    def generate(self, brief: Brief, reference_images: Sequence[bytes]) -> Candidate:
        if self.budget is not None:
            self.budget.spend()
        self.calls += 1
        self.briefs.append(brief)
        if self.calls in self.fail_calls:
            raise RoundFailed("image failed")
        width, height = self.size or (10 + self.calls, 10)
        return Candidate(data=make_image(width, height, "PNG"), model="m")


# score(shown images, judge call number (1-based), candidate index) -> convincing score
Score = Callable[[Sequence[bytes], int, int], int]


@dataclass
class FakeJudge:
    score: Score
    calls: list[int] = field(default_factory=list)  # how many candidates each call judged

    def judge(self, shown: Sequence[bytes], candidates: Sequence[Candidate]) -> list[Verdict]:
        self.calls.append(len(candidates))
        call = len(self.calls)
        return [
            Verdict(convincing=self.score(shown, call, i), tells=f"t{i}")
            for i in range(len(candidates))
        ]


def scripted(*calls: list[int]) -> Score:
    """Judge call n (1-based) scores candidate i as calls[n - 1][i]."""
    return lambda shown, call, i: calls[call - 1][i]


def by_group_width(shown: Sequence[bytes], call: int, i: int) -> int:
    """Groups g0..g4 score 4..8 (FakeFetcher makes group n's images 400 + n wide)."""
    return 4 + open_image(shown[0]).width % 5


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
