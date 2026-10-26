import { COMBO } from '../config';

export interface StreakSummary {
  count: number;
  score: number;
}

/** Chains skills into a streak with a rising multiplier. Points already earned are kept when it ends. */
export class Combo {
  count = 0;
  score = 0;
  private timer = 0;

  get active() {
    return this.count > 0;
  }

  get multiplier() {
    return Math.min(COMBO.maxMult, Math.max(1, this.count));
  }

  get timeRatio() {
    return this.timer / COMBO.window;
  }

  reset() {
    this.count = this.score = this.timer = 0;
  }

  /** Registers a skill and returns its points after the multiplier. */
  add(points: number) {
    this.count++;
    const earned = points * this.multiplier;
    this.score += earned;
    this.timer = COMBO.window;
    return earned;
  }

  /** Counts down unless `frozen` (mid-maneuver). Returns a summary when the streak expires. */
  update(dt: number, frozen: boolean): StreakSummary | null {
    if (!this.active || frozen) return null;
    this.timer -= dt;
    if (this.timer > 0) return null;
    const summary = { count: this.count, score: this.score };
    this.reset();
    return summary;
  }
}
