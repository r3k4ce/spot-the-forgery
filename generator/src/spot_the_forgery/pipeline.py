"""Build a round (one fake among three real paintings) and a full day of rounds."""

import logging
import random
from collections.abc import Sequence
from dataclasses import dataclass

from spot_the_forgery.models import (
    BriefWriter,
    BuiltRound,
    Candidate,
    Group,
    History,
    ImageFetcher,
    ImageGenerator,
    Judge,
    Painting,
    Pick,
    RoundFailed,
    Verdict,
)
from spot_the_forgery.normalize import aspect_ok
from spot_the_forgery.picker import ROUNDS_PER_DAY, NotEnoughGroups, pick_day

CANDIDATES_PER_ROUND = 3
MIN_CONVINCING = 4
MAX_GROUP_SWAPS = 5
ATTEMPTS_PER_ROUND = 2

log = logging.getLogger(__name__)


class DayFailed(Exception):
    """A full day of rounds could not be built."""


@dataclass(frozen=True)
class Deps:
    fetcher: ImageFetcher
    brief_writer: BriefWriter
    forger: ImageGenerator
    judge: Judge


def _fetch_shown(pick: Pick, fetcher: ImageFetcher) -> tuple[Pick, tuple[bytes, ...]]:
    spares = list(pick.spares)
    shown: list[Painting] = []
    images: list[bytes] = []
    for painting in pick.shown:
        data = fetcher.fetch(painting.image_url)
        while not aspect_ok(data):
            if not spares:
                raise RoundFailed(f"no painting with a usable aspect ratio in {pick.group.key}")
            painting = spares.pop(0)
            data = fetcher.fetch(painting.image_url)
        shown.append(painting)
        images.append(data)
    swapped = Pick(
        group=pick.group, shown=tuple(shown), references=pick.references, spares=tuple(spares)
    )
    return swapped, tuple(images)


def _candidates(deps: Deps, pick: Pick, references: Sequence[bytes]) -> list[Candidate]:
    brief = deps.brief_writer.write(pick, references)
    candidates: list[Candidate] = []
    for _ in range(CANDIDATES_PER_ROUND):
        try:
            candidates.append(deps.forger.generate(brief, references))
        except RoundFailed as exc:
            log.warning("candidate failed for %s: %s", pick.group.key, exc)
    if not candidates:
        raise RoundFailed(f"no candidates generated for {pick.group.key}")
    return candidates


def build_round(pick: Pick, deps: Deps) -> BuiltRound:
    pick, shown_images = _fetch_shown(pick, deps.fetcher)
    references = [deps.fetcher.fetch(p.image_url) for p in pick.references]
    best: tuple[Candidate, Verdict] | None = None
    for attempt in range(1, ATTEMPTS_PER_ROUND + 1):
        candidates = _candidates(deps, pick, references)
        verdicts = deps.judge.judge(shown_images, candidates)
        best = max(zip(candidates, verdicts, strict=True), key=lambda cv: cv[1].convincing)
        log.info("%s attempt %d: best score %d", pick.group.label, attempt, best[1].convincing)
        if best[1].convincing >= MIN_CONVINCING:
            return BuiltRound(pick=pick, shown_images=shown_images, fake=best[0], verdict=best[1])
    raise RoundFailed(f"forgeries for {pick.group.key} were too obvious")


def build_day(
    groups: Sequence[Group], history: History, rng: random.Random, deps: Deps
) -> list[BuiltRound]:
    try:
        queue = pick_day(groups, history, rng, count=ROUNDS_PER_DAY)
    except NotEnoughGroups as exc:
        raise DayFailed(str(exc)) from exc
    tried = {p.group.key for p in queue}
    rounds: list[BuiltRound] = []
    swaps = 0
    while queue:
        pick = queue.pop(0)
        try:
            rounds.append(build_round(pick, deps))
            continue
        except RoundFailed as exc:
            log.warning("round for %s failed: %s", pick.group.key, exc)
        swaps += 1
        if swaps > MAX_GROUP_SWAPS:
            raise DayFailed(f"gave up after {MAX_GROUP_SWAPS} group swaps")
        try:
            replacement = pick_day(groups, history, rng, count=1, exclude=frozenset(tried))[0]
        except NotEnoughGroups as exc:
            raise DayFailed("no replacement group left") from exc
        tried.add(replacement.group.key)
        queue.append(replacement)
    return sorted(rounds, key=lambda r: r.verdict.convincing)
