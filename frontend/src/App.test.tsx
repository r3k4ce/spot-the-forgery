import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { loadPuzzle } from "./lib/load";
import { unseal } from "./lib/seal";
import type { Puzzle, SealedPayload } from "./lib/types";

vi.mock("./lib/load", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/load")>()),
  loadPuzzle: vi.fn(),
}));
vi.mock("./lib/seal", () => ({ unseal: vi.fn() }));

const PUZZLE: Puzzle = {
  date: "2026-10-26",
  number: 7,
  sealed: "opaque",
  rounds: [
    {
      groupKey: "artist:1",
      kind: "artist",
      label: "Thomas Eakins",
      images: ["a1.jpg", "a2.jpg", "a3.jpg", "a4.jpg"],
      realIds: [1, 2, 3],
      difficulty: 1,
    },
    {
      groupKey: "culture:Japan|1600",
      kind: "culture",
      label: "Japan, Edo period (1615–1868)",
      images: ["b1.jpg", "b2.jpg", "b3.jpg", "b4.jpg"],
      realIds: [4, 5, 6],
      difficulty: 2,
    },
  ],
};

const art = (id: number) => `https://clevelandart.org/art/${id}`;

const REVEAL: SealedPayload = {
  rounds: [
    {
      fakeIndex: 2,
      note: "The oars are modern.",
      real: [
        { index: 0, title: "The Biglin Brothers", date: "1873", url: art(1) },
        { index: 1, title: "Max Schmitt", date: "1871", url: art(2) },
        { index: 3, title: "Starting Out", date: "1874", url: art(3) },
      ],
    },
    {
      fakeIndex: 0,
      note: "The brushwork is too even.",
      real: [
        { index: 1, title: "Cranes", date: "1700", url: art(4) },
        { index: 2, title: "Pines", date: "1710", url: art(5) },
        { index: 3, title: "Waves", date: "1720", url: art(6) },
      ],
    },
  ],
};

const OLD_PUZZLE: Puzzle = { ...PUZZLE, date: "2026-10-19", number: 1 };
const DATES = ["2026-10-19", "2026-10-26"];
const ROUND_1 = "Four paintings attributed to Thomas Eakins";
const ROUND_2 = "Four paintings from Japan, Edo period (1615–1868)";

type User = ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  localStorage.clear();
  // Returning player: the first-visit help would cover every other test.
  localStorage.setItem("stf:seen-help", "true");
  window.location.hash = "";
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.mocked(loadPuzzle).mockImplementation(async (date) => ({
    puzzle: date === OLD_PUZZLE.date ? OLD_PUZZLE : PUZZLE,
    dates: DATES,
  }));
  vi.mocked(unseal).mockResolvedValue(REVEAL);
  Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function start() {
  const user = userEvent.setup();
  const view = render(<App />);
  await screen.findByRole("heading", { level: 2 });
  return { user, ...view };
}

const painting = (n: number) => screen.getByRole("button", { name: `Painting ${n} of 4` });
const liveRegion = () => document.querySelector("[aria-live]");

// The painting button whose image is this file, wherever a replay has put it.
const byFile = (file: string) =>
  screen
    .getAllByRole("button", { name: /^Painting \d of 4$/ })
    .find((b) => b.querySelector("img")!.getAttribute("src")!.endsWith(file))!;

// Select a painting (it opens zoomed), close the zoom and confirm.
async function pick(user: User, button: HTMLElement) {
  await user.click(button);
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "This one is the fake" }));
}

const guess = (user: User, n: number) => pick(user, painting(n));
const guessFile = (user: User, file: string) => pick(user, byFile(file));
const nextRound = (user: User) => user.click(screen.getByRole("button", { name: "Next round" }));
const seeResults = (user: User) => user.click(screen.getByRole("button", { name: "See results" }));

async function finish(user: User, first: number, second: number) {
  await guess(user, first);
  await nextRound(user);
  await guess(user, second);
  await seeResults(user);
}

// Call after userEvent.setup(), which installs its own clipboard.
function stubClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

it("shows the puzzle number and date in the header", async () => {
  await start();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Spot the Forgery #7");
  expect(screen.getByText("2026-10-26")).toBeInTheDocument();
});

it("titles rounds by kind", async () => {
  const { user } = await start();
  expect(screen.getByRole("heading", { name: ROUND_1 })).toBeInTheDocument();
  await guess(user, 3);
  await nextRound(user);
  expect(screen.getByRole("heading", { name: ROUND_2 })).toBeInTheDocument();
});

