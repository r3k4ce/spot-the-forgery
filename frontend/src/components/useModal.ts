import { useEffect, type RefObject } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

// What the help and the zoomed painting share as modal dialogs: focus starts on `initial` and
// goes back to whatever opened the dialog when it closes, Escape closes it, and Tab cycles
// through the dialog's own controls, since the page behind it is covered up.
export function useModal(
  dialog: RefObject<HTMLElement | null>,
  initial: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    initial.current?.focus();
    return () => opener?.focus();
  }, [initial]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "Tab" && dialog.current) keepTabInside(e, dialog.current);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dialog, onClose]);
}

function keepTabInside(e: KeyboardEvent, dialog: HTMLElement): void {
  const controls = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const first = controls[0];
  const last = controls.at(-1);
  if (!first || !last) return;
  const inside = dialog.contains(document.activeElement);
  const target = e.shiftKey
    ? (!inside || document.activeElement === first) && last
    : (!inside || document.activeElement === last) && first;
  if (target) {
    e.preventDefault();
    target.focus();
  }
}
