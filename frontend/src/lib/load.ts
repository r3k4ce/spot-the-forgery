import type { Puzzle } from "./types";

// Where the site is served from: "./" in the build, so it works under any GitHub Pages path.
const BASE = import.meta.env.BASE_URL;

const puzzleFileUrl = (base: string, date: string, file: string) =>
  `${base}puzzles/${date}/${file}`;

export const imageUrl = (date: string, file: string) => puzzleFileUrl(BASE, date, file);

// Puzzles change at UTC midnight for everyone, wherever they play.
export function todayUtc(now: Date): string {
  return now.toISOString().slice(0, 10);
}

// Undefined when the file isn't there (HTTP 404), which JSON itself can never be; any other
// failure throws.
async function getJson(url: string, fetchFn: typeof fetch): Promise<unknown> {
  const response = await fetchFn(url, { cache: "no-cache" });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// Only what the game reads before it can show anything, so a broken file is an error, not a crash.
function isPuzzle(v: unknown): v is Puzzle {
  return (
    isRecord(v) &&
    typeof v.date === "string" &&
    typeof v.number === "number" &&
    typeof v.sealed === "string" &&
    Array.isArray(v.rounds) &&
    v.rounds.every(
      (r) =>
        isRecord(r) &&
        typeof r.label === "string" &&
        Array.isArray(r.images) &&
        r.images.every((file) => typeof file === "string"),
    )
  );
}

// "missing" is a puzzle not published yet; "error" is one that should be there but can't be read,
// which a reload may fix.
export type LoadResult =
  | { status: "ready"; puzzle: Puzzle; dates: string[] }
  | { status: "missing" }
  | { status: "error" };

interface LoadOptions {
  base?: string;
  now?: Date;
  fetchFn?: typeof fetch;
}

// A past puzzle from the archive when `requested` names one, or the latest one for anything
// else. Also returns every playable date, oldest first, for the archive and streaks.
export async function loadPuzzle(
  requested?: string,
  { base = BASE, now = new Date(), fetchFn = fetch }: LoadOptions = {},
): Promise<LoadResult> {
  try {
    const index = await getJson(`${base}puzzles/index.json`, fetchFn);
    // No index at all means nothing has been published yet.
    if (index === undefined) return { status: "missing" };
    if (!Array.isArray(index)) return { status: "error" };
    const today = todayUtc(now);
    const dates = index.filter((d): d is string => typeof d === "string" && d <= today).sort();
    const date = requested && dates.includes(requested) ? requested : dates.at(-1);
    if (date === undefined) return { status: "missing" };
    // The index lists this puzzle, so if it's absent or malformed the site is broken.
    const puzzle = await getJson(puzzleFileUrl(base, date, "puzzle.json"), fetchFn);
    if (!isPuzzle(puzzle)) return { status: "error" };
    return { status: "ready", puzzle, dates };
  } catch {
    return { status: "error" };
  }
}
