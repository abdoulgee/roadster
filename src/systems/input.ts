export type Action =
  | 'left'
  | 'right'
  | 'jump'
  | 'down'
  | 'boost'
  | 'item'
  | 'pause'
  | 'confirm'
  | 'mute'
  | 'paint'
  | 'photo'
  // Menus: move the highlight, and go back a level.
  | 'menuUp'
  | 'menuDown'
  | 'back'
  | 'adminToggle';
export type TouchAction = 'left' | 'right' | 'jump' | 'down' | 'boost' | 'item';

// Gestures on the game view (see attachGestures).
/** Travel (px) that turns a touch into a swipe; a long sideways drag changes lane again every SWIPE_PX. */
const SWIPE_PX = 42;
/** A finger that stays put this long (ms) is a hold: it boosts for as long as it stays down. */
const HOLD_MS = 170;
/** Movement (px) a hold or a tap may wobble by and still count as one. */
const STILL_PX = 14;

/** Phones and tablets get on-screen controls. In dev, `?touch` forces them on for desktop testing. */
export const IS_TOUCH =
  matchMedia('(pointer: coarse)').matches ||
  matchMedia('(hover: none)').matches ||
  (import.meta.env.DEV && new URLSearchParams(location.search).has('touch'));

/** Keys and what they do; some do one thing while driving and another in the menus. */
const KEYMAP: Record<string, Action[]> = {
  ArrowLeft: ['left'],
  KeyA: ['left'],
  ArrowRight: ['right'],
  KeyD: ['right'],
  ArrowUp: ['jump', 'menuUp'],
  KeyW: ['jump', 'menuUp'],
  Space: ['jump', 'confirm'],
  ArrowDown: ['down', 'menuDown'],
  KeyS: ['down', 'menuDown'],
  ShiftLeft: ['boost'],
  ShiftRight: ['boost'],
  KeyP: ['pause'],
  Escape: ['pause', 'back'],
  Backspace: ['back'],
  Enter: ['confirm'],
  KeyM: ['mute'],
  KeyZ: ['item'],
  KeyE: ['item'],
  KeyV: ['paint'],
  KeyC: ['photo'],
};

/**
 * Controller buttons in the browser's "standard" layout (Xbox naming): A jumps, B slams, X uses the
 * item, Y opens photo mode, the bumpers and triggers boost. In the menus A picks, B goes back, and
 * the d-pad or left stick moves the highlight (up / down) and changes car (left / right).
 */
const PAD_BUTTONS: Record<number, Action[]> = {
  0: ['jump', 'confirm'],
  1: ['down', 'back'],
  2: ['item'],
  3: ['photo'],
  4: ['boost'],
  5: ['boost'],
  6: ['boost'],
  7: ['boost'],
  8: ['mute'],
  9: ['pause'],
  12: ['jump', 'menuUp'],
  13: ['down', 'menuDown'],
  14: ['left'],
  15: ['right'],
};

/** Stick travel that counts as a push, and the travel it must fall back under before the next one. */
const STICK_ON = 0.6;
const STICK_OFF = 0.35;
const DEADZONE = 0.15;

const dead = (v: number) => (Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE));

/** App-level dialogs (currently the install invitation) get the keyboard and pad to themselves. */
const dialogOwnsInput = () => {
  const el = document.getElementById('install');
  return !!el && !el.classList.contains('hidden');
};

/** Analog controller state, for photo mode's free camera. */
export interface Analog {
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  /** Right trigger minus left trigger. */
  zoom: number;
}

/** Keyboard state: `held` for continuous actions, `pressed` for edges within the current frame. */
export class Input {
  private readonly held = new Set<Action>();
  private readonly pressed = new Set<Action>();
  private touched = false;
  private readonly padHeld = new Set<Action>();
  private readonly padPrev: boolean[] = [];
  private stickSide = 0;
  private stickVert = 0;
  /** The controller in use, if any; its motors carry the rumble. */
  gamepad: Gamepad | null = null;
  readonly analog: Analog = { lx: 0, ly: 0, rx: 0, ry: 0, zoom: 0 };
  /** Called when a controller is plugged in (true) or removed (false). */
  onGamepad: ((connected: boolean, name: string) => void) | null = null;
  /** Called when play switches between the keyboard and a controller, so prompts can show its buttons. */
  onDevice: ((pad: boolean) => void) | null = null;
  private padInUse = false;
  private adminCodeProgress = 0;

