"""Data shared by the pipeline stages, and the interfaces of the external services."""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal, Protocol

GroupKind = Literal["artist", "culture"]


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
    spares: tuple[Painting, ...]  # replacements for shown paintings with a bad aspect ratio


@dataclass(frozen=True)
class Brief:
    prompt: str
    aspect_ratio: str
    forbidden: tuple[str, ...]


@dataclass(frozen=True)
class Candidate:
    data: bytes
    media_type: str
    model: str


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
    def generate(self, brief: Brief, reference_images: Sequence[bytes]) -> Candidate: ...


class Judge(Protocol):
    def judge(self, shown: Sequence[bytes], candidates: Sequence[Candidate]) -> list[Verdict]:
        """Return one verdict per candidate, in the same order as `candidates`."""
        ...
