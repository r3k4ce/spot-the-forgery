from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import pytest
from fakes import FakeBriefWriter, FakeFetcher, FakeForger, FakeJudge, by_group_width, group

from spot_the_forgery.budget import Budget
from spot_the_forgery.cli import main, run_generate
from spot_the_forgery.models import Brief, Candidate
from spot_the_forgery.pipeline import Deps
from spot_the_forgery.publish import load_index

GROUPS = [group(n) for n in range(25)]
TODAY = date(2026, 10, 26)


@dataclass
class BudgetedForger:
    """Spends from the run's budget like the real forger does."""

    budget: Budget
    inner: FakeForger

    def generate(self, brief: Brief, reference_images: Sequence[bytes]) -> Candidate:
        self.budget.spend()
        return self.inner.generate(brief, reference_images)


def run(
    puzzles: Path,
    budget: Budget,
    days_ahead: int,
    forger: FakeForger | None = None,
    brief: FakeBriefWriter | None = None,
) -> int:
    deps = Deps(
        fetcher=FakeFetcher(),
        brief_writer=brief or FakeBriefWriter(),
        forger=BudgetedForger(budget, forger or FakeForger()),
        judge=FakeJudge(by_group_width),
    )
    return run_generate(TODAY, puzzles, GROUPS, deps, budget, days_ahead=days_ahead)


def test_generates_missing_dates_only(tmp_path: Path):
    assert run(tmp_path, Budget(60), days_ahead=1) == 0
    assert load_index(tmp_path) == ["2026-10-26", "2026-10-27"]
    budget = Budget(60)
    assert run(tmp_path, budget, days_ahead=3) == 0
    assert load_index(tmp_path) == ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"]
    assert budget.remaining == 30  # only two new dates were built


def test_stops_cleanly_when_budget_low(tmp_path: Path):
    assert run(tmp_path, Budget(20), days_ahead=2) == 0
    assert load_index(tmp_path) == ["2026-10-26"]


def test_mid_day_budget_exhaustion_fails(tmp_path: Path):
    assert run(tmp_path, Budget(30), days_ahead=0, forger=FakeForger(budget_after=4)) == 1
    assert load_index(tmp_path) == []
    assert not any(tmp_path.iterdir()) or not (tmp_path / "2026-10-26").exists()


def test_day_failed_returns_1(tmp_path: Path):
    brief = FakeBriefWriter(fail_groups={g.key for g in GROUPS})
    assert run(tmp_path, Budget(30), days_ahead=0, brief=brief) == 1
    assert load_index(tmp_path) == []


def test_missing_api_keys_exit_2(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-secret-value")
    assert main(["generate"]) == 2
    err = capsys.readouterr().err
    assert "ANTHROPIC_API_KEY" in err
    assert "sk-or-secret-value" not in err
