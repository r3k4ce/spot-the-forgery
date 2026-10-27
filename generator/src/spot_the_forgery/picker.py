"""Choose the day's groups and which of their paintings to show or use as references."""

import random
from collections.abc import Sequence
from datetime import date

from spot_the_forgery.models import Group, History, Pick

ROUNDS_PER_DAY = 5
GROUP_WINDOW_DAYS = 21
PAINTING_WINDOW_DAYS = 150
SHOWN = 3
MAX_REFERENCES = 3


class NotEnoughGroups(Exception):
    """Fewer eligible groups remain than the day needs."""


def day_rng(day: date) -> random.Random:
    return random.Random(day.isoformat())


def pick_group(group: Group, history: History, rng: random.Random) -> Pick | None:
    available = [p for p in group.paintings if p.id not in history.recent_paintings]
    if len(available) < SHOWN + 1:
        return None
    rng.shuffle(available)
    references_end = SHOWN + MAX_REFERENCES
    return Pick(
        group=group,
        shown=tuple(available[:SHOWN]),
        references=tuple(available[SHOWN:references_end]),
        spares=tuple(available[references_end:]),
    )


def pick_day(
    groups: Sequence[Group],
    history: History,
    rng: random.Random,
    count: int = ROUNDS_PER_DAY,
    exclude: frozenset[str] = frozenset(),
) -> list[Pick]:
    eligible = [g for g in groups if g.key not in history.recent_groups and g.key not in exclude]
    rng.shuffle(eligible)
    picks: list[Pick] = []
    for group in eligible:
        pick = pick_group(group, history, rng)
        if pick is not None:
            picks.append(pick)
            if len(picks) == count:
                return picks
    raise NotEnoughGroups(f"needed {count} groups, found {len(picks)}")
