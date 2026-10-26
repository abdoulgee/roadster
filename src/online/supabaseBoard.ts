import { loadJSON, saveJSON } from '../storage';
import { callsignProblem, detectRegion, randomCallsign } from './callsign';
import { BoardError, type BoardResult, type Leaderboard, type Metric, type Period, type RankInfo, type RunReport, type Scope } from './types';

const PILOT_KEY = 'drive-roadster:online-pilot:v1';

interface StoredPilot {
  url: string; // which project this identity belongs to
  id: string;
  secret: string;
  callsign: string;
  region: string | null;
}

/**
 * Talks to the functions in supabase/schema.sql through PostgREST's /rpc endpoint. Plain fetch keeps
 * the bundle small; the anon key is public by design, and the tables are only reachable via the RPCs.
 */
export class SupabaseBoard implements Leaderboard {
  readonly online = true;
  private pilot: StoredPilot | null = null;

  constructor(
    private readonly url: string,
    private readonly key: string,
  ) {}

  async init() {
    const stored = loadJSON<Partial<StoredPilot>>(PILOT_KEY, {});
    if (stored.url === this.url && stored.id && stored.secret && stored.callsign) {
      this.pilot = stored as StoredPilot;
    } else {
      const region = detectRegion();
      const created = await this.rpc<{ id: string; secret: string; callsign: string }>('register_player', {
        p_callsign: randomCallsign(),
        p_region: region,
      });
      this.pilot = { url: this.url, ...created, region };
      saveJSON(PILOT_KEY, this.pilot);
    }
    return { callsign: this.pilot.callsign, region: this.pilot.region };
  }

  async setCallsign(callsign: string) {
    const problem = callsignProblem(callsign);
    if (problem) throw new BoardError(problem === 'bad' ? 'callsign_banned' : `callsign_${problem}`);
    const me = this.requirePilot();
    await this.rpc('set_callsign', { p_player: me.id, p_secret: me.secret, p_callsign: callsign });
    me.callsign = callsign;
    saveJSON(PILOT_KEY, me);
    return callsign;
  }

  async startRun(seed: number) {
    const me = this.requirePilot();
    // Seeds are unsigned 32-bit; Postgres bigint takes them as-is.
    return this.rpc<string>('start_run', { p_player: me.id, p_secret: me.secret, p_seed: seed });
  }

  async submitRun(runId: string, run: RunReport) {
    const me = this.requirePilot();
    return this.rpc<RankInfo | null>('submit_run', {
      p_player: me.id,
      p_secret: me.secret,
      p_run: runId,
      p_distance: Math.floor(run.distance),
      p_score: Math.floor(run.score),
      p_duration: Math.round(run.duration * 10) / 10,
      p_max_streak: run.maxStreak,
    });
  }

  async top(metric: Metric, period: Period, scope: Scope) {
    const me = this.pilot;
    if (scope === 'region' && !me?.region) throw new BoardError('region_unknown');
    return this.rpc<BoardResult>('get_leaderboard', {
      p_metric: metric,
      p_period: period,
      p_region: scope === 'region' ? me!.region : null,
      p_player: me?.id ?? null,
    });
  }

  private requirePilot() {
    if (!this.pilot) throw new BoardError('not_ready');
    return this.pilot;
  }

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.url}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
    } catch {
      throw new BoardError('network');
    }
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const message = (body as { message?: unknown } | null)?.message;
      throw new BoardError(typeof message === 'string' ? message : `http_${res.status}`);
    }
    return body as T;
  }
}
