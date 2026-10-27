import type { PuzzleRound, RoundReveal } from "../lib/types";

interface Props {
  rounds: PuzzleRound[];
  answers: RoundReveal[];
  // Whether each round was spotted, as the score counts it.
  results: boolean[];
  guesses: number[];
  imageUrl: (file: string) => string;
}

function describe(round: number, painting: number, isFake: boolean, isGuess: boolean): string {
  const notes = [isFake && "the AI forgery", isGuess && "your guess"].filter(Boolean).join(", ");
  return `Round ${round}, painting ${painting}${notes ? `: ${notes}` : ""}`;
}

export function Review({ rounds, answers, results, guesses, imageUrl }: Props) {
  return (
    <section aria-labelledby="review-title" className="mt-10 text-left">
      <h3 id="review-title" className="mb-3 text-center font-serif text-xl">
        Review rounds
      </h3>
      <div className="space-y-2">
        {rounds.map((round, r) => {
          const answer = answers[r];
          if (!answer) return null;
          const spotted = results[r];
          return (
            <details key={round.groupKey} className="rounded border border-stone-800 bg-stone-900/50">
              <summary className="cursor-pointer px-4 py-3 focus-visible:outline-2 focus-visible:outline-amber-400">
                Round {r + 1} · {round.label} ·{" "}
                <span className={spotted ? "text-emerald-400" : "text-rose-400"}>
                  {spotted ? "Spotted it" : "Missed"}
                </span>
              </summary>
              <div className="px-4 pb-4">
                <div className="grid grid-cols-4 gap-2">
                  {round.images.map((file, i) => {
                    const isFake = i === answer.fakeIndex;
                    const isGuess = i === guesses[r];
                    return (
                      <img
                        key={file}
                        src={imageUrl(file)}
                        alt={describe(r + 1, i + 1, isFake, isGuess)}
                        loading="lazy"
                        className={`aspect-square w-full rounded bg-stone-900 object-contain ${
                          isFake ? "ring-4 ring-rose-500" : isGuess ? "ring-2 ring-amber-400" : ""
                        }`}
                      />
                    );
                  })}
                </div>
                <p className="mt-3 text-sm text-stone-300">{answer.note}</p>
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}
