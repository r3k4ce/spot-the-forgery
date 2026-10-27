import { loadPuzzle, pickDate, todayUtc } from "./load";

const NOW = new Date("2026-10-26T12:00:00Z");

function stubFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const fn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (!(url in routes)) return new Response("missing", { status: 404 });
    return Response.json(routes[url]);
  }) as typeof fetch;
  return { fn, calls };
}

it("uses the UTC calendar date", () => {
  expect(todayUtc(new Date("2026-10-26T23:30:00-05:00"))).toBe("2026-10-27");
  expect(todayUtc(new Date("2026-10-27T08:00:00+09:00"))).toBe("2026-10-26");
});

describe("pickDate", () => {
  it("prefers today", () => {
    expect(pickDate(["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28"], "2026-10-26")).toBe(
      "2026-10-26",
    );
  });

  it("falls back to the latest earlier date", () => {
    expect(pickDate(["2026-10-24", "2026-10-28"], "2026-10-26")).toBe("2026-10-24");
  });

  it("never returns a future date", () => {
    expect(pickDate(["2026-10-28"], "2026-10-26")).toBeNull();
  });
});

describe("loadPuzzle", () => {
  const puzzle = { date: "2026-10-26", number: 1, rounds: [], sealed: "" };

  it("fetches only today's puzzle when future dates are listed", async () => {
    const { fn, calls } = stubFetch({
      "./puzzles/index.json": ["2026-10-19", "2026-10-26", "2026-10-27", "2026-10-28"],
      "./puzzles/2026-10-26/puzzle.json": puzzle,
    });
    expect(await loadPuzzle("./", NOW, fn)).toEqual({
      puzzle,
      dates: ["2026-10-19", "2026-10-26"],
    });
    expect(calls).toEqual(["./puzzles/index.json", "./puzzles/2026-10-26/puzzle.json"]);
  });

  it("shows the latest earlier puzzle between weekly dates", async () => {
    const earlier = { ...puzzle, date: "2026-10-19" };
    const { fn } = stubFetch({
      "./puzzles/index.json": ["2026-10-12", "2026-10-19", "2026-11-02"],
      "./puzzles/2026-10-19/puzzle.json": earlier,
    });
    expect(await loadPuzzle("./", NOW, fn)).toEqual({
      puzzle: earlier,
      dates: ["2026-10-12", "2026-10-19"],
    });
  });

  it("loads a requested past puzzle", async () => {
    const earlier = { ...puzzle, date: "2026-10-19" };
    const { fn } = stubFetch({
      "./puzzles/index.json": ["2026-10-19", "2026-10-26"],
      "./puzzles/2026-10-19/puzzle.json": earlier,
    });
    expect(await loadPuzzle("./", NOW, fn, "2026-10-19")).toEqual({
      puzzle: earlier,
      dates: ["2026-10-19", "2026-10-26"],
    });
  });

  it("loads the latest puzzle for an unknown or future date", async () => {
    const { fn } = stubFetch({
      "./puzzles/index.json": ["2026-10-19", "2026-10-26", "2026-11-02"],
      "./puzzles/2026-10-26/puzzle.json": puzzle,
    });
    expect((await loadPuzzle("./", NOW, fn, "2026-11-02"))?.puzzle).toEqual(puzzle);
    expect((await loadPuzzle("./", NOW, fn, "nonsense"))?.puzzle).toEqual(puzzle);
  });

  it("resolves null when the network fails", async () => {
    const fn = (() => Promise.reject(new TypeError("offline"))) as typeof fetch;
    expect(await loadPuzzle("./", NOW, fn)).toBeNull();
  });

  it("resolves null when the index is missing", async () => {
    expect(await loadPuzzle("./", NOW, stubFetch({}).fn)).toBeNull();
  });

  it("resolves null when only future puzzles exist", async () => {
    const { fn, calls } = stubFetch({ "./puzzles/index.json": ["2026-10-27"] });
    expect(await loadPuzzle("./", NOW, fn)).toBeNull();
    expect(calls).toEqual(["./puzzles/index.json"]);
  });
});
