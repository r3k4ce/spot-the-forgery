import { useEffect, useRef, useState } from "react";

interface Props {
  src: string;
  alt: string;
  onClose: () => void;
  onChoose?: () => void;
}

const BUTTON =
  "rounded border border-stone-600 px-4 py-2 text-stone-100 hover:bg-stone-800 focus-visible:outline-2 focus-visible:outline-amber-400";

export function Lightbox({ src, alt, onClose, onChoose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [actualSize, setActualSize] = useState(false);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className="fixed inset-0 z-50 flex flex-col bg-black"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex flex-wrap justify-end gap-2 p-3">
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
