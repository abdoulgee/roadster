export type Action = 'left' | 'right' | 'jump' | 'down' | 'boost' | 'item' | 'pause' | 'confirm' | 'mute';
export type TouchAction = 'left' | 'right' | 'jump' | 'down' | 'boost' | 'item';

// One-thumb gestures on the game view (see attachGestures).
/** Travel (px) that turns a touch into a swipe; a long sideways drag changes lane again every SWIPE_PX. */
const SWIPE_PX = 34;
/** A finger that stays put this long (ms) is a hold: jump, then fly for as long as it stays down. */
const HOLD_MS = 170;
/** Movement (px) a hold or a tap may wobble by and still count as one. */
const STILL_PX = 14;

/** Phones and tablets get on-screen controls. In dev, `?touch` forces them on for desktop testing. */
export const IS_TOUCH =
  matchMedia('(pointer: coarse)').matches ||
  matchMedia('(hover: none)').matches ||
  (import.meta.env.DEV && new URLSearchParams(location.search).has('touch'));

const KEYMAP: Record<string, Action> = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'jump',
  KeyW: 'jump',
  Space: 'jump',
  ArrowDown: 'down',
  KeyS: 'down',
  ShiftLeft: 'boost',
  ShiftRight: 'boost',
  KeyP: 'pause',
  Escape: 'pause',
  Enter: 'confirm',
  KeyM: 'mute',
  KeyZ: 'item',
  KeyE: 'item',
};

/** Keyboard state: `held` for continuous actions, `pressed` for edges within the current frame. */
export class Input {
  private readonly held = new Set<Action>();
  private readonly pressed = new Set<Action>();
  private touched = false;

  /** Called on the first key press or tap, e.g. to unlock audio (browsers need a user gesture). */
  onGesture: (() => void) | null = null;

  constructor(target: Window = window) {
    target.addEventListener('pointerdown', () => this.onGesture?.());
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    target.addEventListener('keydown', (e) => {
      this.onGesture?.();
      if (typing(e)) return;
      const action = KEYMAP[e.code];
      if (!action) return;
      e.preventDefault();
      if (!e.repeat) this.pressed.add(action);
      this.held.add(action);
    });
    target.addEventListener('keyup', (e) => {
      const action = KEYMAP[e.code];
      if (action) this.held.delete(action);
    });
    target.addEventListener('blur', () => this.held.clear());
  }

  isHeld(action: Action) {
    return this.held.has(action);
  }

  /** For on-screen buttons and touch gestures. */
  press(action: Action) {
    this.pressed.add(action);
  }

  hold(action: Action, on: boolean) {
    if (on) this.held.add(action);
    else this.held.delete(action);
  }

  /** On-screen buttons: a press fires the action; jump and boost also stay held until release. */
  touch(action: TouchAction, down: boolean) {
    if (down) {
      this.touched = true;
      this.onGesture?.();
      if (action !== 'boost') this.press(action);
    }
    if (action === 'jump' || action === 'boost') this.hold(action, down);
  }

  /** True once the game is being played by touch (phones, tablets, or `?touch` in dev). */
  get touchMode() {
    return IS_TOUCH || this.touched;
  }

  /**
   * One-thumb gestures on `el` (the game view), so the whole game plays with one hand:
   * - swipe left / right: change lane; keep dragging to cross more lanes (a barrel roll in the air)
   * - tap, or swipe up: jump (then tap again in the air to flip)
   * - press and hold: jump and fly while held; slide while holding to steer
   * - swipe down: slam
   * Each finger is tracked on its own, so two-thumbed players can combine them with the buttons.
   */
  attachGestures(el: HTMLElement, onLane?: (side: 'left' | 'right') => void) {
    interface Finger {
      x: number; // anchor for the next lane step
      sx: number;
      sy: number;
      swiped: boolean;
      holding: boolean;
      timer: number;
    }
    const fingers = new Map<number, Finger>();
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') this.touched = true;
      // A desktop mouse only uses the gestures when touch controls are forced on for testing.
      if (e.pointerType === 'mouse' && !IS_TOUCH) return;
      e.preventDefault();
      this.onGesture?.();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Touch pointers are captured by their target anyway; this only matters for a test mouse.
      }
      const f: Finger = { x: e.clientX, sx: e.clientX, sy: e.clientY, swiped: false, holding: false, timer: 0 };
      f.timer = window.setTimeout(() => {
        if (f.swiped) return;
        f.holding = true;
        this.press('jump');
        this.hold('jump', true);
      }, HOLD_MS);
      fingers.set(e.pointerId, f);
    });
    el.addEventListener('pointermove', (e) => {
      const f = fingers.get(e.pointerId);
      if (!f) return;
      const dx = e.clientX - f.x;
      const dy = e.clientY - f.sy;
      if (Math.max(Math.abs(e.clientX - f.sx), Math.abs(dy)) > STILL_PX && !f.holding) clearTimeout(f.timer);
      // Sideways: a lane per SWIPE_PX of travel, also while holding (steering in flight).
      if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 0.8) {
        const side = dx < 0 ? 'left' : 'right';
        this.press(side);
        onLane?.(side);
        f.x = e.clientX;
        f.swiped = true;
        return;
      }
      // Up or down, once per touch, and not while holding (a held thumb drifts).
      if (!f.swiped && !f.holding && Math.abs(dy) >= SWIPE_PX && Math.abs(dy) > Math.abs(e.clientX - f.sx)) {
        this.press(dy < 0 ? 'jump' : 'down');
        f.swiped = true;
      }
    });
    const release = (e: PointerEvent) => {
      const f = fingers.get(e.pointerId);
      if (!f) return;
      fingers.delete(e.pointerId);
      clearTimeout(f.timer);
      if (f.holding) {
        // Other fingers may still be holding.
        if (![...fingers.values()].some((o) => o.holding)) this.hold('jump', false);
      } else if (!f.swiped && e.type === 'pointerup') {
        this.press('jump'); // a tap
      }
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
  }

  wasPressed(action: Action) {
    return this.pressed.has(action);
  }

  endFrame() {
    this.pressed.clear();
  }
}