it("gives no hints in alt text", async () => {
  await start();
  const alts = screen.getAllByRole("img").map((img) => img.getAttribute("alt"));
  expect(alts).toEqual([1, 2, 3, 4].map((n) => `Painting ${n} of 4`));
});

it("zooming does not count as a guess", async () => {
  const { user } = await start();
  await user.click(painting(2));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByText("AI forgery")).not.toBeInTheDocument();
  expect(localStorage.getItem("stf:progress:2026-10-26")).toBeNull();
});

it("reveals the answer after a guess", async () => {
  const { user } = await start();
  expect(screen.getByRole("button", { name: "This one is the fake" })).toBeDisabled();
  await guess(user, 3);

  const fake = screen.getAllByRole("figure")[2];
  expect(within(fake).getByText("AI forgery")).toBeInTheDocument();
  expect(liveRegion()).toHaveTextContent("The oars are modern.");
  expect(liveRegion()).toHaveTextContent("Correct");
  const link = screen.getByRole("link", { name: /The Biglin Brothers/ });
  expect(link).toHaveAttribute("href", art(1));
  expect(screen.getByText(/Starting Out/)).toBeInTheDocument();

  await nextRound(user);
  expect(screen.queryByText("AI forgery")).not.toBeInTheDocument();
});

it("marks the player's pick in the reveal", async () => {
  const { user } = await start();
  await guess(user, 2);
  expect(within(screen.getAllByRole("figure")[1]).getByText("Your guess")).toBeInTheDocument();
  expect(screen.getAllByText("Your guess")).toHaveLength(1);
});

it("shows progress dots for the rounds so far", async () => {
  const { user } = await start();
  const progress = () =>
    within(screen.getByRole("list", { name: "Progress" }))
      .getAllByRole("listitem")
      .map((li) => li.textContent);
  expect(progress()).toEqual(["Round 1: current", "Round 2: to come"]);
  await guess(user, 3);
  expect(progress()).toEqual(["Round 1: correct", "Round 2: to come"]);
  await nextRound(user);
  await guess(user, 2);
  expect(progress()).toEqual(["Round 1: correct", "Round 2: wrong"]);
});

it("preloads the next round's paintings", async () => {
  await start();
  const preloaded = [...document.head.querySelectorAll('link[rel="preload"][as="image"]')].map(
    (l) => l.getAttribute("href"),
  );
  const nextFiles = ["b1.jpg", "b2.jpg", "b3.jpg", "b4.jpg"];
  expect(preloaded).toEqual(
    expect.arrayContaining(nextFiles.map((f) => expect.stringContaining(`2026-10-26/${f}`))),
  );
});

it("restores progress after a reload", async () => {
  const { user, unmount } = await start();
  await guess(user, 1);
  unmount();
  await start();
  expect(screen.getByRole("heading", { name: ROUND_2 })).toBeInTheDocument();
});

it("keeps a guess made while the puzzle reloads, even when storage is full", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("full", "QuotaExceededError");
  });
  const { user } = await start();
  // From here on, loads wait until the test lets them finish.
  const pending: (() => void)[] = [];
  const respond = vi.mocked(loadPuzzle).getMockImplementation()!;
  vi.mocked(loadPuzzle).mockImplementation(async (date) => {
    await new Promise<void>((resolve) => pending.push(resolve));
    return respond(date);
  });

  // Off to an old puzzle and straight back: the latest puzzle shows again while it reloads.
  window.location.hash = "#/2026-10-19";
  expect(await screen.findByText("Loading…")).toBeInTheDocument();
  window.location.hash = "#/";
  expect(await screen.findByRole("heading", { name: ROUND_1 })).toBeInTheDocument();
  await guess(user, 3);
  await act(async () => {
    pending.forEach((resolve) => resolve());
    await new Promise((settle) => setTimeout(settle, 0));
  });
  expect(liveRegion()).toHaveTextContent("Correct");
});

it("keeps progress across a visit to the archive when storage is blocked", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });
  const { user } = await start();
  await guess(user, 3);
  await nextRound(user);
  await user.click(screen.getByRole("link", { name: "Archive" }));
  await screen.findByRole("heading", { name: "Archive" });
  window.location.hash = "#/";
  expect(await screen.findByRole("heading", { name: ROUND_2 })).toBeInTheDocument();
});

