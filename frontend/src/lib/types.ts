// The published puzzle files, as generator/src/spot_the_forgery/publish.py writes them.

export interface PuzzleRound {
  groupKey: string;
  kind: "artist" | "culture";
  label: string;
  // Image file names in the puzzle's folder; a guess is an index into this list.
  images: string[];
  realIds: number[];
  difficulty: number;
}

export interface Puzzle {
  date: string;
  number: number;
  rounds: PuzzleRound[];
  // The answers, unsealed with seal.ts.
  sealed: string;
}

export interface RealPainting {
  // Position in the round's images.
  index: number;
  title: string;
  // The museum's date for the work; may be empty.
  date: string;
  url: string;
}

export interface RoundReveal {
  fakeIndex: number;
  note: string;
  real: RealPainting[];
}

export interface SealedPayload {
  rounds: RoundReveal[];
}

// A finished puzzle as kept in the player's history.
export interface DayResult {
  score: number;
  total: number;
}
