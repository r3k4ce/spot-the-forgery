import { puzzleHref } from "../lib/route";
import { loadHistory, loadProgress } from "../lib/storage";

interface Props {
  dates: string[];
}

function status(date: string, history: ReturnType<typeof loadHistory>): string {
  const result = history[date];
  if (result) return `Scored ${result.score}/${result.total}`;
  return loadProgress(date).guesses.length > 0 ? "In progress" : "Not played";
}

export function Archive({ dates }: Props) {
  const history = loadHistory();
  // Numbered by position, the same way the generator numbers puzzles; newest first.
  const entries = dates.map((date, i) => ({ date, number: i + 1 })).reverse();

  return (
    <section aria-labelledby="archive-title">
      <h2 id="archive-title" className="mb-4 text-center font-serif text-2xl">
        Archive
      </h2>
      <ul className="mx-auto max-w-md divide-y divide-stone-800 rounded border border-stone-800">
        {entries.map(({ date, number }) => (
          <li key={date} className="flex items-center justify-between gap-4 px-4 py-3">
            <a
              href={puzzleHref(date)}
              className="font-serif text-amber-300 underline hover:text-amber-200 focus-visible:outline-2 focus-visible:outline-amber-400"
            >
              Puzzle #{number} · {date}
            </a>
            <span className="text-sm text-stone-400">{status(date, history)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
