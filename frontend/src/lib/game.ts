import type { DayResult } from "./types";

const DAY_MS = 86_400_000;

export function score(results: boolean[]): number {
  return results.filter(Boolean).length;
}

export function shareText(number: number, results: boolean[], url: string): string {
  const squares = results.map((ok) => (ok ? "🟩" : "🟥")).join("");
  return `Spot the Forgery #${number} 🖼️\n${squares} ${score(results)}/${results.length}\n${url}`;
}

function dayNumber(iso: string): number {
  return Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
}

export function computeStreaks(
  history: Record<string, DayResult>,
  today: string,
): { current: number; best: number } {
  const days = new Set(Object.keys(history).map(dayNumber));
  const runLength = (end: number) => {
    let n = 0;
    while (days.has(end - n)) n++;
    return n;
  };

  let best = 0;
  for (const d of days) {
    if (!days.has(d + 1)) best = Math.max(best, runLength(d));
  }
  const t = dayNumber(today);
  const current = days.has(t) ? runLength(t) : runLength(t - 1);
  return { current, best };
}
