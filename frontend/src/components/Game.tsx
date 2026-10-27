import { useEffect, useRef, useState } from "react";
import { preload } from "react-dom";
import { checkGuesses, computeStreaks, nextPuzzleTime, score } from "../lib/game";
import { imageUrl } from "../lib/load";
import { puzzleHref } from "../lib/route";
import { loadHistory, loadProgress, recordResult, saveProgress } from "../lib/storage";
import type { Puzzle, SealedPayload } from "../lib/types";
import { Progress } from "./Progress";
import { RoundView } from "./RoundView";
import { Summary } from "./Summary";

interface Props {
  puzzle: Puzzle;
  answers: SealedPayload;
  // Every playable date, oldest first; the last one is the latest puzzle.
  dates: string[];
  isLatest: boolean;
  // Guesses made this visit, by date; they win over storage, which may not have kept them.
  played: Map<string, number[]>;
  // Painting positions per round for a replay; the original order otherwise.
  orders: number[][] | undefined;
  // Asks for a new arrangement of the paintings; the guesses are reset here.
  onReplay: () => void;
}

// The latest puzzle shares the plain address; a past one links straight to itself.
function shareUrl(date: string, isLatest: boolean): string {
  const page = location.href.split("#")[0];
  return isLatest ? page : `${page}${puzzleHref(date)}`;
}

// One puzzle being played. App gives each puzzle its own Game (keyed by date), so the guesses
// here always belong to this puzzle, whatever loads or reloads around it.
export function Game({ puzzle, answers, dates, isLatest, played, orders, onReplay }: Props) {
  const { date, rounds } = puzzle;
  const total = rounds.length;
  const [guesses, setGuesses] = useState(() =>
    (played.get(date) ?? loadProgress(date)).slice(0, total),
  );
  // Whether the latest guess's answer is on screen.
  const [revealing, setRevealing] = useState(false);
  const results = checkGuesses(guesses, answers);
  const src = (file: string) => imageUrl(date, file);
  // The button that was pressed goes away with each step, so focus would drop to the page. Only
  // the player's own actions set this, so a load or reload leaves focus where the browser puts it.
  const pendingFocus = useRef<"next" | "heading" | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  // The round's heading, or the results heading once the puzzle is done.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // Runs after a closing zoomed view has handed focus back to its painting, so this wins.
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (target === "next") nextRef.current?.focus();
    else if (target === "heading") headingRef.current?.focus();
  });

  function keep(next: number[]) {
    played.set(date, next);
    saveProgress(date, next);
    setGuesses(next);
  }

  function guess(index: number) {
    const next = [...guesses, index];
    keep(next);
    setRevealing(true);
    pendingFocus.current = "next";
    // A replay doesn't change the score that counts: only the first finish is kept.
    if (next.length === total && !(date in loadHistory())) {
      const finished = checkGuesses(next, answers);
      recordResult(date, { score: score(finished), total, results: finished });
    }
  }

  function replay() {
    keep([]);
    setRevealing(false);
    pendingFocus.current = "heading";
    onReplay();
  }

  // On to the next round, or to the results after the last one.
  function moveOn() {
    setRevealing(false);
    pendingFocus.current = "heading";
  }

  if (guesses.length >= total && !revealing) {
    const history = loadHistory();
    return (
      <Summary
        puzzle={puzzle}
        results={results}
        firstResults={history[date]?.results}
        streaks={computeStreaks(history, dates)}
        shareUrl={shareUrl(date, isLatest)}
        answers={answers}
        guesses={guesses}
        imageUrl={src}
        nextPuzzle={isLatest ? nextPuzzleTime(date) : null}
        onReplay={replay}
        headingRef={headingRef}
      />
    );
  }

  const index = revealing ? guesses.length - 1 : guesses.length;
  // Fetch the next round's paintings while this one is played, so Next round is instant.
  for (const file of rounds[index + 1]?.images ?? []) {
    preload(src(file), { as: "image" });
  }
  return (
    <>
      <Progress results={results} current={index} total={total} />
      <p className="mb-2 text-center text-sm text-stone-400">
        Round {index + 1} of {total}
      </p>
      <RoundView
        key={index}
        round={rounds[index]}
        imageUrl={src}
        reveal={revealing ? (answers.rounds[index] ?? null) : null}
        order={orders?.[index]}
        onGuess={guess}
        headingRef={headingRef}
      />
      {revealing && (
        <div className="mt-6 text-center">
          <button
            ref={nextRef}
            type="button"
            onClick={moveOn}
            className="rounded border border-amber-400 px-6 py-3 font-semibold text-amber-300 hover:bg-stone-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200"
          >
            {guesses.length === total ? "See results" : "Next round"}
          </button>
        </div>
      )}
    </>
  );
}
