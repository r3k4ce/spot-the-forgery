import type { DayResult } from "./types";

export interface Progress {
  date: string;
  guesses: number[];
}

const HISTORY_KEY = "stf:history";
const progressKey = (date: string) => `stf:progress:${date}`;

// Storage can be missing, full or blocked (private windows, embedded previews);
// the game must still play, it just won't remember.
function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not remembering is acceptable.
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isDayResult = (v: unknown): v is DayResult =>
  isRecord(v) && Number.isInteger(v.score) && Number.isInteger(v.total);

export function loadProgress(date: string): Progress {
  const stored = read(progressKey(date));
  if (
    isRecord(stored) &&
    Array.isArray(stored.guesses) &&
    stored.guesses.every((g) => Number.isInteger(g))
  ) {
    return { date, guesses: stored.guesses as number[] };
  }
  return { date, guesses: [] };
}

export function saveProgress(p: Progress): void {
  write(progressKey(p.date), p);
}

export function loadHistory(): Record<string, DayResult> {
  const stored = read(HISTORY_KEY);
  if (!isRecord(stored)) return {};
  return Object.fromEntries(Object.entries(stored).filter(([, r]) => isDayResult(r))) as Record<
    string,
    DayResult
  >;
}

export function recordResult(date: string, r: DayResult): void {
  write(HISTORY_KEY, { ...loadHistory(), [date]: r });
}
