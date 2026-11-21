// Vibration: short rumbles on a controller's motors, or buzzes on a phone (where the browser allows it).

export type Buzz = 'land' | 'crash' | 'smash' | 'near' | 'pickup' | 'power' | 'shockwave' | 'shield' | 'ui';

interface Rumble {
  ms: number;
  strong: number;
  weak: number;
}

const RUMBLE: Record<Buzz, Rumble> = {
  land: { ms: 90, strong: 0.5, weak: 0.3 },
  crash: { ms: 420, strong: 1, weak: 0.8 },
  smash: { ms: 160, strong: 0.8, weak: 0.5 },
  near: { ms: 45, strong: 0, weak: 0.45 },
  pickup: { ms: 40, strong: 0, weak: 0.3 },
  power: { ms: 260, strong: 0.6, weak: 0.9 },
  shockwave: { ms: 350, strong: 1, weak: 1 },
  shield: { ms: 200, strong: 0.7, weak: 0.4 },
  ui: { ms: 25, strong: 0, weak: 0.25 },
};

// Phones only have one motor, so patterns stand in for strength.
const PHONE: Record<Buzz, number | number[]> = {
  land: 25,
  crash: [80, 40, 160],
  smash: 50,
  near: 12,
  pickup: 10,
  power: [30, 30, 60],
  shockwave: [60, 30, 90],
  shield: [40, 30, 40],
  ui: 8,
};

type Actuator = { playEffect?(type: string, params: Record<string, number>): Promise<unknown> };

export class Haptics {
  enabled: boolean;
  /** The controller to rumble, if one is in use (see Input.gamepad). */
  pad: Gamepad | null = null;
  /** True while the game is being played by touch: buzz the phone. */
  phone = false;

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  /** Whether this device can vibrate at all: a phone that supports it, or a controller with motors. */
  get supported() {
    return (this.phone && typeof navigator.vibrate === 'function') || !!this.actuator();
  }

  /** `scale` 0–1 softens the effect (a gentle landing, say). */
  buzz(kind: Buzz, scale = 1) {
    if (!this.enabled || scale <= 0.02) return;
    const act = this.actuator();
    if (act?.playEffect) {
      const r = RUMBLE[kind];
      act
        .playEffect('dual-rumble', {
          startDelay: 0,
          duration: r.ms,
          strongMagnitude: Math.min(1, r.strong * scale),
          weakMagnitude: Math.min(1, r.weak * scale),
        })
        .catch(() => {});
      return;
    }
    if (this.phone && typeof navigator.vibrate === 'function') {
      const p = PHONE[kind];
      try {
        navigator.vibrate(typeof p === 'number' ? Math.max(5, Math.round(p * scale)) : p);
      } catch {
        // Some browsers refuse before the first tap; nothing to do.
      }
    }
  }

  private actuator(): Actuator | null {
    return ((this.pad as unknown as { vibrationActuator?: Actuator } | null)?.vibrationActuator ?? null) as Actuator | null;
  }
}
