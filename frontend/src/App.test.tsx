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

const REVEAL: SealedPayload = {
  rounds: [
    {
      fakeIndex: 2,
      note: "The oars are modern.",
      real: [
        { index: 0, title: "The Biglin Brothers", date: "1873", url: "https://clevelandart.org/art/1" },
        { index: 1, title: "Max Schmitt", date: "1871", url: "https://clevelandart.org/art/2" },
        { index: 3, title: "Starting Out", date: "1874", url: "https://clevelandart.org/art/3" },
      ],
    },
    {
      fakeIndex: 0,
      note: "The brushwork is too even.",
      real: [
        { index: 1, title: "Cranes", date: "1700", url: "https://clevelandart.org/art/4" },
        { index: 2, title: "Pines", date: "1710", url: "https://clevelandart.org/art/5" },
        { index: 3, title: "Waves", date: "1720", url: "https://clevelandart.org/art/6" },
      ],
    },
  ],
};

const OLD_PUZZLE: Puzzle = { ...PUZZLE, date: "2026-10-19", number: 1 };
const DATES = ["2026-10-19", "2026-10-26"];

beforeEach(() => {
  localStorage.clear();
  // Returning player: the first-visit help would cover every other test.
  localStorage.setItem("stf:seen-help", "true");
  window.location.hash = "";
  vi.mocked(loadPuzzle).mockImplementation(async (_base, _now, _fetch, date) => ({
    puzzle: date === "2026-10-19" ? OLD_PUZZLE : PUZZLE,
    dates: DATES,
  }));
  vi.mocked(unseal).mockResolvedValue(REVEAL);
});

async function start() {
  const user = userEvent.setup();
  const view = render(<App />);
  await screen.findByRole("heading", { level: 2 });
  return { user, ...view };
}

const painting = (n: number) => screen.getByRole("button", { name: `Painting ${n} of 4` });

async function guess(user: ReturnType<typeof userEvent.setup>, n: number) {
  await user.click(painting(n));
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "This one is the fake" }));
}

it("shows the puzzle number and date in the header", async () => {
  await start();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Spot the Forgery #7");
  expect(screen.getByText("2026-10-26")).toBeInTheDocument();
});

it("titles rounds by kind", async () => {
  const { user } = await start();
  expect(
    screen.getByRole("heading", { name: "Four paintings attributed to Thomas Eakins" }),
  ).toBeInTheDocument();
  await guess(user, 3);
  await user.click(screen.getByRole("button", { name: "Next round" }));
  expect(
    screen.getByRole("heading", { name: "Four paintings from Japan, Edo period (1615–1868)" }),
  ).toBeInTheDocument();
});

it("gives no hints in alt text", async () => {
  await start();
  const alts = screen.getAllByRole("img").map((img) => img.getAttribute("alt"));
  expect(alts).toEqual(["Painting 1 of 4", "Painting 2 of 4", "Painting 3 of 4", "Painting 4 of 4"]);
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
  const live = document.querySelector("[aria-live]");
  expect(live).toHaveTextContent("The oars are modern.");
  expect(live).toHaveTextContent("Correct");
  const link = screen.getByRole("link", { name: /The Biglin Brothers/ });
  expect(link).toHaveAttribute("href", "https://clevelandart.org/art/1");
  expect(screen.getByText(/Starting Out/)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Next round" }));
  expect(screen.queryByText("AI forgery")).not.toBeInTheDocument();
});

it("shows the score and shares to the clipboard", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  const { user } = await start();
  Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

  await guess(user, 3);
  await user.click(screen.getByRole("button", { name: "Next round" }));
  await guess(user, 2);
  expect(document.querySelector("[aria-live]")).toHaveTextContent("Not this time");
  await user.click(screen.getByRole("button", { name: "See results" }));

  expect(screen.getByText("1/2")).toBeInTheDocument();
  const expected = `Spot the Forgery #7 🖼️\n🟩🟥 1/2\n${location.href.split("#")[0]}`;
  expect(screen.getByTestId("share-text")).toHaveTextContent(expected.replace(/\n/g, " "));
  await user.click(screen.getByRole("button", { name: "Copy result" }));
  expect(writeText).toHaveBeenCalledWith(expected);
  expect(await screen.findByText("Copied!")).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem("stf:history")!)).toEqual({
    "2026-10-26": { score: 1, total: 2 },
  });
});

