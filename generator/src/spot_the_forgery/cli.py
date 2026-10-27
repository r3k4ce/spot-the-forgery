"""`stf` command: build puzzles into the static site."""

import argparse
import logging
import os
import sys
from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import anthropic
import httpx

from spot_the_forgery.budget import Budget, BudgetExceeded
from spot_the_forgery.catalog import refresh_if_stale
from spot_the_forgery.claude import DEFAULT_MODEL, ClaudeBriefWriter, ClaudeJudge
from spot_the_forgery.forger import ForgerUnavailable, OpenRouterImageGenerator
from spot_the_forgery.models import Group
from spot_the_forgery.picker import day_rng
from spot_the_forgery.pipeline import MIN_IMAGES_PER_DAY, DayFailed, Deps, build_day
from spot_the_forgery.publish import load_history, load_index, publish_day, puzzle_dir

REQUIRED_ENV = ("ANTHROPIC_API_KEY", "OPENROUTER_API_KEY")

log = logging.getLogger("stf")


class HttpxFetcher:
    def __init__(self, client: httpx.Client) -> None:
        self._client = client

    def fetch(self, url: str) -> bytes:
        response = self._client.get(url)
        response.raise_for_status()
        return response.content


def run_generate(
    today: date,
    puzzles_dir: Path,
    groups: Sequence[Group],
    deps: Deps,
    budget: Budget,
    days_ahead: int,
) -> int:
    published = set(load_index(puzzles_dir))
    for offset in range(days_ahead + 1):
        day = today + timedelta(days=offset)
        if day.isoformat() in published:
            continue
        if puzzle_dir(puzzles_dir, day).exists():
            # publish_day would refuse it, so building it would only waste paid images.
            log.error("%s has a puzzle folder but is not in the index", day)
            return 1
        if budget.remaining < MIN_IMAGES_PER_DAY:
            log.info("budget too low to start %s (%d left); stopping", day, budget.remaining)
            return 0
        try:
            rounds = build_day(groups, load_history(puzzles_dir, day), day_rng(day), deps)
        except BudgetExceeded:
            if day == today:
                log.error("could not build %s: image budget ran out", day)
                return 1
            # A future date has later runs to finish it; nothing partial was published.
            log.warning("image budget ran out while building %s; stopping", day)
            return 0
        except (DayFailed, ForgerUnavailable) as exc:
            log.error("could not build %s: %s", day, exc)
            return 1
        publish_day(puzzles_dir, day, rounds, day_rng(day))
        log.info("published %s: %s", day, ", ".join(r.pick.group.label for r in rounds))
    return 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="stf", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    generate = sub.add_parser(
        "generate", help="build today's puzzle, plus the next N days with --days-ahead N"
    )
    generate.add_argument("--puzzles-dir", type=Path, default=Path("../frontend/public/puzzles"))
    generate.add_argument("--catalog", type=Path, default=Path("data/catalog.json"))
    # Puzzles are weekly, so by default only today's is built.
    generate.add_argument(
        "--days-ahead", type=int, default=0, metavar="N", help="also build the next N days"
    )
    generate.add_argument("--max-images", type=int, default=30)
    generate.add_argument("--today", type=date.fromisoformat, default=None)

    dry = sub.add_parser("dry-run", help="build one date into a folder (real, paid API calls)")
    dry.add_argument("--date", type=date.fromisoformat, required=True)
    dry.add_argument("--out", type=Path, required=True)
    dry.add_argument("--catalog", type=Path, default=Path("data/catalog.json"))
    dry.add_argument("--max-images", type=int, default=15)

    refresh = sub.add_parser("refresh-catalog", help="re-download the museum catalog")
    refresh.add_argument("--catalog", type=Path, default=Path("data/catalog.json"))
    return parser


def _http_client() -> httpx.Client:
    return httpx.Client(
        transport=httpx.HTTPTransport(retries=3),
        timeout=30,
        headers={"User-Agent": "spot-the-forgery/0.1 (weekly puzzle generator)"},
        follow_redirects=True,
    )


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    now = datetime.now(UTC)

    if args.command == "refresh-catalog":
        with _http_client() as http:
            groups = refresh_if_stale(args.catalog, http, now, max_age=timedelta(0))
        log.info("catalog has %d groups", len(groups))
        return 0

    missing = [name for name in REQUIRED_ENV if not os.environ.get(name)]
    if missing:
        print(f"stf: missing environment variable(s): {', '.join(missing)}", file=sys.stderr)
        return 2

    budget = Budget(args.max_images)
    model = os.environ.get("STF_JUDGE_MODEL", DEFAULT_MODEL)
    claude = anthropic.Anthropic()
    with _http_client() as http:
        groups = refresh_if_stale(args.catalog, http, now)
        deps = Deps(
            fetcher=HttpxFetcher(http),
            brief_writer=ClaudeBriefWriter(claude, model),
            forger=OpenRouterImageGenerator(http, os.environ["OPENROUTER_API_KEY"], budget),
            judge=ClaudeJudge(claude, model),
        )
        if args.command == "dry-run":
            return run_generate(args.date, args.out, groups, deps, budget, days_ahead=0)
        today = args.today or now.date()
        return run_generate(
            today, args.puzzles_dir, groups, deps, budget, days_ahead=args.days_ahead
        )


if __name__ == "__main__":
    raise SystemExit(main())
