import type { Puzzle } from "./types";

// Puzzles change at UTC midnight for everyone, wherever they play.
export function todayUtc(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function pickDate(dates: string[], today: string): string | null {
  const playable = dates.filter((d) => d <= today).sort();
  return playable.at(-1) ?? null;
}

async function getJson(url: string, fetchFn: typeof fetch): Promise<unknown> {
  const response = await fetchFn(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

export async function loadPuzzle(
  base: string,
  now: Date = new Date(),
  fetchFn: typeof fetch = fetch,
): Promise<Puzzle | null> {
  try {
    const index = await getJson(`${base}puzzles/index.json`, fetchFn);
    if (!Array.isArray(index)) return null;
    const dates = index.filter((d): d is string => typeof d === "string");
    const date = pickDate(dates, todayUtc(now));
    if (date === null) return null;
    return (await getJson(`${base}puzzles/${date}/puzzle.json`, fetchFn)) as Puzzle;
  } catch {
    return null;
  }
}
