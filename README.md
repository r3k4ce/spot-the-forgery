# Spot the Forgery

A daily web game: three real museum paintings and one AI forgery. Spot the fake.

Each day has five rounds. Every round shows four paintings from one group, either a named
artist or an anonymous culture and century. Three are real public-domain (CC0) paintings from
the [Cleveland Museum of Art Open Access](https://openaccess-api.clevelandart.org/) collection,
and one is an AI forgery made in the same style. Rounds get harder as the day goes on.

## How it works

- `generator/` is a Python package (the `stf` command). It picks groups from the museum
  catalog, has Claude write an image brief from three reference paintings, generates three
  forgery candidates through OpenRouter, has Claude judge which is most convincing, and writes
  the day's puzzle into `frontend/public/puzzles/<date>/`. The answers in `puzzle.json` are
  lightly obfuscated, not encrypted.
- `frontend/` is a static Vite + React site that reads those files. Puzzles change at
  midnight UTC.
- GitHub Actions builds puzzles for today through today + 3 every day at 03:00 UTC, commits
  them and redeploys GitHub Pages.

## Local setup

Requires [uv](https://docs.astral.sh/uv/) and Node 24.

```bash
cd generator && uv sync && uv run pytest
```

```bash
cd frontend && npm ci && npm test && npm run dev
```

## `stf` commands

Run these from `generator/`. `generate` and `dry-run` call paid APIs and need both keys
below set in the environment.

| Command | What it does |
| --- | --- |
| `uv run stf generate` | Builds any missing puzzles for today through today + 3 into `../frontend/public/puzzles`. Options: `--days-ahead 3`, `--max-images 30`, `--today YYYY-MM-DD`, `--puzzles-dir`, `--catalog`. |
| `uv run stf dry-run --date YYYY-MM-DD --out DIR` | Builds one date into a scratch folder (budget 15 images) so you can look at it before going live. |
| `uv run stf refresh-catalog` | Re-downloads the museum catalog into `data/catalog.json`. No API keys needed. `generate` refreshes it automatically when it is older than 7 days. |

`STF_JUDGE_MODEL` overrides the Claude model used for briefs and judging (default
`claude-haiku-5-5`).

Exit codes: `0` success (including stopping early because the image budget ran low), `1` a day
could not be built, `2` missing API keys.

## Deploying

1. Add two repository secrets under **Settings → Secrets and variables → Actions**:
   `ANTHROPIC_API_KEY` and `OPENROUTER_API_KEY`.
2. Under **Settings → Pages**, set **Source** to **GitHub Actions**.
3. Push to `main`. `pages.yml` deploys the site; `daily.yml` runs every day at 03:00 UTC, or
   from the Actions tab with an optional image budget.

Expected running cost is about $4 a month on OpenRouter: 15 FLUX 3 Klein images a day at
$0.009 each, and at most $0.27 on a day that hits the 30-image cap. The Claude calls run on
the Anthropic API key and aren't counted here. Measured on the first live dry run
(2026-10-27): 15 images, all from FLUX 3 Klein, $0.135 in total.

## Credits

Real paintings: Cleveland Museum of Art Open Access (CC0). Forgeries are AI-generated for this
game.
