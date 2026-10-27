import { useState } from "react";
import { score, shareText } from "../lib/game";
import type { Puzzle } from "../lib/types";

interface Props {
  puzzle: Puzzle;
  results: boolean[];
  streaks: { current: number; best: number };
  shareUrl: string;
  onReplay: () => void;
}

// Where the async clipboard is blocked (no secure context, a denied permission, some embedded
// browsers), the older copy command still works from a click.
function copyWithSelection(text: string): boolean {
  if (typeof document.execCommand !== "function") return false;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  try {
    return document.execCommand("copy");
  } finally {
    area.remove();
  }
}

export function Summary({ puzzle, results, streaks, shareUrl, onReplay }: Props) {
  const [status, setStatus] = useState("");
  const text = shareText(puzzle.number, results, shareUrl);
  const canShare = typeof navigator.share === "function";

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied!");
      return;
    } catch {
      // Fall through to the selection-based copy.
    }
    setStatus(copyWithSelection(text) ? "Copied!" : "Couldn't copy — select the text above.");
  }

  async function share() {
    if (!canShare) return copy();
    try {
      await navigator.share({ text });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      await copy();
    }
  }

  return (
    <section aria-labelledby="summary-title" className="text-center">
      <h2 id="summary-title" className="font-serif text-2xl">
        Your result
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
      <div className="mt-4 flex justify-center gap-3">
        <button
          type="button"
          onClick={share}
          className="rounded bg-amber-400 px-6 py-3 font-semibold text-stone-950 hover:bg-amber-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200"
        >
          {canShare ? "Share" : "Copy result"}
        </button>
        <button
          type="button"
          onClick={onReplay}
          className="rounded border border-stone-600 px-6 py-3 font-semibold hover:bg-stone-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200"
        >
          Play again
        </button>
      </div>
      <p aria-live="polite" className="mt-2 h-6 text-sm text-stone-300">
        {status}
      </p>
      <p className="mt-6 text-stone-400">A new puzzle arrives every Monday.</p>
    </section>
  );
}
