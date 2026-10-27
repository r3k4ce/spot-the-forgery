import { useEffect, useRef } from "react";

interface Props {
  onClose: () => void;
}

export function Help({ onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => opener?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-full w-full max-w-md overflow-auto rounded border border-stone-700 bg-stone-950 p-6">
        <h2 id="help-title" className="mb-4 text-center font-serif text-2xl">
          How to play
        </h2>
        <ul className="list-disc space-y-2 pl-5 text-stone-300">
          <li>
            Each round shows four paintings. Three are real works from the Cleveland Museum of Art;
            one is an AI forgery made to blend in.
          </li>
          <li>
            Tap a painting to look closer. Use the arrows or swipe to compare, then pick the one you
            think is fake.
          </li>
          <li>After each guess you see which one was forged and what gives it away.</li>
          <li>
            A new puzzle arrives every Monday. Older ones are in the Archive, and your streak counts
            puzzles played in a row.
          </li>
        </ul>
        <div className="mt-6 text-center">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded bg-amber-400 px-6 py-2 font-semibold text-stone-950 hover:bg-amber-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
