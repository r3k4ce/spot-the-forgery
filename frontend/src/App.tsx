import { useEffect, useState } from "react";
import { RoundView } from "./components/RoundView";
import { Summary } from "./components/Summary";
import { computeStreaks, score } from "./lib/game";
import { loadPuzzle, todayUtc } from "./lib/load";
import { unseal } from "./lib/seal";
import { loadHistory, loadProgress, recordResult, saveProgress } from "./lib/storage";
import type { Puzzle, SealedPayload } from "./lib/types";

const BASE = import.meta.env.BASE_URL;

type Load =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "error" }
  | { status: "ready"; puzzle: Puzzle; answers: SealedPayload };

export default function App() {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [guesses, setGuesses] = useState<number[]>([]);
  const [revealing, setRevealing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const puzzle = await loadPuzzle(BASE);
      if (cancelled) return;
      if (!puzzle) return setLoad({ status: "missing" });
      try {
        // Answers stay hidden in state until each round is guessed.
        const answers = await unseal(puzzle.sealed, puzzle.date);
        if (cancelled) return;
        setGuesses(loadProgress(puzzle.date).guesses.slice(0, puzzle.rounds.length));
        setLoad({ status: "ready", puzzle, answers });
      } catch {
        if (!cancelled) setLoad({ status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-6">
        <header className="mb-6 text-center">
          <h1 className="font-serif text-3xl tracking-wide">
            {load.status === "ready" ? `Spot the Forgery #${load.puzzle.number}` : "Spot the Forgery"}
          </h1>
          {load.status === "ready" && <p className="mt-1 text-sm text-stone-400">{load.puzzle.date}</p>}
        </header>

        <main className="flex-1">
          {load.status === "loading" && <p className="text-center text-stone-400">Loading…</p>}
          {load.status === "missing" && (
            <p className="text-center">No puzzle today — check back soon.</p>
          )}
          {load.status === "error" && (
            <p className="text-center">Today's puzzle couldn't be opened. Try reloading the page.</p>
          )}
          {load.status === "ready" && (
            <Game
              puzzle={load.puzzle}
              answers={load.answers}
              guesses={guesses}
              revealing={revealing}
              onGuess={(index) => {
                const next = [...guesses, index];
                saveProgress({ date: load.puzzle.date, guesses: next });
                setGuesses(next);
                setRevealing(true);
                const total = load.puzzle.rounds.length;
                if (next.length === total) {
                  const results = next.map((g, i) => g === load.answers.rounds[i]?.fakeIndex);
                  recordResult(load.puzzle.date, { score: score(results), total });
                }
              }}
              onNext={() => setRevealing(false)}
            />
          )}
        </main>

        <footer className="mt-10 border-t border-stone-800 pt-4 text-center text-xs text-stone-500">
          Real paintings: Cleveland Museum of Art Open Access (CC0). Forgeries are AI-generated for
          this game.
        </footer>
      </div>
    </div>
  );
}

interface GameProps {
  puzzle: Puzzle;
  answers: SealedPayload;
  guesses: number[];
  revealing: boolean;
  onGuess: (index: number) => void;
  onNext: () => void;
}

function Game({ puzzle, answers, guesses, revealing, onGuess, onNext }: GameProps) {
  const total = puzzle.rounds.length;
  if (guesses.length >= total && !revealing) {
    const results = guesses.map((g, i) => g === answers.rounds[i]?.fakeIndex);
    return (
      <Summary
        puzzle={puzzle}
        results={results}
        streaks={computeStreaks(loadHistory(), todayUtc(new Date()))}
        shareUrl={location.href.split("#")[0]}
      />
    );
  }

  const index = revealing ? guesses.length - 1 : guesses.length;
  return (
    <>
      <p className="mb-2 text-center text-sm text-stone-400">
        Round {index + 1} of {total}
      </p>
      <RoundView
        key={index}
        round={puzzle.rounds[index]}
        base={BASE}
        date={puzzle.date}
        reveal={revealing ? (answers.rounds[index] ?? null) : null}
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
