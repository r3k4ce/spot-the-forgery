import { loadPuzzle, todayUtc } from "./load";

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

describe("loadPuzzle", () => {
  const puzzle = {
    date: "2026-10-26",
    number: 1,
    sealed: "",
    rounds: [{ label: "Thomas Eakins", images: ["a1.jpg", "a2.jpg"] }],
  };
  const load = (fetchFn: typeof fetch, requested?: string) =>
    loadPuzzle(requested, { base: "./", now: NOW, fetchFn });

  it("fetches only today's puzzle when future dates are listed", async () => {
    const { fn, calls } = stubFetch({
      "./puzzles/index.json": ["2026-10-19", "2026-10-26", "2026-10-27", "2026-10-28"],
      "./puzzles/2026-10-26/puzzle.json": puzzle,
    });
    expect(await load(fn)).toEqual({
      status: "ready",
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
    expect(await load(fn)).toEqual({
      status: "ready",
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
    expect(await load(fn, "2026-10-19")).toEqual({
      status: "ready",
      puzzle: earlier,
      dates: ["2026-10-19", "2026-10-26"],
    });
  });

  it("loads the latest puzzle for an unknown or future date", async () => {
    const { fn } = stubFetch({
      "./puzzles/index.json": ["2026-10-19", "2026-10-26", "2026-11-02"],
      "./puzzles/2026-10-26/puzzle.json": puzzle,
    });
    expect(await load(fn, "2026-11-02")).toMatchObject({ puzzle });
    expect(await load(fn, "nonsense")).toMatchObject({ puzzle });
  });

  it("finds no puzzle yet when the index is missing", async () => {
    expect(await load(stubFetch({}).fn)).toEqual({ status: "missing" });
  });

  it("finds no puzzle yet when only future puzzles exist", async () => {
    const { fn, calls } = stubFetch({ "./puzzles/index.json": ["2026-10-27"] });
    expect(await load(fn)).toEqual({ status: "missing" });
    expect(calls).toEqual(["./puzzles/index.json"]);
  });

  it("fails when the network fails", async () => {
    const fn = (() => Promise.reject(new TypeError("offline"))) as typeof fetch;
    expect(await load(fn)).toEqual({ status: "error" });
  });

  it("fails on a server error rather than reporting no puzzle", async () => {
    const fn = (async () => new Response("down", { status: 503 })) as typeof fetch;
    expect(await load(fn)).toEqual({ status: "error" });
  });

  it("fails when the index isn't a list of dates", async () => {
    const notJson = (async () => new Response("<html>")) as typeof fetch;
    expect(await load(notJson)).toEqual({ status: "error" });
    expect(await load(stubFetch({ "./puzzles/index.json": { dates: [] } }).fn)).toEqual({
      status: "error",
    });
  });

  it("fails when a listed puzzle is missing", async () => {
    const { fn } = stubFetch({ "./puzzles/index.json": ["2026-10-26"] });
    expect(await load(fn)).toEqual({ status: "error" });
  });

  it.each([
    ["not an object", [puzzle]],
    ["no date", { ...puzzle, date: undefined }],
    ["no number", { ...puzzle, number: "1" }],
    ["no sealed answers", { ...puzzle, sealed: null }],
    ["no rounds", { ...puzzle, rounds: "none" }],
    ["a round that isn't an object", { ...puzzle, rounds: [null] }],
    ["a round without a label", { ...puzzle, rounds: [{ images: ["a1.jpg"] }] }],
    ["a round without images", { ...puzzle, rounds: [{ label: "x" }] }],
    ["an image that isn't a file name", { ...puzzle, rounds: [{ label: "x", images: [1] }] }],
  ])("fails on a puzzle with %s", async (_, malformed) => {
    const { fn } = stubFetch({
      "./puzzles/index.json": ["2026-10-26"],
      "./puzzles/2026-10-26/puzzle.json": malformed,
    });
    expect(await load(fn)).toEqual({ status: "error" });
  });
});
