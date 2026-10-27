import { computeStreaks, score, shareText } from "./game";
import type { DayResult } from "./types";

const played: DayResult = { score: 3, total: 5 };

function history(...dates: string[]): Record<string, DayResult> {
  return Object.fromEntries(dates.map((d) => [d, played]));
}

it("scores correct answers", () => {
  expect(score([true, false, true, true, false])).toBe(3);
});

it("formats the share text", () => {
  expect(shareText(42, [true, true, false, true, false], "https://x.test/")).toBe(
    "Spot the Forgery #42 🖼️\n🟩🟩🟥🟩🟥 3/5\nhttps://x.test/",
  );
});

describe("computeStreaks", () => {
  // Streaks count consecutive published puzzles, however far apart their dates are.
  const weekly = ["2026-10-12", "2026-10-19", "2026-10-26"];
  const recent = history(...weekly);

  it("counts a run ending at the latest puzzle", () => {
    expect(computeStreaks(recent, weekly)).toEqual({ current: 3, best: 3 });
  });

  it("keeps the streak alive before the latest puzzle is played", () => {
    expect(computeStreaks(recent, [...weekly, "2026-11-02"]).current).toBe(3);
  });

  it("breaks the streak after a missed puzzle", () => {
    expect(computeStreaks(recent, [...weekly, "2026-11-02", "2026-11-09"])).toEqual({
      current: 0,
      best: 3,
    });
  });

  it("finds the best run across gaps", () => {
    const dates = ["2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-25", "2026-10-26"];
    const h = history("2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-25", "2026-10-26");
    expect(computeStreaks(h, dates)).toEqual({ current: 2, best: 5 });
  });

  it("ignores played dates that are not published", () => {
    expect(computeStreaks(history("2026-10-01", "2026-10-26"), weekly)).toEqual({ current: 1, best: 1 });
  });

  it("handles an empty history and no puzzles", () => {
    expect(computeStreaks({}, weekly)).toEqual({ current: 0, best: 0 });
    expect(computeStreaks(recent, [])).toEqual({ current: 0, best: 0 });
  });
});
