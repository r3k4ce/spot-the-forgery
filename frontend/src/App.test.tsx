import { act, render, screen, within } from "@testing-library/react";
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

beforeEach(() => {
  localStorage.clear();
  vi.mocked(loadPuzzle).mockResolvedValue(PUZZLE);
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
  await user.click(screen.getByRole("button", { name: "Share" }));
  expect(writeText).toHaveBeenCalledWith(expected);
  expect(await screen.findByText("Copied!")).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem("stf:history")!)).toEqual({
    "2026-10-26": { score: 1, total: 2 },
  });
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
  expect(await screen.findByText("No puzzle today — check back soon.")).toBeInTheDocument();
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
