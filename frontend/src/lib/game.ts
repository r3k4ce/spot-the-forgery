import type { History } from "./storage";
import type { SealedPayload } from "./types";

// Whether each guess so far found the forgery.
export function checkGuesses(guesses: number[], answers: SealedPayload): boolean[] {
  return guesses.map((g, i) => g === answers.rounds[i]?.fakeIndex);
}

export function score(results: boolean[]): number {
  return results.filter(Boolean).length;
}

export function shareText(number: number, results: boolean[], url: string): string {
  const squares = results.map((ok) => (ok ? "🟩" : "🟥")).join("");
  return `Spot the Forgery #${number} 🖼️\n${squares} ${score(results)}/${results.length}\n${url}`;
}

export interface Streaks {
  current: number;
  best: number;
}

// Streaks count consecutive published puzzles, so a weekly puzzle keeps them going.
export function computeStreaks(history: History, dates: string[]): Streaks {
  // The length of the run of played puzzles ending at each date.
  const runs: number[] = [];
  for (const date of dates) runs.push(date in history ? (runs.at(-1) ?? 0) + 1 : 0);
  // The latest puzzle not being played yet doesn't break the run before it.
  const current = runs.at(-1) || (runs.at(-2) ?? 0);
  return { current, best: Math.max(0, ...runs) };
}

const DAY_MS = 86_400_000;

// The weekly run starts Monday 03:00 UTC; an hour later the new puzzle is normally live.
export function nextPuzzleTime(latestDate: string): Date {
  const latest = new Date(`${latestDate}T00:00:00Z`);
  const daysToMonday = (8 - latest.getUTCDay()) % 7 || 7;
  return new Date(latest.getTime() + daysToMonday * DAY_MS + 4 * 3_600_000);
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

export function formatCountdown(ms: number): string {
  if (ms <= 0) return "The next puzzle is on its way.";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "Next puzzle in less than a minute";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const parts = days > 0
    ? [plural(days, "day"), hours > 0 && plural(hours, "hour")]
    : [hours > 0 && plural(hours, "hour"), minutes % 60 > 0 && plural(minutes % 60, "minute")];
  return `Next puzzle in ${parts.filter(Boolean).join(", ")}`;
}

// A new arrangement for a replay; never the original one, or the replay would be pure memory.
export function shuffledOrder(n: number, random: () => number = Math.random): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.every((v, i) => v === i) && n > 1 ? [...order.slice(1), order[0]] : order;
}
