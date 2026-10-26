import { loadJSON, saveJSON } from '../storage';
import { callsignProblem, detectRegion, randomCallsign } from './callsign';
import { BoardError, type BoardResult, type Leaderboard, type Metric, type Period, type Pilot, type RankInfo, type RunReport } from './types';

const PILOT_KEY = 'drive-roadster:pilot:v1';
const RUNS_KEY = 'drive-roadster:runs:v1';
const MAX_RUNS = 500;

interface LocalRun {
  score: number;
  distance: number;
  at: number;
}

/** Monday 00:00 UTC, matching Postgres date_trunc('week', now()) on a UTC server. */
export function weekStart(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.getTime();
}

/** Used when no online backend is configured: every run on this device, ranked against each other. */
export class LocalBoard implements Leaderboard {
  readonly online = false;
  private pilot: Pilot = { callsign: '', region: null };

  async init() {
    this.pilot = loadJSON<Pilot>(PILOT_KEY, { callsign: '', region: null });
    if (!this.pilot.callsign) {
      this.pilot = { callsign: randomCallsign(), region: detectRegion() };
      saveJSON(PILOT_KEY, this.pilot);
    }
    return { ...this.pilot };
  }

  async setCallsign(callsign: string) {
    const problem = callsignProblem(callsign);
    if (problem) throw new BoardError(problem === 'bad' ? 'callsign_banned' : `callsign_${problem}`);
    this.pilot.callsign = callsign;
    saveJSON(PILOT_KEY, this.pilot);
    return callsign;
  }

  async startRun() {
    return 'local';
  }

  async submitRun(_runId: string, run: RunReport) {
    const runs = this.runs();
    runs.push({ score: run.score, distance: run.distance, at: Date.now() });
    runs.sort((a, b) => b.score - a.score);
    saveJSON(RUNS_KEY, { runs: runs.slice(0, MAX_RUNS) });
    return this.rankOf(runs, 'score', run.score);
  }

  async top(metric: Metric, period: Period): Promise<BoardResult> {
    const since = period === 'weekly' ? weekStart() : 0;
    const runs = this.runs()
      .filter((r) => r.at >= since)
      .sort((a, b) => b[metric] - a[metric]);
    const rows = runs.slice(0, 100).map((r, i) => ({
      rank: i + 1,
      callsign: this.pilot.callsign,
      region: this.pilot.region,
      score: r.score,
      distance: r.distance,
      me: i === 0,
    }));
    return { rows, me: runs.length ? this.rankOf(runs, metric, runs[0][metric]) : null };
  }

  private runs(): LocalRun[] {
    return loadJSON<{ runs: LocalRun[] }>(RUNS_KEY, { runs: [] }).runs.filter(
      (r) => Number.isFinite(r.score) && Number.isFinite(r.distance),
    );
  }

  private rankOf(runs: LocalRun[], metric: Metric, value: number): RankInfo {
    const better = runs.filter((r) => r[metric] > value).sort((a, b) => a[metric] - b[metric]);
    return {
      rank: better.length + 1,
      value,
      total: runs.length,
      ahead: better.length ? { rank: better.length, callsign: this.pilot.callsign, value: better[0][metric] } : null,
    };
  }
}
