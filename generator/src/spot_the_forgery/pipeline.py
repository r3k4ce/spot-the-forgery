"""Build a round (one fake among three real paintings) and a full day of rounds."""

import dataclasses
import logging
import random
from collections.abc import Sequence
from dataclasses import dataclass

import httpx

from spot_the_forgery.models import (
    SUPPORTED_ASPECTS,
    AspectRatio,
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
)
from spot_the_forgery.normalize import (
    aspect_of,
    aspect_ok,
    crop_to_aspect,
    nearest_aspect,
    sniff_media_type,
)
from spot_the_forgery.picker import ROUNDS_PER_DAY, NotEnoughGroups, pick_day

CANDIDATES_PER_ROUND = 3
# What a day costs when every round succeeds first time; retries and swaps cost more.
MIN_IMAGES_PER_DAY = ROUNDS_PER_DAY * CANDIDATES_PER_ROUND
MIN_CONVINCING = 4
# Most swaps are free (a group whose paintings fail the shape check costs no images); the
# run's image budget, not this limit, is what caps spending.
MAX_GROUP_SWAPS = 20
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


def _fetch(fetcher: ImageFetcher, painting: Painting) -> bytes | None:
    """The painting's image, or None for a dead link or a body that isn't an image."""
    try:
        data = fetcher.fetch(painting.image_url)
        sniff_media_type(data)
    except (httpx.HTTPError, OSError, ValueError) as exc:
        log.warning("unusable image for painting %s: %s", painting.id, exc)
        return None
    return data


def _fetch_shown(pick: Pick, fetcher: ImageFetcher) -> tuple[Pick, tuple[bytes, ...]]:
    spares = list(pick.spares)
    shown: list[Painting] = []
    images: list[bytes] = []
    for painting in pick.shown:
        data = _fetch(fetcher, painting)
        while data is None or not aspect_ok(data):
            if not spares:
                raise RoundFailed(f"no usable painting left in {pick.group.key}")
            painting = spares.pop(0)
            data = _fetch(fetcher, painting)
        shown.append(painting)
        images.append(data)
    swapped = Pick(
        group=pick.group, shown=tuple(shown), references=pick.references, spares=tuple(spares)
    )
    return swapped, tuple(images)


def _fetch_references(pick: Pick, fetcher: ImageFetcher) -> list[bytes]:
    references: list[bytes] = []
    for painting in pick.references:
        data = _fetch(fetcher, painting)
        if data is None:
            raise RoundFailed(f"reference painting {painting.id} is unavailable")
        references.append(data)
    return references


def _candidates(
    deps: Deps, pick: Pick, references: Sequence[bytes], aspect: AspectRatio
) -> list[Candidate]:
    # The brief's own aspect ratio is replaced: the fake must match a shown painting.
    brief = dataclasses.replace(deps.brief_writer.write(pick, references), aspect_ratio=aspect)
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
    references = _fetch_references(pick, deps.fetcher)
    # The fake takes the exact shape of the first shown painting, so its proportions
    # don't stand out from the real ones.
    target = aspect_of(shown_images[0])
    aspect = nearest_aspect(target, SUPPORTED_ASPECTS)
    for attempt in range(1, ATTEMPTS_PER_ROUND + 1):
        candidates = _candidates(deps, pick, references, aspect)
        verdicts = deps.judge.judge(shown_images, candidates)
        best, verdict = max(zip(candidates, verdicts, strict=True), key=lambda cv: cv[1].convincing)
        log.info("%s attempt %d: best score %d", pick.group.label, attempt, verdict.convincing)
        if verdict.convincing >= MIN_CONVINCING:
            fake = dataclasses.replace(best, data=crop_to_aspect(best.data, target))
            return BuiltRound(pick=pick, shown_images=shown_images, fake=fake, verdict=verdict)
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
