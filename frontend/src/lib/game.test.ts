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
  const recent = history("2026-10-24", "2026-10-25", "2026-10-26");

  it("counts a run ending today", () => {
    expect(computeStreaks(recent, "2026-10-26")).toEqual({ current: 3, best: 3 });
  });

  it("keeps the streak alive before today's puzzle is played", () => {
    expect(computeStreaks(recent, "2026-10-27").current).toBe(3);
  });

  it("breaks the streak after a missed day", () => {
    expect(computeStreaks(recent, "2026-10-28")).toEqual({ current: 0, best: 3 });
  });

  it("finds the best run across gaps", () => {
    const h = history("2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-25", "2026-10-26");
    expect(computeStreaks(h, "2026-10-26")).toEqual({ current: 2, best: 5 });
  });

  it("handles an empty history and month boundaries", () => {
    expect(computeStreaks({}, "2026-10-26")).toEqual({ current: 0, best: 0 });
    expect(computeStreaks(history("2026-10-31", "2026-11-01"), "2026-11-01").current).toBe(2);
  });
});
