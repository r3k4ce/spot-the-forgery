import { useCallback, useState } from "react";
import type { PuzzleRound, RoundReveal } from "../lib/types";
import { Lightbox } from "./Lightbox";

interface Props {
  round: PuzzleRound;
  base: string;
  date: string;
  reveal: RoundReveal | null;
  onGuess: (index: number) => void;
}

function roundTitle(round: PuzzleRound): string {
  return round.kind === "artist"
    ? `Four paintings attributed to ${round.label}`
    : `Four paintings from ${round.label}`;
}

export function RoundView({ round, base, date, reveal, onGuess }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const [zoomed, setZoomed] = useState<number | null>(null);
  const closeZoom = useCallback(() => setZoomed(null), []);
  const src = (file: string) => `${base}puzzles/${date}/${file}`;
  const alt = (i: number) => `Painting ${i + 1} of ${round.images.length}`;

  return (
    <section aria-labelledby="round-title">
      <h2 id="round-title" className="mb-4 text-center font-serif text-xl sm:text-2xl">
        {roundTitle(round)}
      </h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {round.images.map((file, i) => {
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
                aria-label={alt(i)}
                aria-pressed={reveal ? undefined : selected === i}
                onClick={() => {
                  if (!reveal) setSelected(i);
                  setZoomed(i);
                }}
                className={`block aspect-square w-full overflow-hidden rounded bg-stone-900 ${ring} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400`}
              >
                <img src={src(file)} alt={alt(i)} className="h-full w-full object-contain" />
              </button>
              {reveal && (
                <figcaption className="mt-2 text-sm">
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
              {selected === reveal.fakeIndex ? "Correct — you spotted the forgery." : "Not this time."}
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
        <Lightbox src={src(round.images[zoomed])} alt={alt(zoomed)} onClose={closeZoom} />
      )}
    </section>
  );
}