it("works from the keyboard", async () => {
  const { user } = await start();
  const confirm = screen.getByRole("button", { name: "This one is the fake" });
  await user.tab();
  expect(screen.getByRole("link", { name: "Archive" })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole("button", { name: "How to play" })).toHaveFocus();
  await user.tab();
  expect(painting(1)).toHaveFocus();
  await user.tab();
  await user.tab();
  await user.tab();
  expect(painting(4)).toHaveFocus();
  await user.keyboard("{Enter}");
  await user.keyboard("{Escape}");
  expect(painting(4)).toHaveAttribute("aria-pressed", "true");
  expect(painting(4)).toHaveFocus();
  await user.tab();
  expect(confirm).toHaveFocus();
});

describe("the zoomed view", () => {
  it("browses between paintings", async () => {
    const { user } = await start();
    await user.click(painting(1));
    const dialog = () => screen.getByRole("dialog");
    expect(dialog()).toHaveAccessibleName("Painting 1 of 4");
    await user.keyboard("{ArrowRight}");
    expect(dialog()).toHaveAccessibleName("Painting 2 of 4");
    await user.click(within(dialog()).getByRole("button", { name: "Previous painting" }));
    expect(dialog()).toHaveAccessibleName("Painting 1 of 4");
    await user.keyboard("{ArrowLeft}");
    expect(dialog()).toHaveAccessibleName("Painting 4 of 4");
    await user.click(within(dialog()).getByRole("button", { name: "Next painting" }));
    expect(dialog()).toHaveAccessibleName("Painting 1 of 4");

    // Swiping moves along, as on a phone.
    fireEvent.touchStart(dialog(), { touches: [{ clientX: 300, clientY: 200 }] });
    fireEvent.touchEnd(dialog(), { changedTouches: [{ clientX: 120, clientY: 210 }] });
    expect(dialog()).toHaveAccessibleName("Painting 2 of 4");
    fireEvent.touchStart(dialog(), { touches: [{ clientX: 100, clientY: 200 }] });
    fireEvent.touchEnd(dialog(), { changedTouches: [{ clientX: 300, clientY: 190 }] });
    expect(dialog()).toHaveAccessibleName("Painting 1 of 4");
    fireEvent.touchStart(dialog(), { touches: [{ clientX: 300, clientY: 200 }] });
    fireEvent.touchEnd(dialog(), { changedTouches: [{ clientX: 120, clientY: 210 }] });

    await user.click(within(dialog()).getByRole("button", { name: "This one is the fake" }));
    expect(liveRegion()).toHaveTextContent("Not this time");
    expect(within(screen.getAllByRole("figure")[1]).getByText("Your guess")).toBeInTheDocument();
  });

  it("doesn't take a two-finger pinch for a swipe", async () => {
    const { user } = await start();
    await user.click(painting(1));
    const dialog = screen.getByRole("dialog");
    const left = { clientX: 200, clientY: 300 };
    const right = { clientX: 220, clientY: 300 };
    fireEvent.touchStart(dialog, { touches: [left] });
    fireEvent.touchStart(dialog, { touches: [left, right] });
    // The fingers spread apart, then lift one at a time.
    fireEvent.touchEnd(dialog, { touches: [left], changedTouches: [{ ...right, clientX: 400 }] });
    fireEvent.touchEnd(dialog, { touches: [], changedTouches: [{ ...left, clientX: 20 }] });
    expect(dialog).toHaveAccessibleName("Painting 1 of 4");
  });

  it("only looks after the answer is shown", async () => {
    const { user } = await start();
    await guess(user, 3);
    await user.click(painting(1));
    await user.keyboard("{ArrowRight}");
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName("Painting 2 of 4");
    expect(within(dialog).queryByRole("button", { name: "This one is the fake" })).toBeNull();
    await user.keyboard("{Escape}");
    expect(within(screen.getAllByRole("figure")[2]).getByText("Your guess")).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent("Correct");
  });

  it("can guess from the zoomed view", async () => {
    const { user } = await start();
    await user.click(painting(3));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "This one is the fake" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent("Correct");
  });

  it("closes with its button", async () => {
    const { user } = await start();
    await user.click(painting(1));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(painting(1)).toHaveFocus();
  });

  it("returns focus to the painting it was showing", async () => {
    const { user } = await start();
    await user.click(painting(1));
    await user.keyboard("{ArrowRight}{ArrowRight}");
    await user.keyboard("{Escape}");
    expect(painting(3)).toHaveAttribute("aria-pressed", "true");
    expect(painting(3)).toHaveFocus();
  });

  it("keeps keyboard focus inside", async () => {
    const { user } = await start();
    await user.click(painting(1));
    const dialog = screen.getByRole("dialog");
    const button = (name: string) => within(dialog).getByRole("button", { name });
    expect(button("Close")).toHaveFocus();
    await user.tab();
    expect(button("Previous painting")).toHaveFocus();
    await user.tab({ shift: true });
    expect(button("Close")).toHaveFocus();
    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it("fits the painting to the screen and can show actual size", async () => {
    const { user } = await start();
    await user.click(painting(1));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Actual size" }));
    expect(within(dialog).getByRole("button", { name: "Fit to screen" })).toBeInTheDocument();
  });

  it("lets the keyboard reach the painting at actual size, to scroll it", async () => {
    const { user } = await start();
    await user.click(painting(1));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Actual size" }));
    within(dialog).getByRole("button", { name: "Close" }).focus();
    await user.tab();
    expect(within(dialog).getByRole("region", { name: "Painting at actual size" })).toHaveFocus();
  });
});

describe("the results screen", () => {
  it("shows the score and copies the result", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { user } = await start();
    stubClipboard(writeText);

    await guess(user, 3);
    await nextRound(user);
    await guess(user, 2);
    expect(liveRegion()).toHaveTextContent("Not this time");
    await seeResults(user);

    expect(screen.getByText("1/2")).toBeInTheDocument();
    const expected = `Spot the Forgery #7 🖼️\n🟩🟥 1/2\n${location.href.split("#")[0]}`;
    expect(screen.getByTestId("share-text")).toHaveTextContent(expected.replace(/\n/g, " "));
    await user.click(screen.getByRole("button", { name: "Copy result" }));
    expect(writeText).toHaveBeenCalledWith(expected);
    expect(await screen.findByText("Copied!")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("stf:history")!)).toEqual({
      "2026-10-26": { score: 1, total: 2, results: [true, false] },
    });
  });

  it("copies the result another way when the clipboard is blocked", async () => {
    const execCommand = vi.fn().mockReturnValue(true);
    const { user } = await start();
    stubClipboard(vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError")));
    Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });
    await finish(user, 3, 1);

    await user.click(screen.getByRole("button", { name: "Copy result" }));
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(await screen.findByText("Copied!")).toBeInTheDocument();
  });

  it("says so when the result can't be copied at all", async () => {
    const { user } = await start();
    stubClipboard(vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError")));
    const execCommand = vi.fn().mockReturnValue(false);
    Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });
    await finish(user, 3, 1);

    await user.click(screen.getByRole("button", { name: "Copy result" }));
    expect(await screen.findByText("Couldn't copy — select the text above.")).toBeInTheDocument();
  });

  // Opens the results of a finished puzzle with a share sheet that answers with `outcome`.
  async function shareFinished(outcome: () => Promise<void>) {
    const share = vi.fn(outcome);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    const progress = { date: "2026-10-26", guesses: [2, 0] };
    localStorage.setItem("stf:progress:2026-10-26", JSON.stringify(progress));
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Share" }));
    return { share, writeText };
  }

  it("uses the native share sheet when available", async () => {
    const { share, writeText } = await shareFinished(async () => {});
    expect(share).toHaveBeenCalledWith({ text: expect.stringContaining("🟩🟩 2/2") });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("does nothing more when the share sheet is dismissed", async () => {
    const { writeText } = await shareFinished(async () => {
      throw new DOMException("", "AbortError");
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies the result when the share sheet fails", async () => {
    const { writeText } = await shareFinished(async () => {
      throw new TypeError("unsupported");
    });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("🟩🟩 2/2"));
    expect(await screen.findByText("Copied!")).toBeInTheDocument();
  });

  it("counts down to the next puzzle, for the latest puzzle only", async () => {
    // Only the clock and intervals are faked, so Testing Library's own waiting still works.
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-11-02T03:58:30Z"));
    for (const date of DATES) {
      localStorage.setItem(`stf:progress:${date}`, JSON.stringify({ date, guesses: [2, 0] }));
    }
    render(<App />);
    expect(await screen.findByText("Next puzzle in 1 minute")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText("Next puzzle in less than a minute")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText("The next puzzle is on its way.")).toBeInTheDocument();

    window.location.hash = "#/2026-10-19";
    await screen.findByRole("heading", { level: 1, name: "Spot the Forgery #1" });
    expect(screen.getByText("Your result")).toBeInTheDocument();
    expect(screen.queryByText(/next puzzle/i)).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("counts the streak across weekly puzzles", async () => {
    localStorage.setItem("stf:history", JSON.stringify({ "2026-10-19": { score: 4, total: 5 } }));
    const { user } = await start();
    await finish(user, 3, 1);
    expect(screen.getByText("Your result")).toBeInTheDocument();
    const current = screen.getByText("Current streak").nextElementSibling;
    expect(current).toHaveTextContent("2");
  });

  it("reviews every round", async () => {
    const { user } = await start();
    await finish(user, 3, 2);
    const review = screen.getByRole("region", { name: "Review rounds" });
    const summaries = [...review.querySelectorAll("summary")];
    expect(summaries.map((el) => el.textContent)).toEqual([
      "Round 1 · Thomas Eakins · Spotted it",
      "Round 2 · Japan, Edo period (1615–1868) · Missed",
    ]);
    const image = (name: string) => within(review).getByRole("img", { name });
    await user.click(summaries[0]);
    expect(within(review).getByText("The oars are modern.")).toBeVisible();
    expect(image("Round 1, painting 3: the AI forgery, your guess")).toBeInTheDocument();
    await user.click(summaries[1]);
    expect(image("Round 2, painting 1: the AI forgery")).toBeInTheDocument();
    expect(image("Round 2, painting 2: your guess")).toBeInTheDocument();
  });
});

describe("playing again", () => {
  it("keeps the first score", async () => {
    const { user } = await start();
    await finish(user, 3, 2);
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getByText(/^Next puzzle in |^The next puzzle is on its way\.$/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Play again" }));
    expect(screen.getByRole("heading", { name: ROUND_1 })).toBeInTheDocument();
    expect(screen.queryByText("AI forgery")).not.toBeInTheDocument();

    // The paintings are shuffled now, so pick the fakes by image.
    await guessFile(user, "a3.jpg");
    await nextRound(user);
    await guessFile(user, "b1.jpg");
    await seeResults(user);
    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("stf:history")!)).toEqual({
      "2026-10-26": { score: 1, total: 2, results: [true, false] },
    });
  });

  it("shares the first finish, not a better replay", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { user } = await start();
    stubClipboard(writeText);
    await finish(user, 3, 2);
    expect(screen.queryByText(/Replays don't count/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Play again" }));
    await guessFile(user, "a3.jpg");
    await nextRound(user);
    await guessFile(user, "b1.jpg");
    await seeResults(user);

    // The replay's own score stays on screen; only what gets shared is the first one.
    expect(screen.getByText("2/2")).toBeInTheDocument();
    const expected = `Spot the Forgery #7 🖼️\n🟩🟥 1/2\n${location.href.split("#")[0]}`;
    expect(screen.getByTestId("share-text")).toHaveTextContent(expected.replace(/\n/g, " "));
    const note = "Replays don't count: sharing your first score, 1/2.";
    expect(screen.getByText(note)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy result" }));
    expect(writeText).toHaveBeenCalledWith(expected);
  });

  it("shares the play on screen for a result recorded without its rounds", async () => {
    // Results recorded before rounds were kept only have the score.
    localStorage.setItem("stf:history", JSON.stringify({ "2026-10-26": { score: 1, total: 2 } }));
    const progress = { date: "2026-10-26", guesses: [2, 0] };
    localStorage.setItem("stf:progress:2026-10-26", JSON.stringify(progress));
    render(<App />);
    expect(await screen.findByTestId("share-text")).toHaveTextContent("🟩🟩 2/2");
    expect(screen.queryByText(/Replays don't count/)).not.toBeInTheDocument();
  });

  it("shuffles the paintings", async () => {
    const { user } = await start();
    await finish(user, 3, 1);
    await user.click(screen.getByRole("button", { name: "Play again" }));
    const files = () =>
      screen.getAllByRole("img").map((img) => img.getAttribute("src")!.split("/").pop());
    expect([...files()].sort()).toEqual(["a1.jpg", "a2.jpg", "a3.jpg", "a4.jpg"]);
    expect(files()).not.toEqual(["a1.jpg", "a2.jpg", "a3.jpg", "a4.jpg"]);

    // The fake is still the fake wherever it lands.
    const fake = byFile("a3.jpg");
    await guessFile(user, "a3.jpg");
    expect(liveRegion()).toHaveTextContent("Correct");
    expect(within(fake.closest("figure")!).getByText("AI forgery")).toBeInTheDocument();
  });
});

describe("the archive", () => {
  it("lists every puzzle with the player's score", async () => {
    localStorage.setItem("stf:history", JSON.stringify({ "2026-10-19": { score: 4, total: 5 } }));
    const { user } = await start();
    await user.click(screen.getByRole("link", { name: "Archive" }));
    const items = await screen.findAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "Puzzle #2 · 2026-10-26Not played",
      "Puzzle #1 · 2026-10-19Scored 4/5",
    ]);
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("marks a puzzle that was started but not finished", async () => {
    const { user } = await start();
    await guess(user, 3);
    await user.click(screen.getByRole("link", { name: "Archive" }));
    const items = await screen.findAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Puzzle #2 · 2026-10-26In progress");
  });

  it("opens a past puzzle and comes back", async () => {
    const { user } = await start();
    const title = (name: string) => screen.findByRole("heading", { level: 1, name });
    await user.click(screen.getByRole("link", { name: "Archive" }));
    await user.click(await screen.findByRole("link", { name: /Puzzle #1/ }));
    expect(await title("Spot the Forgery #1")).toBeInTheDocument();
    expect(screen.getByText("2026-10-19")).toBeInTheDocument();
    expect(loadPuzzle).toHaveBeenLastCalledWith("2026-10-19");

    await user.click(screen.getByRole("link", { name: "Back to the latest puzzle" }));
    expect(await title("Spot the Forgery #7")).toBeInTheDocument();
  });

  it("keeps each puzzle's progress to itself", async () => {
    const { user } = await start();
    await guess(user, 3);
    window.location.hash = "#/2026-10-19";
    await screen.findByRole("heading", { level: 1, name: "Spot the Forgery #1" });
    expect(screen.getByText("Round 1 of 2")).toBeInTheDocument();
    expect(liveRegion()).toBeEmptyDOMElement();

    window.location.hash = "#/";
    await screen.findByRole("heading", { level: 1, name: "Spot the Forgery #7" });
    expect(screen.getByRole("heading", { name: ROUND_2 })).toBeInTheDocument();
  });
});

it("explains the game on the first visit only, and reopens from the ? button", async () => {
  localStorage.removeItem("stf:seen-help");
  const user = userEvent.setup();
  const { unmount } = render(<App />);
  const help = await screen.findByRole("dialog", { name: "How to play" });
  expect(within(help).getByText(/one is an AI forgery/)).toBeInTheDocument();
  expect(within(help).getByRole("button", { name: "Got it" })).toHaveFocus();
  await user.click(within(help).getByRole("button", { name: "Got it" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  unmount();

  await start();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "How to play" }));
  expect(screen.getByRole("dialog", { name: "How to play" })).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "How to play" })).toHaveFocus();
});

it("closes the help from outside its panel, but not from inside it", async () => {
  const { user } = await start();
  await user.click(screen.getByRole("button", { name: "How to play" }));
  await user.click(screen.getByRole("heading", { name: "How to play" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await user.click(screen.getByRole("dialog"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("keeps keyboard focus inside the help", async () => {
  const { user } = await start();
  await user.click(screen.getByRole("button", { name: "How to play" }));
  const gotIt = within(screen.getByRole("dialog")).getByRole("button", { name: "Got it" });
  await user.tab();
  expect(gotIt).toHaveFocus();
  await user.tab({ shift: true });
  expect(gotIt).toHaveFocus();
});

it("says when there is no puzzle", async () => {
  vi.mocked(loadPuzzle).mockResolvedValue(null);
  render(<App />);
  expect(await screen.findByText("No puzzle yet — check back soon.")).toBeInTheDocument();
});

it("says when the puzzle can't be opened", async () => {
  vi.mocked(unseal).mockRejectedValue(new SyntaxError("garbled"));
  render(<App />);
  const message = "This puzzle couldn't be opened. Try reloading the page.";
  expect(await screen.findByText(message)).toBeInTheDocument();
});

it("credits the museum in the footer", async () => {
  await start();
  expect(screen.getByRole("contentinfo")).toHaveTextContent(
    "Real paintings: Cleveland Museum of Art Open Access (CC0). " +
      "Forgeries are AI-generated for this game.",
  );
});
