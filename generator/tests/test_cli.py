import dataclasses
import json
import random
from collections.abc import Sequence
from datetime import date, timedelta
from pathlib import Path
from typing import Any, cast

import httpx
import pytest
from fakes import FakeBriefWriter, FakeForger, FakeJudge, by_group_width, deps, group

from spot_the_forgery import cli
from spot_the_forgery.budget import Budget
from spot_the_forgery.cli import HttpxFetcher, main, run_generate
from spot_the_forgery.forger import ForgerUnavailable
from spot_the_forgery.models import AspectRatio, Brief, Candidate
from spot_the_forgery.publish import load_index
from spot_the_forgery.seal import unseal

GROUPS = [group(n) for n in range(25)]
TODAY = date(2026, 10, 26)


def run(
    puzzles: Path,
    budget: Budget,
    days_ahead: int,
    forger: FakeForger | None = None,
    brief: FakeBriefWriter | None = None,
) -> int:
    forger = forger or FakeForger(budget=budget)
    services = deps(FakeJudge(by_group_width), forger, brief)
    return run_generate(TODAY, puzzles, GROUPS, services, budget, days_ahead=days_ahead)


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


def test_budget_running_out_on_a_future_date_stops_cleanly(tmp_path: Path):
    # Today takes 15 images. Tomorrow starts with 15 left, but its first three images
    # fail, and the group swap that follows needs three more than are left.
    budget = Budget(30)
    forger = FakeForger(budget=budget, fail_calls={16, 17, 18})
    assert run(tmp_path, budget, days_ahead=1, forger=forger) == 0
    assert load_index(tmp_path) == ["2026-10-26"]
    assert not (tmp_path / "2026-10-27").exists()


def test_budget_running_out_on_today_fails(tmp_path: Path):
    budget = Budget(15)
    forger = FakeForger(budget=budget, fail_calls={1, 2, 3})
    assert run(tmp_path, budget, days_ahead=0, forger=forger) == 1
    assert load_index(tmp_path) == []
    assert not (tmp_path / "2026-10-26").exists()


def test_unindexed_folder_fails_before_spending(tmp_path: Path):
    # publish_day refuses to overwrite a folder, so building the day would only waste images.
    (tmp_path / "2026-10-26").mkdir()
    budget = Budget(30)
    assert run(tmp_path, budget, days_ahead=0) == 1
    assert budget.remaining == 30


def test_day_failed_returns_1(tmp_path: Path):
    brief = FakeBriefWriter(fail_groups={g.key for g in GROUPS})
    assert run(tmp_path, Budget(30), days_ahead=0, brief=brief) == 1
    assert load_index(tmp_path) == []


class UnavailableForger:
    def generate(
        self, brief: Brief, reference_images: Sequence[bytes], aspect_ratio: AspectRatio
    ) -> Candidate:
        raise ForgerUnavailable("HTTP 402: no credits")


def test_unavailable_image_api_returns_1(tmp_path: Path):
    services = dataclasses.replace(deps(FakeJudge(by_group_width)), forger=UnavailableForger())
    assert run_generate(TODAY, tmp_path, GROUPS, services, Budget(30), days_ahead=0) == 1
    assert load_index(tmp_path) == []


def published(
    puzzles: Path, publish_rng: random.Random | None = None
) -> tuple[list[list[str]], list[int]]:
    """Build TODAY into `puzzles`; return each round's image names and fake position."""
    services = deps(FakeJudge(by_group_width))
    if publish_rng is None:
        assert run_generate(TODAY, puzzles, GROUPS, services, Budget(30), days_ahead=0) == 0
    else:
        assert (
            run_generate(
                TODAY, puzzles, GROUPS, services, Budget(30), days_ahead=0, publish_rng=publish_rng
            )
            == 0
        )
    puzzle = json.loads((puzzles / TODAY.isoformat() / "puzzle.json").read_text())
    reveals = cast(list[dict[str, Any]], unseal(puzzle["sealed"], TODAY.isoformat())["rounds"])
    return [r["images"] for r in puzzle["rounds"]], [r["fakeIndex"] for r in reveals]


def test_answers_cannot_be_computed_from_the_date(tmp_path: Path):
    # The repo is public: a date-seeded shuffle would let anyone work out every answer.
    runs = [published(tmp_path / str(n)) for n in range(6)]
    assert len({str(names) for names, _ in runs}) == len(runs)
    assert len({tuple(fakes) for _, fakes in runs}) > 1


def test_publish_randomness_can_be_injected(tmp_path: Path):
    assert published(tmp_path / "a", random.Random(7)) == published(
        tmp_path / "b", random.Random(7)
    )


def test_missing_api_keys_exit_2(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-secret-value")
    assert main(["generate"]) == 2
    err = capsys.readouterr().err
    assert "ANTHROPIC_API_KEY" in err
    assert "sk-or-secret-value" not in err


@pytest.fixture
def wiring(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Stand in for the catalog refresh and run_generate, and record how main calls them."""
    seen: dict[str, Any] = {}
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-anthropic")
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-openrouter")

    def refresh(path: Path, client: httpx.Client, now, max_age=timedelta(days=7)):
        seen["catalog"], seen["max_age"] = path, max_age
        return GROUPS

    def generate(today, puzzles_dir, groups, services, budget, days_ahead):
        seen.update(today=today, puzzles_dir=puzzles_dir, budget=budget.remaining)
        seen["days_ahead"] = days_ahead
        return 0

    monkeypatch.setattr(cli, "refresh_if_stale", refresh)
    monkeypatch.setattr(cli, "run_generate", generate)
    return seen


def test_generate_passes_its_flags_through(wiring: dict[str, Any]):
    argv = ["generate", "--puzzles-dir", "out", "--catalog", "c.json", "--days-ahead", "0"]
    assert main([*argv, "--max-images", "30", "--today", "2026-11-02"]) == 0
    assert wiring == {
        "catalog": Path("c.json"),
        "max_age": timedelta(days=7),
        "today": date(2026, 11, 2),
        "puzzles_dir": Path("out"),
        "budget": 30,
        "days_ahead": 0,
    }


def test_generate_builds_only_today_by_default(wiring: dict[str, Any]):
    # Puzzles are weekly, so a plain `stf generate` must not build the next few days too.
    assert main(["generate"]) == 0
    assert wiring["days_ahead"] == 0


def test_dry_run_builds_one_date_into_its_folder(wiring: dict[str, Any]):
    assert main(["dry-run", "--date", "2026-11-02", "--out", "scratch"]) == 0
    assert (wiring["today"], wiring["puzzles_dir"]) == (date(2026, 11, 2), Path("scratch"))
    assert (wiring["days_ahead"], wiring["budget"]) == (0, 15)


def test_refresh_catalog_always_downloads(wiring: dict[str, Any], monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY")  # no keys needed
    assert main(["refresh-catalog", "--catalog", "c.json"]) == 0
    assert wiring == {"catalog": Path("c.json"), "max_age": timedelta(0)}


def test_httpx_fetcher_returns_body_and_raises_for_errors():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/ok.jpg":
            return httpx.Response(200, content=b"jpeg bytes")
        return httpx.Response(404)

    fetcher = HttpxFetcher(httpx.Client(transport=httpx.MockTransport(handler)))
    assert fetcher.fetch("https://cdn.test/ok.jpg") == b"jpeg bytes"
    with pytest.raises(httpx.HTTPStatusError):
        fetcher.fetch("https://cdn.test/gone.jpg")
