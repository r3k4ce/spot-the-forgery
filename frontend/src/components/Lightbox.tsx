import { useEffect, useRef } from "react";

interface Props {
  src: string;
  alt: string;
  onClose: () => void;
}

export function Lightbox({ src, alt, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

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
      className="fixed inset-0 z-50 flex flex-col bg-black/95"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex justify-end p-3">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="rounded border border-stone-600 px-4 py-2 text-stone-100 hover:bg-stone-800 focus-visible:outline-2 focus-visible:outline-amber-400"
        >
          Close
        </button>
      </div>
      <div className="flex-1 overflow-auto overscroll-contain">
        <img src={src} alt={alt} className="mx-auto max-w-none" />
      </div>
    </div>
  );
}
