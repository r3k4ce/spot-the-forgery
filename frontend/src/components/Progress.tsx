interface Props {
  // One entry per round guessed so far: whether the guess was right.
  results: boolean[];
  // The round on screen; it is still current while its answer is being revealed.
  current: number;
  total: number;
}

const DOT = {
  correct: "bg-emerald-500",
  wrong: "bg-rose-600",
  current: "bg-transparent ring-2 ring-amber-400",
  "to come": "bg-stone-700",
} as const;

export function Progress({ results, current, total }: Props) {
  const states = Array.from({ length: total }, (_, i): keyof typeof DOT =>
    i < results.length ? (results[i] ? "correct" : "wrong") : i === current ? "current" : "to come",
  );
  return (
    <ol aria-label="Progress" className="mb-3 flex justify-center gap-2">
      {states.map((state, i) => (
        <li key={i}>
          <span aria-hidden="true" className={`block h-3 w-3 rounded-full ${DOT[state]}`} />
          <span className="sr-only">{`Round ${i + 1}: ${state}`}</span>
        </li>
      ))}
    </ol>
  );
}
