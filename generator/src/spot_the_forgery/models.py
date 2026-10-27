"""Data shared by the pipeline stages, and the interfaces of the external services."""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal, Protocol, get_args

GroupKind = Literal["artist", "culture"]

# The "w:h" shapes the image API can generate.
AspectRatio = Literal["1:1", "2:1", "16:9", "3:2", "4:3", "5:4", "4:5", "3:4", "2:3", "9:16", "1:2"]
SUPPORTED_ASPECTS: tuple[AspectRatio, ...] = get_args(AspectRatio)


@dataclass(frozen=True)
class Painting:
    id: int
    title: str
    date: str
    image_url: str
    page_url: str


@dataclass(frozen=True)
class Group:
    key: str
    kind: GroupKind
    label: str
    paintings: tuple[Painting, ...]


@dataclass(frozen=True)
class Pick:
    group: Group
    shown: tuple[Painting, ...]  # exactly 3
    references: tuple[Painting, ...]  # 1-3, never shown in the round
    spares: tuple[Painting, ...]  # replace shown paintings with a dead link or a bad shape


@dataclass(frozen=True)
class Brief:
    prompt: str
    forbidden: tuple[str, ...]


@dataclass(frozen=True)
class Candidate:
    data: bytes
    model: str  # which image model made it


@dataclass(frozen=True)
class Verdict:
    convincing: int
    tells: str


@dataclass(frozen=True)
class BuiltRound:
    pick: Pick
    shown_images: tuple[bytes, ...]  # same order as pick.shown
    fake: Candidate
    verdict: Verdict


@dataclass(frozen=True)
class History:
    recent_groups: frozenset[str]
    recent_paintings: frozenset[int]


class RoundFailed(Exception):
    """A round could not be built; the caller should try another group."""


class ImageFetcher(Protocol):
    def fetch(self, url: str) -> bytes: ...


class BriefWriter(Protocol):
    def write(self, pick: Pick, reference_images: Sequence[bytes]) -> Brief: ...


class ImageGenerator(Protocol):
    def generate(
        self, brief: Brief, reference_images: Sequence[bytes], aspect_ratio: AspectRatio
    ) -> Candidate: ...


class Judge(Protocol):
    def judge(self, shown: Sequence[bytes], candidates: Sequence[Candidate]) -> list[Verdict]:
        """Return one verdict per candidate, in the same order as `candidates`."""
        ...
