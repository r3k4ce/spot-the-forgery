import random

import pytest
from fakes import (
    NO_HISTORY,
    FakeBriefWriter,
    FakeFetcher,
    FakeForger,
    FakeJudge,
    by_group_width,
    deps,
    group,
    pick_of,
    scripted,
    width_of,
)

from spot_the_forgery.budget import BudgetExceeded
from spot_the_forgery.models import RoundFailed
from spot_the_forgery.pipeline import DayFailed, build_day, build_round


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
