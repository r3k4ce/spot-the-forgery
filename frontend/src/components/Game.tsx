import { preload } from "react-dom";
import { checkGuesses, computeStreaks, nextPuzzleTime } from "../lib/game";
import { imageUrl } from "../lib/load";
import { puzzleHref } from "../lib/route";
import { loadHistory } from "../lib/storage";
import type { Puzzle, SealedPayload } from "../lib/types";
import { Progress } from "./Progress";
import { RoundView } from "./RoundView";
import { Summary } from "./Summary";

interface Props {
  puzzle: Puzzle;
  answers: SealedPayload;
  // Every playable date, oldest first; the last one is the latest puzzle.
  dates: string[];
  guesses: number[];
  revealing: boolean;
  // Painting positions per round for a replay; the original order otherwise.
  orders: number[][] | undefined;
  onGuess: (index: number) => void;
  onNext: () => void;
  onReplay: () => void;
}

// The latest puzzle shares the plain address; a past one links straight to itself.
function shareUrl(date: string, isLatest: boolean): string {
  const page = location.href.split("#")[0];
  return isLatest ? page : `${page}${puzzleHref(date)}`;
}

export function Game({
  puzzle,
  answers,
  dates,
  guesses,
  revealing,
  orders,
  onGuess,
  onNext,
  onReplay,
}: Props) {
  const total = puzzle.rounds.length;
  const isLatest = puzzle.date === dates.at(-1);
  const results = checkGuesses(guesses, answers);
  const src = (file: string) => imageUrl(puzzle.date, file);

  if (guesses.length >= total && !revealing) {
    return (
      <Summary
        puzzle={puzzle}
        results={results}
        streaks={computeStreaks(loadHistory(), dates)}
        shareUrl={shareUrl(puzzle.date, isLatest)}
        answers={answers}
        guesses={guesses}
        imageUrl={src}
        nextPuzzle={isLatest ? nextPuzzleTime(puzzle.date) : null}
        onReplay={onReplay}
      />
    );
  }

  const index = revealing ? guesses.length - 1 : guesses.length;
  // Fetch the next round's paintings while this one is played, so Next round is instant.
  for (const file of puzzle.rounds[index + 1]?.images ?? []) {
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
        round={puzzle.rounds[index]}
        imageUrl={src}
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
