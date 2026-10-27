import { useEffect, useState } from "react";
import { preload } from "react-dom";
import { Archive } from "./components/Archive";
import { Help } from "./components/Help";
import { Progress } from "./components/Progress";
import { RoundView } from "./components/RoundView";
import { Summary } from "./components/Summary";
import { computeStreaks, nextPuzzleTime, score, shuffledOrder } from "./lib/game";
import { loadPuzzle } from "./lib/load";
import { ARCHIVE_HREF, LATEST_HREF, parseRoute, puzzleHref } from "./lib/route";
import { unseal } from "./lib/seal";
import {
  hasSeenHelp,
  loadHistory,
  loadProgress,
  markHelpSeen,
  recordResult,
  saveProgress,
} from "./lib/storage";
import type { Puzzle, SealedPayload } from "./lib/types";

const BASE = import.meta.env.BASE_URL;

// Each result remembers which date it was loaded for, so a stale one reads as loading.
type Loaded = { key: string | undefined } & (
  | { status: "missing" }
  | { status: "error" }
  | { status: "ready"; puzzle: Puzzle; dates: string[]; answers: SealedPayload }
);
type Load = { status: "loading" } | Loaded;

export default function App() {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [guesses, setGuesses] = useState<number[]>([]);
  const [revealing, setRevealing] = useState(false);
  // Painting positions for a replay, per round; only for the puzzle that was replayed.
  const [shuffle, setShuffle] = useState<{ date: string; orders: number[][] } | null>(null);
  // First-time visitors get the rules before anything else.
  const [helpOpen, setHelpOpen] = useState(() => !hasSeenHelp());
  const requested = route.view === "puzzle" ? route.date : undefined;
  const load: Load = loaded && loaded.key === requested ? loaded : { status: "loading" };

  useEffect(() => {
    const onHash = () => {
      setRoute(parseRoute(location.hash));
      setRevealing(false);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const key = requested;
    (async () => {
      // The archive needs the list of dates, which comes with the latest puzzle.
      const result = await loadPuzzle(BASE, undefined, undefined, key);
      if (cancelled) return;
      if (!result) return setLoaded({ key, status: "missing" });
      const { puzzle, dates } = result;
      try {
        // Answers stay hidden in state until each round is guessed.
        const answers = await unseal(puzzle.sealed, puzzle.date);
        if (cancelled) return;
        setGuesses(loadProgress(puzzle.date).guesses.slice(0, puzzle.rounds.length));
        setLoaded({ key, status: "ready", puzzle, dates, answers });
      } catch {
        if (!cancelled) setLoaded({ key, status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requested]);

  const showPuzzle = load.status === "ready" && route.view === "puzzle";
  const isLatest = load.status === "ready" && load.puzzle.date === load.dates.at(-1);

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-6">
        <nav className="mb-4 flex items-center justify-between text-sm">
          <a
            href={ARCHIVE_HREF}
            className="text-stone-300 underline hover:text-amber-300 focus-visible:outline-2 focus-visible:outline-amber-400"
          >
            Archive
          </a>
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            aria-label="How to play"
            title="How to play"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-stone-600 font-semibold text-stone-300 hover:border-amber-300 hover:text-amber-300 focus-visible:outline-2 focus-visible:outline-amber-400"
          >
            ?
          </button>
        </nav>
        <header className="mb-6 text-center">
          <h1 className="font-serif text-3xl tracking-wide">
            {showPuzzle ? `Spot the Forgery #${load.puzzle.number}` : "Spot the Forgery"}
          </h1>
          {showPuzzle && <p className="mt-1 text-sm text-stone-400">{load.puzzle.date}</p>}
          {showPuzzle && !isLatest && (
            <p className="mt-1 text-sm">
              <a href={LATEST_HREF} className="text-amber-300 underline hover:text-amber-200">
                Back to the latest puzzle
              </a>
            </p>
          )}
        </header>

        <main className="flex-1">
          {load.status === "loading" && <p className="text-center text-stone-400">Loading…</p>}
          {load.status === "missing" && (
            <p className="text-center">No puzzle yet — check back soon.</p>
          )}
          {load.status === "error" && (
            <p className="text-center">This puzzle couldn't be opened. Try reloading the page.</p>
          )}
          {load.status === "ready" && route.view === "archive" && <Archive dates={load.dates} />}
          {showPuzzle && (
            <Game
              puzzle={load.puzzle}
              dates={load.dates}
              isLatest={isLatest}
              answers={load.answers}
              guesses={guesses}
              revealing={revealing}
              onGuess={(index) => {
                const next = [...guesses, index];
                saveProgress({ date: load.puzzle.date, guesses: next });
                setGuesses(next);
                setRevealing(true);
                const total = load.puzzle.rounds.length;
                // A replay doesn't change the score that counts: only the first finish is kept.
                if (next.length === total && !(load.puzzle.date in loadHistory())) {
                  const results = next.map((g, i) => g === load.answers.rounds[i]?.fakeIndex);
                  recordResult(load.puzzle.date, { score: score(results), total });
                }
              }}
              onNext={() => setRevealing(false)}
              orders={shuffle?.date === load.puzzle.date ? shuffle.orders : undefined}
              onReplay={() => {
                const { date, rounds } = load.puzzle;
                setShuffle({ date, orders: rounds.map((r) => shuffledOrder(r.images.length)) });
                saveProgress({ date: load.puzzle.date, guesses: [] });
                setGuesses([]);
                setRevealing(false);
              }}
            />
          )}
        </main>

        {helpOpen && (
          <Help
            onClose={() => {
              markHelpSeen();
              setHelpOpen(false);
            }}
          />
        )}

        <footer className="mt-10 border-t border-stone-800 pt-4 text-center text-xs text-stone-500">
          Real paintings: Cleveland Museum of Art Open Access (CC0). Forgeries are AI-generated for
          this game.
        </footer>
      </div>
    </div>
  );
}

// The latest puzzle shares the plain address; a past one links straight to itself.
function shareUrl(date: string, isLatest: boolean): string {
  const page = location.href.split("#")[0];
  return isLatest ? page : `${page}${puzzleHref(date)}`;
}

interface GameProps {
  puzzle: Puzzle;
  dates: string[];
  isLatest: boolean;
  answers: SealedPayload;
  guesses: number[];
  revealing: boolean;
  onGuess: (index: number) => void;
  onNext: () => void;
  orders: number[][] | undefined;
  onReplay: () => void;
}

function Game({
  puzzle,
  dates,
  isLatest,
  answers,
  guesses,
  revealing,
  onGuess,
  onNext,
  orders,
  onReplay,
}: GameProps) {
  const total = puzzle.rounds.length;
  if (guesses.length >= total && !revealing) {
    const results = guesses.map((g, i) => g === answers.rounds[i]?.fakeIndex);
    return (
      <Summary
        puzzle={puzzle}
        results={results}
        streaks={computeStreaks(loadHistory(), dates)}
        shareUrl={shareUrl(puzzle.date, isLatest)}
        answers={answers}
        guesses={guesses}
        imageUrl={(file) => `${BASE}puzzles/${puzzle.date}/${file}`}
        nextPuzzle={isLatest ? nextPuzzleTime(puzzle.date) : null}
        onReplay={onReplay}
      />
    );
  }

  const index = revealing ? guesses.length - 1 : guesses.length;
  // Fetch the next round's paintings while this one is played, so Next round is instant.
  for (const file of puzzle.rounds[index + 1]?.images ?? []) {
    preload(`${BASE}puzzles/${puzzle.date}/${file}`, { as: "image" });
  }
  const results = guesses.map((g, i) => g === answers.rounds[i]?.fakeIndex);
  return (
    <>
      <Progress results={results} current={index} total={total} />
      <p className="mb-2 text-center text-sm text-stone-400">
        Round {index + 1} of {total}
      </p>
      <RoundView
        key={index}
        round={puzzle.rounds[index]}
        base={BASE}
        date={puzzle.date}
        reveal={revealing ? (answers.rounds[index] ?? null) : null}
        order={orders?.[index]}
        onGuess={onGuess}
      />
      {revealing && (
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={onNext}
            className="rounded border border-amber-400 px-6 py-3 font-semibold text-amber-300 hover:bg-stone-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200"
          >
            {guesses.length === total ? "See results" : "Next round"}
          </button>
        </div>
      )}
    </>
  );
}
