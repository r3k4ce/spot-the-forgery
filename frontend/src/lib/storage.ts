import type { DayResult } from "./types";

// Keys and shapes are read back from players' browsers: change them only with a migration.
const HISTORY_KEY = "stf:history";
const SEEN_HELP_KEY = "stf:seen-help";
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

// Malformed rounds lose only themselves; the score still counts for the streak and archive.
function cleanResult({ score, total, results }: DayResult): DayResult {
  const valid = Array.isArray(results) && results.every((r) => typeof r === "boolean");
  return valid ? { score, total, results } : { score, total };
}

const isGuessList = (v: unknown): v is number[] =>
  Array.isArray(v) && v.every((g) => Number.isInteger(g));

// The paintings picked so far in a puzzle, one per round.
export function loadProgress(date: string): number[] {
  const stored = read(progressKey(date));
  return isRecord(stored) && isGuessList(stored.guesses) ? stored.guesses : [];
}

export function saveProgress(date: string, guesses: number[]): void {
  write(progressKey(date), { date, guesses });
}

export type History = Record<string, DayResult>;

// The first finished result for each puzzle, by date.
export function loadHistory(): History {
  const stored = read(HISTORY_KEY);
  if (!isRecord(stored)) return {};
  const valid = Object.entries(stored).filter((e): e is [string, DayResult] => isDayResult(e[1]));
  return Object.fromEntries(valid.map(([date, r]) => [date, cleanResult(r)]));
}

export function recordResult(date: string, r: DayResult): void {
  write(HISTORY_KEY, { ...loadHistory(), [date]: r });
}

export const hasSeenHelp = (): boolean => read(SEEN_HELP_KEY) === true;

export function markHelpSeen(): void {
  write(SEEN_HELP_KEY, true);
}