  /** Called on the first key press or tap, e.g. to unlock audio (browsers need a user gesture). */
  onGesture: (() => void) | null = null;

  constructor(target: Window = window) {
    target.addEventListener('pointerdown', () => this.onGesture?.());
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    target.addEventListener('keydown', (e) => {
      this.onGesture?.();
      if (dialogOwnsInput() || typing(e)) return;
      const actions = KEYMAP[e.code];
      if (!e.repeat && this.trackAdminCode(e.code)) this.pressed.add('adminToggle');
      if (!actions) return;
      e.preventDefault();
      this.usePad(false);
      for (const action of actions) {
        if (!e.repeat) this.pressed.add(action);
        this.held.add(action);
      }
    });
    target.addEventListener('keyup', (e) => {
      for (const action of KEYMAP[e.code] ?? []) this.held.delete(action);
    });
    target.addEventListener('blur', () => {
      this.held.clear();
      this.adminCodeProgress = 0;
    });
    target.addEventListener('gamepadconnected', (e) => this.onGamepad?.(true, (e as GamepadEvent).gamepad.id));
    target.addEventListener('gamepaddisconnected', (e) => {
      if (this.gamepad?.index === (e as GamepadEvent).gamepad.index) {
        this.gamepad = null;
        for (const a of this.padHeld) this.held.delete(a);
        this.padHeld.clear();
        this.usePad(false);
      }
      this.onGamepad?.(false, (e as GamepadEvent).gamepad.id);
    });
  }

  /**
   * Reads the controller once a frame (browsers only report pads by polling): new button presses become
   * actions, held buttons hold, and the left stick changes lane with a push to either side.
   */
  pollGamepad() {
    if (dialogOwnsInput()) {
      // Let go of whatever the pad was holding so nothing fires when the dialog closes.
      for (const act of this.padHeld) this.held.delete(act);
      this.padHeld.clear();
      this.stickSide = 0;
      this.stickVert = 0;
      return;
    }
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) {
      if (p && p.connected && p.mapping === 'standard') {
        pad = p;
        break;
      }
      if (p && p.connected && !pad) pad = p;
    }
    this.gamepad = pad;
    const a = this.analog;
    if (!pad) {
      a.lx = a.ly = a.rx = a.ry = a.zoom = 0;
      return;
    }
    const nowHeld = new Set<Action>();
    pad.buttons.forEach((b, i) => {
      const down = b.pressed || b.value > 0.5;
      const actions = PAD_BUTTONS[i];
      if (!actions) return;
      if (down) for (const act of actions) nowHeld.add(act);
      if (down && !this.padPrev[i]) {
        this.onGesture?.();
        this.usePad(true);
        for (const act of actions) this.pressed.add(act);
      }
      this.padPrev[i] = down;
    });
    // Release what the pad no longer holds (keys held on the keyboard stay held).
    for (const act of this.padHeld) if (!nowHeld.has(act)) this.held.delete(act);
    for (const act of nowHeld) this.held.add(act);
    this.padHeld.clear();
    for (const act of nowHeld) this.padHeld.add(act);

