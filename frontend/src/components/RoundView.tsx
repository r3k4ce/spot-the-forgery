import { useState } from "react";
import type { PuzzleRound, RoundReveal } from "../lib/types";
import { Lightbox } from "./Lightbox";

interface Props {
  round: PuzzleRound;
  imageUrl: (file: string) => string;
  reveal: RoundReveal | null;
  // Which painting sits in each position (a replay shuffles them); guesses use the
  // painting's own index, so answers still match.
  order?: number[];
  onGuess: (index: number) => void;
}

function roundTitle(round: PuzzleRound): string {
  return round.kind === "artist"
    ? `Four paintings attributed to ${round.label}`
    : `Four paintings from ${round.label}`;
}

export function RoundView({ round, imageUrl, reveal, order: shuffled, onGuess }: Props) {
  // A painting index, as guesses are. Once the answer is shown it is the player's guess,
  // since nothing changes the selection then.
  const [selected, setSelected] = useState<number | null>(null);
  // A position on screen, not a painting index.
  const [zoomed, setZoomed] = useState<number | null>(null);
  const order = shuffled ?? round.images.map((_, i) => i);
  const count = order.length;
  const alt = (position: number) => `Painting ${position + 1} of ${count}`;

  // While guessing, looking at a painting selects it, and browsing in the zoomed view moves
  // the selection along, so the guess always matches what's shown.
  function zoomTo(position: number) {
    setZoomed(position);
    if (!reveal) setSelected(order[position]);
  }

  function browse(step: number) {
    if (zoomed !== null) zoomTo((zoomed + step + count) % count);
  }

  return (
    <section aria-labelledby="round-title">
      <h2 id="round-title" className="mb-4 text-center font-serif text-xl sm:text-2xl">
        {roundTitle(round)}
      </h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {order.map((i, position) => {
          const file = round.images[i];
          const isFake = reveal?.fakeIndex === i;
          const real = reveal?.real.find((r) => r.index === i);
          const ring = reveal
            ? isFake
              ? "ring-4 ring-rose-500"
              : "ring-1 ring-stone-700"
            : selected === i
              ? "ring-4 ring-amber-400"
              : "ring-1 ring-stone-700 hover:ring-stone-400";
          return (
            <figure key={file} className="m-0">
              <button
                type="button"
                aria-label={alt(position)}
                aria-pressed={reveal ? undefined : selected === i}
                onClick={() => zoomTo(position)}
                className={`block aspect-square w-full overflow-hidden rounded bg-stone-900 ${ring} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400`}
              >
                <img
                  src={imageUrl(file)}
                  alt={alt(position)}
                  className="h-full w-full object-contain"
                />
              </button>
              {reveal && (
                <figcaption className="mt-2 text-sm">
                  {selected === i && (
                    <span className="mr-2 inline-block rounded border border-amber-400 px-2 py-0.5 text-amber-300">
                      Your guess
                    </span>
                  )}
                  {isFake ? (
                    <span className="inline-block rounded bg-rose-600 px-2 py-0.5 font-semibold text-white">
                      AI forgery
                    </span>
                  ) : real ? (
                    <>
                      <a
                        href={real.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-serif italic text-amber-300 underline hover:text-amber-200"
                      >
                        {real.title}
                      </a>
                      {real.date && <span className="text-stone-400">, {real.date}</span>}
                    </>
                  ) : null}
                </figcaption>
              )}
            </figure>
          );
        })}
      </div>

      <div aria-live="polite" className="mt-6 text-center">
        {reveal && (
          <>
            <p className="text-lg font-semibold">
              {selected === reveal.fakeIndex
                ? "Correct — you spotted the forgery."
                : "Not this time."}
            </p>
            <p className="mx-auto mt-2 max-w-prose text-stone-300">{reveal.note}</p>
          </>
        )}
      </div>

      {!reveal && (
        <div className="mt-6 text-center">
          <button
            type="button"
            disabled={selected === null}
            onClick={() => selected !== null && onGuess(selected)}
            className="rounded bg-amber-400 px-6 py-3 font-semibold text-stone-950 hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200"
          >
            This one is the fake
          </button>
        </div>
      )}

      {zoomed !== null && (
        <Lightbox
          src={imageUrl(round.images[order[zoomed]])}
          alt={alt(zoomed)}
          onClose={() => setZoomed(null)}
          onPrev={() => browse(-1)}
          onNext={() => browse(1)}
          onChoose={
            reveal
              ? undefined
              : () => {
                  setZoomed(null);
                  onGuess(order[zoomed]);
                }
          }
        />
      )}
    </section>
  );
}
