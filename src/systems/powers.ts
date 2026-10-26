import { BOOST, BOOST_DURING_POWER, POWERS, POWER_GRACE, type ItemKind, type PowerKind } from '../config';

export type PowerEvent = { type: 'start' | 'end'; power: PowerKind };

/** Timed power modes, the heat shield, the rocket meter and the one-item slot. */
export class Powers {
  power: PowerKind | null = null;
  timeLeft = 0;
  grace = 0;
  shield = false;
  rocketMeter = 0;
  item: ItemKind | null = null;
  readonly events: PowerEvent[] = [];

  reset() {
    this.power = null;
    this.timeLeft = this.grace = this.rocketMeter = 0;
    this.shield = false;
    this.item = null;
    this.events.length = 0;
  }

  /** Smashes through traffic instead of crashing. */
  get invincible() {
    return this.power !== null || this.grace > 0;
  }

  get scoreMult() {
    return this.power ? POWERS[this.power].scoreMult : 1;
  }

  get timeRatio() {
    return this.power ? this.timeLeft / POWERS[this.power].duration : 0;
  }

  speedMult(boosting: boolean) {
    if (!this.power) return boosting ? BOOST.mult : 1;
    return POWERS[this.power].speedMult * (boosting ? BOOST_DURING_POWER : 1);
  }

  start(power: PowerKind) {
    if (this.power && this.power !== power) this.events.push({ type: 'end', power: this.power });
    this.power = power;
    this.timeLeft = POWERS[power].duration;
    this.events.push({ type: 'start', power });
  }

  /** Charges the rocket meter; it can't charge while already invincible. Launches when full. */
  chargeRocket(amount: number) {
    if (this.invincible) return;
    this.rocketMeter = Math.min(1, this.rocketMeter + amount);
    if (this.rocketMeter >= 1) {
      this.rocketMeter = 0;
      this.start('rocket');
    }
  }

  /** Absorbs a hit with the shield if one is up; returns whether it did. */
  absorbHit() {
    if (!this.shield) return false;
    this.shield = false;
    this.grace = POWER_GRACE;
    return true;
  }

  update(dt: number) {
    this.grace = Math.max(0, this.grace - dt);
    if (!this.power) return;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.events.push({ type: 'end', power: this.power });
      this.power = null;
      this.grace = POWER_GRACE;
    }
  }
}
