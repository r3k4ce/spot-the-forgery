// Hash routes keep the static site on one page: GitHub Pages has no rewrites.
//   #/             the latest puzzle
//   #/archive      the list of past puzzles
//   #/2026-10-19   one past puzzle
export type Route = { view: "puzzle"; date?: string } | { view: "archive" };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, "");
  if (path === "archive") return { view: "archive" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(path)) return { view: "puzzle", date: path };
  return { view: "puzzle" };
}

export const puzzleHref = (date: string) => `#/${date}`;
export const ARCHIVE_HREF = "#/archive";
export const LATEST_HREF = "#/";