    const ax = pad.axes;
    a.lx = dead(ax[0] ?? 0);
    a.ly = dead(ax[1] ?? 0);
    a.rx = dead(ax[2] ?? 0);
    a.ry = dead(ax[3] ?? 0);
    a.zoom = (pad.buttons[7]?.value ?? 0) - (pad.buttons[6]?.value ?? 0);
    const x = ax[0] ?? 0;
    if (this.stickSide === 0 && Math.abs(x) > STICK_ON) {
      this.stickSide = Math.sign(x);
      this.pressed.add(x < 0 ? 'left' : 'right');
      this.usePad(true);
    } else if (this.stickSide !== 0 && Math.abs(x) < STICK_OFF) {
      this.stickSide = 0;
    }
    // Up and down on the stick only move the menu highlight (jumping is a button).
    const y = ax[1] ?? 0;
    if (this.stickVert === 0 && Math.abs(y) > STICK_ON && Math.abs(y) > Math.abs(x)) {
      this.stickVert = Math.sign(y);
      this.pressed.add(y < 0 ? 'menuUp' : 'menuDown');
      this.usePad(true);
    } else if (this.stickVert !== 0 && Math.abs(y) < STICK_OFF) {
      this.stickVert = 0;
    }
  }

  private usePad(pad: boolean) {
    if (pad === this.padInUse) return;
    this.padInUse = pad;
    this.onDevice?.(pad);
  }

  /** Secret admin shortcut: V, V, B, B. Any other key interrupts the sequence. */
  private trackAdminCode(code: string) {
    const sequence = ['KeyV', 'KeyV', 'KeyB', 'KeyB'];
    if (code === sequence[this.adminCodeProgress]) {
      this.adminCodeProgress++;
    } else {
      this.adminCodeProgress = code === 'KeyV' ? 1 : 0;
    }
    if (this.adminCodeProgress < sequence.length) return false;
    this.adminCodeProgress = 0;
    return true;
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
   * Gestures on `el` (the game view):
   * - tap the left / right half or swipe in that direction: step one lane at a time
   * - press and hold: boost while held; slide while holding to change lane
   * - swipe up: jump and hold to hover; release to fall. Swipe down: slam
   * A plain tap steers but never jumps. Each finger is tracked on its own, so gestures and the on-screen controls
   * work together.
   */
  attachGestures(el: HTMLElement) {
    interface Finger {
      x: number; // anchor for the next lane step
      sx: number;
      sy: number;
      swiped: boolean;
      holding: boolean;
      jumping: boolean;
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
      const f: Finger = { x: e.clientX, sx: e.clientX, sy: e.clientY, swiped: false, holding: false, jumping: false, timer: 0 };
      f.timer = window.setTimeout(() => {
        if (f.swiped || f.jumping) return;
        f.holding = true;
        this.hold('boost', true);
      }, HOLD_MS);
      fingers.set(e.pointerId, f);
    });
    el.addEventListener('pointermove', (e) => {
      const f = fingers.get(e.pointerId);
      if (!f) return;
      const dx = e.clientX - f.x;
      const dy = e.clientY - f.sy;
      if (Math.max(Math.abs(e.clientX - f.sx), Math.abs(dy)) > STILL_PX && !f.holding) clearTimeout(f.timer);
      // Sideways: a lane per SWIPE_PX of travel, also while holding (changing lane under boost).
      if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 0.8) {
        const side = dx < 0 ? 'left' : 'right';
        this.press(side);
        f.x = e.clientX;
        f.swiped = true;
        return;
      }
      // Vertical gestures are anchored to initial touch; an upward swipe stays held until release,
      // making jump and hover one continuous, easy-to-understand action.
      if (!f.swiped && !f.holding && Math.abs(dy) >= SWIPE_PX && Math.abs(dy) > Math.abs(e.clientX - f.sx)) {
        if (dy < 0) {
          f.jumping = true;
          f.swiped = true;
          this.press('jump');
          this.hold('jump', true);
        } else {
          this.press('down');
          f.swiped = true;
        }
      }
    });
    const release = (e: PointerEvent) => {
      const f = fingers.get(e.pointerId);
      if (!f) return;
      fingers.delete(e.pointerId);
      clearTimeout(f.timer);
      if (f.jumping && ![...fingers.values()].some((o) => o.jumping)) this.hold('jump', false);
      // Other fingers may still be holding.
      if (f.holding && ![...fingers.values()].some((o) => o.holding)) this.hold('boost', false);
      if (e.type === 'pointerup' && !f.swiped && !f.holding && !f.jumping) {
        const side = e.clientX < window.innerWidth / 2 ? 'left' : 'right';
        this.press(side);
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
