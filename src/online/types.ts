export type Metric = 'score' | 'distance';
export type Period = 'all' | 'weekly';
export type Scope = 'global' | 'region';

export interface Pilot {
  callsign: string;
  region: string | null;
}

export interface BoardRow {
  rank: number;
  callsign: string;
  region: string | null;
  score: number;
  distance: number;
  me: boolean;
}

export interface RankInfo {
  rank: number;
  value: number;
  total: number;
  ahead: { rank: number; callsign: string; value: number } | null;
}

export interface BoardResult {
  rows: BoardRow[];
  me: RankInfo | null;
}

export interface RunReport {
  distance: number;
  score: number;
  duration: number;
  maxStreak: number;
}

export interface Leaderboard {
  /** False when scores only live on this device. */
  readonly online: boolean;
  /** Loads this device's pilot, registering one the first time. */
  init(): Promise<Pilot>;
  setCallsign(callsign: string): Promise<string>;
  /** Opens a run on the server; the returned id is needed to submit it. */
  startRun(seed: number): Promise<string>;
  /** Records a finished run and returns the pilot's all-time score rank. */
  submitRun(runId: string, run: RunReport): Promise<RankInfo | null>;
  top(metric: Metric, period: Period, scope: Scope): Promise<BoardResult>;
}

/** `code` is a short machine-readable reason, e.g. 'network', 'callsign_taken', 'run_rejected'. */
export class BoardError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
