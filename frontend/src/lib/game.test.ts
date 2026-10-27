import {
  computeStreaks,
  formatCountdown,
  nextPuzzleTime,
  score,
  shareText,
  shuffledOrder,
} from "./game";
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
    const dates = [17, 18, 19, 20, 21, 22, 25, 26].map((day) => `2026-10-${day}`);
    const missedOne = dates.filter((d) => d !== "2026-10-22");
    expect(computeStreaks(history(...missedOne), dates)).toEqual({ current: 2, best: 5 });
  });

  it("ignores played dates that are not published", () => {
    expect(computeStreaks(history("2026-10-01", "2026-10-26"), weekly)).toEqual({
      current: 1,
      best: 1,
    });
  });

  it("handles an empty history and no puzzles", () => {
    expect(computeStreaks({}, weekly)).toEqual({ current: 0, best: 0 });
    expect(computeStreaks(recent, [])).toEqual({ current: 0, best: 0 });
  });
});

describe("nextPuzzleTime", () => {
  it("is the Monday after the latest puzzle, once the weekly run has had time to finish", () => {
    expect(nextPuzzleTime("2026-10-27").toISOString()).toBe("2026-11-02T04:00:00.000Z");
    expect(nextPuzzleTime("2026-11-02").toISOString()).toBe("2026-11-09T04:00:00.000Z");
    expect(nextPuzzleTime("2026-11-08").toISOString()).toBe("2026-11-09T04:00:00.000Z");
  });
});

describe("formatCountdown", () => {
  const HOUR = 3_600_000;
  it("names days and hours, then hours and minutes, then minutes", () => {
    expect(formatCountdown(5 * 24 * HOUR + 3 * HOUR + 59_000)).toBe(
      "Next puzzle in 5 days, 3 hours",
    );
    expect(formatCountdown(24 * HOUR + HOUR)).toBe("Next puzzle in 1 day, 1 hour");
    expect(formatCountdown(3 * HOUR + 12 * 60_000)).toBe("Next puzzle in 3 hours, 12 minutes");
    expect(formatCountdown(60_000)).toBe("Next puzzle in 1 minute");
    expect(formatCountdown(20_000)).toBe("Next puzzle in less than a minute");
  });

  it("says the puzzle is on its way once the time has passed", () => {
    expect(formatCountdown(0)).toBe("The next puzzle is on its way.");
    expect(formatCountdown(-HOUR)).toBe("The next puzzle is on its way.");
  });
});

describe("shuffledOrder", () => {
  it("returns a new order of every position", () => {
    for (let seed = 0; seed < 50; seed++) {
      let x = seed;
      const random = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
      const order = shuffledOrder(4, random);
      expect([...order].sort()).toEqual([0, 1, 2, 3]);
      expect(order).not.toEqual([0, 1, 2, 3]);
    }
  });

  it("still moves things when the shuffle lands on the original order", () => {
    expect(shuffledOrder(4, () => 0.999)).not.toEqual([0, 1, 2, 3]);
  });
});
