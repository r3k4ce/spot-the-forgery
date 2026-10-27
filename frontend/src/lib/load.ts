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

async function getJson(url: string, fetchFn: typeof fetch): Promise<unknown> {
  const response = await fetchFn(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

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
): Promise<{ puzzle: Puzzle; dates: string[] } | null> {
  try {
    const index = await getJson(`${base}puzzles/index.json`, fetchFn);
    if (!Array.isArray(index)) return null;
    const today = todayUtc(now);
    const dates = index.filter((d): d is string => typeof d === "string" && d <= today).sort();
    const date = requested && dates.includes(requested) ? requested : dates.at(-1);
    if (date === undefined) return null;
    const puzzle = (await getJson(puzzleFileUrl(base, date, "puzzle.json"), fetchFn)) as Puzzle;
    return { puzzle, dates };
  } catch {
    return null;
  }
}
