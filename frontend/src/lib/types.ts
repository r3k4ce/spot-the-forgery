export interface PuzzleRound {
  groupKey: string;
  kind: "artist" | "culture";
  label: string;
  images: string[];
  realIds: number[];
  difficulty: number;
}

export interface Puzzle {
  date: string;
  number: number;
  rounds: PuzzleRound[];
  sealed: string;
}

export interface RealPainting {
  index: number;
  title: string;
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

export interface DayResult {
  score: number;
  total: number;
}
