import type { DayResult } from "./types";

export function score(results: boolean[]): number {
  return results.filter(Boolean).length;
}

export function shareText(number: number, results: boolean[], url: string): string {
  const squares = results.map((ok) => (ok ? "🟩" : "🟥")).join("");
  return `Spot the Forgery #${number} 🖼️\n${squares} ${score(results)}/${results.length}\n${url}`;
}

// Streaks count consecutive published puzzles, so a weekly puzzle keeps them going.
export function computeStreaks(
  history: Record<string, DayResult>,
  dates: string[],
): { current: number; best: number } {
  const played = dates.map((d) => d in history);
  const runEndingAt = (end: number) => {
    let n = 0;
    while (end - n >= 0 && played[end - n]) n++;
    return n;
  };

  let best = 0;
  played.forEach((p, i) => {
    if (p && !played[i + 1]) best = Math.max(best, runEndingAt(i));
  });
  const last = dates.length - 1;
  // The latest puzzle not being played yet doesn't break the run before it.
  const current = played[last] ? runEndingAt(last) : runEndingAt(last - 1);
  return { current, best };
}
