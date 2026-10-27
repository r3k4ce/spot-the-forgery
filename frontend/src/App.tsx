import { useEffect, useState } from "react";
import { Archive } from "./components/Archive";
import { Game } from "./components/Game";
import { Help } from "./components/Help";
import { checkGuesses, score, shuffledOrder } from "./lib/game";
import { loadPuzzle } from "./lib/load";
import { ARCHIVE_HREF, LATEST_HREF, parseRoute } from "./lib/route";
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
      const result = await loadPuzzle(key);
      if (cancelled) return;
      if (!result) return setLoaded({ key, status: "missing" });
      const { puzzle, dates } = result;
      try {
        // Answers stay hidden in state until each round is guessed.
        const answers = await unseal(puzzle.sealed, puzzle.date);
        if (cancelled) return;
        setGuesses(loadProgress(puzzle.date).slice(0, puzzle.rounds.length));
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
              answers={load.answers}
              dates={load.dates}
              guesses={guesses}
              revealing={revealing}
              orders={shuffle?.date === load.puzzle.date ? shuffle.orders : undefined}
              onGuess={(index) => {
                const { date, rounds } = load.puzzle;
                const next = [...guesses, index];
                saveProgress(date, next);
                setGuesses(next);
                setRevealing(true);
                // A replay doesn't change the score that counts: only the first finish is kept.
                if (next.length === rounds.length && !(date in loadHistory())) {
                  const results = checkGuesses(next, load.answers);
                  recordResult(date, { score: score(results), total: rounds.length });
                }
              }}
              onNext={() => setRevealing(false)}
              onReplay={() => {
                const { date, rounds } = load.puzzle;
                setShuffle({ date, orders: rounds.map((r) => shuffledOrder(r.images.length)) });
                saveProgress(date, []);
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