async function finish(user: ReturnType<typeof userEvent.setup>, first: number, second: number) {
  await guess(user, first);
  await user.click(screen.getByRole("button", { name: "Next round" }));
  await guess(user, second);
  await user.click(screen.getByRole("button", { name: "See results" }));
}

const byFile = (file: string) =>
  screen
    .getAllByRole("button", { name: /^Painting \d of 4$/ })
    .find((b) => b.querySelector("img")!.getAttribute("src")!.endsWith(file))!;

async function guessFile(user: ReturnType<typeof userEvent.setup>, file: string) {
  await user.click(byFile(file));
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "This one is the fake" }));
}

it("can play the puzzle again and keeps the first score", async () => {
  const { user } = await start();
  await finish(user, 3, 2);
  expect(screen.getByText("1/2")).toBeInTheDocument();
  expect(screen.getByText(/^Next puzzle in |^The next puzzle is on its way\.$/)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Play again" }));
  expect(
    screen.getByRole("heading", { name: "Four paintings attributed to Thomas Eakins" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("AI forgery")).not.toBeInTheDocument();

  // The paintings are shuffled now, so pick the fakes by image.
  await guessFile(user, "a3.jpg");
  await user.click(screen.getByRole("button", { name: "Next round" }));
  await guessFile(user, "b1.jpg");
  await user.click(screen.getByRole("button", { name: "See results" }));
  expect(screen.getByText("2/2")).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem("stf:history")!)).toEqual({
    "2026-10-26": { score: 1, total: 2 },
  });
});

it("copies the result another way when the clipboard is blocked", async () => {
  const writeText = vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError"));
  const execCommand = vi.fn().mockReturnValue(true);
  const { user } = await start();
  // After start(): user-event installs its own clipboard during setup.
  Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });
  await finish(user, 3, 1);

  await user.click(screen.getByRole("button", { name: "Copy result" }));
  expect(execCommand).toHaveBeenCalledWith("copy");
  expect(await screen.findByText("Copied!")).toBeInTheDocument();
});

it("counts the streak across weekly puzzles", async () => {
  localStorage.setItem("stf:history", JSON.stringify({ "2026-10-19": { score: 4, total: 5 } }));
  const { user } = await start();
  await guess(user, 3);
  await user.click(screen.getByRole("button", { name: "Next round" }));
  await guess(user, 1);
  await user.click(screen.getByRole("button", { name: "See results" }));
  expect(screen.getByText("Your result")).toBeInTheDocument();
  const current = screen.getByText("Current streak").nextElementSibling;
  expect(current).toHaveTextContent("2");
});

it("lists every puzzle in the archive with the player's score", async () => {
  localStorage.setItem("stf:history", JSON.stringify({ "2026-10-19": { score: 4, total: 5 } }));
  const { user } = await start();
  await user.click(screen.getByRole("link", { name: "Archive" }));
  const items = await screen.findAllByRole("listitem");
  expect(items.map((li) => li.textContent)).toEqual([
    "Puzzle #2 · 2026-10-26Not played",
    "Puzzle #1 · 2026-10-19Scored 4/5",
  ]);
});

