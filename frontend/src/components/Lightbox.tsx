import { useEffect, useRef, useState } from "react";

interface Props {
  src: string;
  alt: string;
  onClose: () => void;
  onChoose?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}

// A horizontal drag at least this long, and mostly sideways, counts as a swipe.
const SWIPE_PX = 50;

const BUTTON =
  "rounded border border-stone-600 px-4 py-2 text-stone-100 hover:bg-stone-800 focus-visible:outline-2 focus-visible:outline-amber-400";

export function Lightbox({ src, alt, onClose, onChoose, onPrev, onNext }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [actualSize, setActualSize] = useState(false);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => opener?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") onPrev?.();
      else if (e.key === "ArrowRight") onNext?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className="fixed inset-0 z-50 flex flex-col bg-black"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onTouchStart={(e) => {
        const t = e.touches[0];
        touchStart.current = t ? { x: t.clientX, y: t.clientY } : null;
      }}
      onTouchEnd={(e) => {
        const start = touchStart.current;
        const t = e.changedTouches[0];
        touchStart.current = null;
        // At actual size a drag pans the painting instead.
        if (!start || !t || actualSize) return;
        const dx = t.clientX - start.x;
        if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(t.clientY - start.y)) return;
        if (dx < 0) onNext?.();
        else onPrev?.();
      }}
    >
      <div className="flex flex-wrap justify-end gap-2 p-3">
        {onPrev && (
          <button type="button" onClick={onPrev} className={BUTTON} aria-label="Previous painting">
            ←
          </button>
        )}
        {onNext && (
          <button type="button" onClick={onNext} className={BUTTON} aria-label="Next painting">
            →
          </button>
        )}
        <button type="button" onClick={() => setActualSize((v) => !v)} className={BUTTON}>
          {actualSize ? "Fit to screen" : "Actual size"}
        </button>
        {onChoose && (
          <button
            type="button"
            onClick={onChoose}
            className="rounded bg-amber-400 px-4 py-2 font-semibold text-stone-950 hover:bg-amber-300 focus-visible:outline-2 focus-visible:outline-amber-200"
          >
            This one is the fake
          </button>
        )}
        <button ref={closeRef} type="button" onClick={onClose} className={BUTTON}>
          Close
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
        <img
          src={src}
          alt={alt}
          className={actualSize ? "mx-auto max-w-none" : "mx-auto h-full w-full object-contain"}
        />
      </div>
    </div>
  );
}
