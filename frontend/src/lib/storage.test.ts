import {
  hasSeenHelp,
  loadHistory,
  loadProgress,
  markHelpSeen,
  recordResult,
  saveProgress,
} from "./storage";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

it("round-trips progress for a date", () => {
  saveProgress("2026-10-26", [2, 0]);
  expect(loadProgress("2026-10-26")).toEqual([2, 0]);
});

it("keeps the stored shape that players' browsers already hold", () => {
  saveProgress("2026-10-26", [2, 0]);
  expect(JSON.parse(localStorage.getItem("stf:progress:2026-10-26")!)).toEqual({
    date: "2026-10-26",
    guesses: [2, 0],
  });
});

it("starts a new day with no guesses", () => {
  saveProgress("2026-10-26", [2, 0, 1, 3, 1]);
  expect(loadProgress("2026-10-27")).toEqual([]);
});

it("discards malformed stored progress", () => {
  localStorage.setItem("stf:progress:2026-10-26", '{"guesses":"nope"}');
  expect(loadProgress("2026-10-26")).toEqual([]);
  localStorage.setItem("stf:progress:2026-10-26", '{"guesses":[1,"2"]}');
  expect(loadProgress("2026-10-26")).toEqual([]);
  localStorage.setItem("stf:progress:2026-10-26", "{not json");
  expect(loadProgress("2026-10-26")).toEqual([]);
});

it("merges results into the history", () => {
  recordResult("2026-10-25", { score: 4, total: 5 });
  recordResult("2026-10-26", { score: 2, total: 5 });
  expect(loadHistory()).toEqual({
    "2026-10-25": { score: 4, total: 5 },
    "2026-10-26": { score: 2, total: 5 },
  });
});

it("drops malformed history entries", () => {
  localStorage.setItem(
    "stf:history",
    JSON.stringify({ "2026-10-25": { score: 4, total: 5 }, bad: { score: "x" } }),
  );
  expect(loadHistory()).toEqual({ "2026-10-25": { score: 4, total: 5 } });
  localStorage.setItem("stf:history", "[1,2]");
  expect(loadHistory()).toEqual({});
});

it("remembers that the help was seen", () => {
  expect(hasSeenHelp()).toBe(false);
  markHelpSeen();
  expect(hasSeenHelp()).toBe(true);
  expect(localStorage.getItem("stf:seen-help")).toBe("true");
});

it("survives storage that throws", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("denied");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("denied");
  });
  expect(loadProgress("2026-10-26")).toEqual([]);
  expect(() => saveProgress("2026-10-26", [1])).not.toThrow();
  expect(() => recordResult("2026-10-26", { score: 1, total: 5 })).not.toThrow();
  expect(loadHistory()).toEqual({});
  expect(hasSeenHelp()).toBe(false);
  expect(() => markHelpSeen()).not.toThrow();
});