it("opens a past puzzle from the archive and comes back", async () => {
  const { user } = await start();
  await user.click(screen.getByRole("link", { name: "Archive" }));
  await user.click(await screen.findByRole("link", { name: /Puzzle #1/ }));
  expect(await screen.findByRole("heading", { level: 1, name: "Spot the Forgery #1" })).toBeInTheDocument();
  expect(screen.getByText("2026-10-19")).toBeInTheDocument();
  expect(loadPuzzle).toHaveBeenLastCalledWith(expect.anything(), undefined, undefined, "2026-10-19");

  await user.click(screen.getByRole("link", { name: "Back to the latest puzzle" }));
  expect(await screen.findByRole("heading", { level: 1, name: "Spot the Forgery #7" })).toBeInTheDocument();
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
  await user.click(screen.getByRole("button", { name: "Next round" }));
  await guess(user, 2);
  expect(progress()).toEqual(["Round 1: correct", "Round 2: wrong"]);
});

it("preloads the next round's paintings", async () => {
  await start();
  const preloaded = [...document.head.querySelectorAll('link[rel="preload"][as="image"]')].map(
    (l) => l.getAttribute("href"),
  );
  expect(preloaded).toEqual(
    expect.arrayContaining(["b1.jpg", "b2.jpg", "b3.jpg", "b4.jpg"].map((f) => expect.stringContaining(`2026-10-26/${f}`))),
  );
});

it("browses between paintings in the zoomed view", async () => {
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

  // Swiping left moves on, as on a phone.
  fireEvent.touchStart(dialog(), { touches: [{ clientX: 300, clientY: 200 }] });
  fireEvent.touchEnd(dialog(), { changedTouches: [{ clientX: 120, clientY: 210 }] });
  expect(dialog()).toHaveAccessibleName("Painting 2 of 4");

  await user.click(within(dialog()).getByRole("button", { name: "This one is the fake" }));
  expect(document.querySelector("[aria-live]")).toHaveTextContent("Not this time");
  expect(within(screen.getAllByRole("figure")[1]).getByText("Your guess")).toBeInTheDocument();
});

it("reviews every round on the results screen", async () => {
  const { user } = await start();
  await finish(user, 3, 2);
  const review = screen.getByRole("region", { name: "Review rounds" });
  const summaries = [...review.querySelectorAll("summary")];
  expect(summaries.map((el) => el.textContent)).toEqual([
    "Round 1 · Thomas Eakins · Spotted it",
    "Round 2 · Japan, Edo period (1615–1868) · Missed",
  ]);
  await user.click(summaries[0]);
  expect(within(review).getByText("The oars are modern.")).toBeVisible();
  expect(within(review).getByRole("img", { name: "Round 1, painting 3: the AI forgery, your guess" })).toBeInTheDocument();
  await user.click(summaries[1]);
  expect(within(review).getByRole("img", { name: "Round 2, painting 1: the AI forgery" })).toBeInTheDocument();
  expect(within(review).getByRole("img", { name: "Round 2, painting 2: your guess" })).toBeInTheDocument();
});

it("shuffles the paintings when playing again", async () => {
  const { user } = await start();
  await finish(user, 3, 1);
  await user.click(screen.getByRole("button", { name: "Play again" }));
  const files = () => screen.getAllByRole("img").map((img) => img.getAttribute("src")!.split("/").pop());
  expect([...files()].sort()).toEqual(["a1.jpg", "a2.jpg", "a3.jpg", "a4.jpg"]);
  expect(files()).not.toEqual(["a1.jpg", "a2.jpg", "a3.jpg", "a4.jpg"]);

  // The fake is still the fake wherever it lands.
  const fake = byFile("a3.jpg");
  await guessFile(user, "a3.jpg");
  expect(document.querySelector("[aria-live]")).toHaveTextContent("Correct");
  expect(within(fake.closest("figure")!).getByText("AI forgery")).toBeInTheDocument();
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

it("restores progress after a reload", async () => {
  const { user, unmount } = await start();
  await guess(user, 1);
  unmount();
  await start();
  expect(
    screen.getByRole("heading", { name: "Four paintings from Japan, Edo period (1615–1868)" }),
  ).toBeInTheDocument();
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

it("says when there is no puzzle", async () => {
  vi.mocked(loadPuzzle).mockResolvedValue(null);
  render(<App />);
  expect(await screen.findByText("No puzzle yet — check back soon.")).toBeInTheDocument();
});

it("credits the museum in the footer", async () => {
  await start();
  expect(screen.getByRole("contentinfo")).toHaveTextContent(
    "Real paintings: Cleveland Museum of Art Open Access (CC0). Forgeries are AI-generated for this game.",
  );
});

it("lets the lightbox close with its button", async () => {
  const { user } = await start();
  await user.click(painting(1));
  await act(() => user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" })));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("uses the native share sheet when available", async () => {
  const share = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "share", { value: share, configurable: true });
  localStorage.setItem("stf:progress:2026-10-26", JSON.stringify({ date: "2026-10-26", guesses: [2, 0] }));
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "Share" }));
  expect(share).toHaveBeenCalledWith({ text: expect.stringContaining("🟩🟩 2/2") });
  Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
});

it("fits the zoomed painting to the screen and can show actual size", async () => {
  const { user } = await start();
  await user.click(painting(1));
  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Actual size" }));
  expect(within(dialog).getByRole("button", { name: "Fit to screen" })).toBeInTheDocument();
});

it("can guess from the zoomed view", async () => {
  const { user } = await start();
  await user.click(painting(3));
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "This one is the fake" }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(document.querySelector("[aria-live]")).toHaveTextContent("Correct");
});

it("marks the player's pick in the reveal", async () => {
  const { user } = await start();
  await guess(user, 2);
  expect(within(screen.getAllByRole("figure")[1]).getByText("Your guess")).toBeInTheDocument();
  expect(screen.getAllByText("Your guess")).toHaveLength(1);
});
