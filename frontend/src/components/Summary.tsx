import { useState } from "react";
import { score, shareText } from "../lib/game";
import type { Puzzle } from "../lib/types";

interface Props {
  puzzle: Puzzle;
  results: boolean[];
  streaks: { current: number; best: number };
  shareUrl: string;
}

export function Summary({ puzzle, results, streaks, shareUrl }: Props) {
  const [status, setStatus] = useState("");
  const text = shareText(puzzle.number, results, shareUrl);

  async function share() {
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setStatus("Copied!");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setStatus("Couldn't share — copy the text above instead.");
    }
  }

  return (
    <section aria-labelledby="summary-title" className="text-center">
      <h2 id="summary-title" className="font-serif text-2xl">
        Today's result
      </h2>
      <p className="mt-4 text-5xl font-bold">{`${score(results)}/${results.length}`}</p>
      <dl className="mt-6 flex justify-center gap-10">
        <div>
          <dt className="text-sm text-stone-400">Current streak</dt>
          <dd className="text-2xl">{streaks.current}</dd>
        </div>
        <div>
          <dt className="text-sm text-stone-400">Best streak</dt>
          <dd className="text-2xl">{streaks.best}</dd>
        </div>
      </dl>
      <pre
        data-testid="share-text"
        className="mx-auto mt-6 w-fit rounded bg-stone-900 px-4 py-3 text-left font-sans whitespace-pre-wrap"
      >
        {text}
      </pre>
      <button
        type="button"
        onClick={share}
        className="mt-4 rounded bg-amber-400 px-6 py-3 font-semibold text-stone-950 hover:bg-amber-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200"
      >
        Share
      </button>
      <p aria-live="polite" className="mt-2 h-6 text-sm text-stone-300">
        {status}
      </p>
      <p className="mt-6 text-stone-400">A new set arrives at midnight UTC.</p>
    </section>
  );
}
