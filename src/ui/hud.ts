import { AIR, type ItemKind, type PowerKind } from '../config';
import { ITEM_STYLE, itemIconURL } from '../entities/pickups';
import { IS_TOUCH, type TouchAction } from '../systems/input';

export type Screen = 'menu' | 'playing' | 'paused' | 'over';

export interface RunSummary {
  score: number;
  distance: number;
  time: number;
  best: number;
  isRecord: boolean;
  reason: string;
}

export type PopupTone = 'good' | 'great' | 'warn';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** How far (px) a finger pushes the JUMP stick before it counts as a lane change or a slam. */
const FLICK_PX = 26;
/** How far the stick's knob follows the finger, px. */
const KNOB_TRAVEL = 30;

const POWER_STYLE: Record<PowerKind, { name: string; sub: string; color: string }> = {
  starman: { name: '★ STARMAN', sub: 'INVINCIBLE · ×2 SCORE', color: '#ffd23f' },
  rocket: { name: 'ROCKET MODE', sub: 'INFINITE AIR · INVINCIBLE · ×3 SCORE', color: '#ff9a3d' },
  ludicrous: { name: 'LUDICROUS', sub: 'HYPER SPEED · INVINCIBLE · ×2 SCORE', color: '#ff3fa8' },
};

const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class Hud {
  private readonly screens = {
    menu: $('menu'),
    paused: $('pause'),
    over: $('over'),
  };
  private readonly hud = $('hud');
  private readonly garage = $('garage');
  private readonly garageInfo = document.querySelector<HTMLElement>('.garage-info')!;
  private screenShown: Screen = 'menu';
  private hintTimer = 0;
  private readonly menuPanel = document.querySelector<HTMLElement>('.menu-panel')!;
  private readonly dist = $('hud-dist');
  private readonly score = $('hud-score');
  private readonly airFill = $('hud-air-fill');
  private readonly airVal = $('hud-air-val');
  private readonly airBox = $('hud-air');
  private readonly popups = $('popups');
  private readonly combo = $('hud-combo');
  private readonly comboMult = $('combo-mult');
  private readonly comboCount = $('combo-count');
  private readonly comboScore = $('combo-score');
  private readonly comboFill = $('combo-fill');
  private readonly rocketFill = $('hud-rocket-fill');
  private readonly rocketVal = $('hud-rocket-val');
  private readonly power = $('hud-power');
  private readonly powerFill = $('power-fill');
  private readonly zone = $('zone-banner');
  private last = { dist: -1, score: -1, air: -1, low: false, boost: false, comboCount: -1, rocket: -1 };

  constructor(handlers: {
    play(): void;
    resume(): void;
    menu(): void;
    pause(): void;
    mute(): void;
    touch(action: TouchAction, down: boolean): void;
    flick(dir: 'left' | 'right' | 'down'): void;
    car(step: -1 | 1): void;
    callsign(): void;
    share(): void;
  }) {
    const bind = (id: string, fn: () => void) =>
      $(id).addEventListener('click', (e) => {
        (e.currentTarget as HTMLElement).blur();
        fn();
      });
    bind('btn-play', handlers.play);
    bind('btn-retry', handlers.play);
    bind('btn-resume', handlers.resume);
    bind('btn-pause-menu', handlers.menu);
    bind('btn-over-menu', handlers.menu);
    bind('btn-pause', handlers.pause);
    bind('btn-mute', handlers.mute);
    bind('btn-callsign', handlers.callsign);
    bind('btn-share', handlers.share);
    bind('btn-car-prev', () => handlers.car(-1));
    bind('btn-car-next', () => handlers.car(1));

    // On-screen controls. Each button captures its own pointer, so steering and jumping work together.
    const root = document.documentElement;
    root.classList.toggle('touch', IS_TOUCH);
    window.addEventListener('touchstart', () => root.classList.add('touch'), { once: true, passive: true });
    for (const btn of document.querySelectorAll<HTMLElement>('[data-touch]')) {
      const action = btn.dataset.touch as TouchAction;
      let pointer: number | null = null;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (pointer !== null) return;
        pointer = e.pointerId;
        try {
          btn.setPointerCapture(e.pointerId);
        } catch {
          // Capture is a nicety (keeps the press if the thumb slides off); the press still counts.
        }
        btn.classList.add('active');
        handlers.touch(action, true);
      });
      const release = (e: PointerEvent) => {
        if (e.pointerId !== pointer) return;
        pointer = null;
        btn.classList.remove('active');
        handlers.touch(action, false);
      };
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
      if (action === 'jump') this.bindStick(btn, handlers, () => pointer);
    }
  }

  /**
   * The JUMP stick: touching it jumps and holding it flies (the button's own press and hold). While it is
   * held, pushing left or right changes lane (repeating across several lanes, also in flight) and a
   * flick down slams, letting go of the fly so it doesn't fight the dive. The knob follows the thumb.
   */
  private bindStick(
    btn: HTMLElement,
    handlers: { flick(dir: 'left' | 'right' | 'down'): void; touch(action: TouchAction, down: boolean): void },
    pointer: () => number | null,
  ) {
    let startX = 0;
    let startY = 0;
    let anchorX = 0;
    let anchorY = 0;
    let slammed = false;
    const pop = (cls: string) => {
      btn.classList.remove(cls);
      void btn.offsetWidth;
      btn.classList.add(cls);
    };
    btn.addEventListener('pointerdown', (e) => {
      if (e.pointerId !== pointer()) return;
      startX = anchorX = e.clientX;
      startY = anchorY = e.clientY;
      slammed = false;
    });
    btn.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pointer()) return;
      const dx = e.clientX - anchorX;
      const dy = e.clientY - anchorY;
      if (Math.abs(dx) >= FLICK_PX && Math.abs(dx) > Math.abs(dy)) {
        handlers.flick(dx < 0 ? 'left' : 'right');
        anchorX = e.clientX;
        anchorY = e.clientY;
        pop(dx < 0 ? 'flick-l' : 'flick-r');
      } else if (!slammed && dy >= FLICK_PX && dy > Math.abs(dx)) {
        handlers.flick('down');
        handlers.touch('jump', false);
        slammed = true;
        anchorY = e.clientY;
        pop('flick-d');
      }
      // The knob follows the thumb, held inside the ring.
      let kx = e.clientX - startX;
      let ky = e.clientY - startY;
      const k = Math.hypot(kx, ky);
      if (k > KNOB_TRAVEL) {
        kx *= KNOB_TRAVEL / k;
        ky *= KNOB_TRAVEL / k;
      }
      btn.style.setProperty('--kx', `${kx.toFixed(1)}px`);
      btn.style.setProperty('--ky', `${ky.toFixed(1)}px`);
    });
    const reset = () => {
      btn.style.setProperty('--kx', '0px');
      btn.style.setProperty('--ky', '0px');
    };
    btn.addEventListener('pointerup', reset);
    btn.addEventListener('pointercancel', reset);
  }

  /** A soft glow up the screen edge on the side a swipe changed lane to. */
  laneFlash(side: 'left' | 'right') {
    const el = document.querySelector<HTMLElement>(`.tc-edge.${side}`);
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  setItem(kind: ItemKind | null) {
    const box = $('hud-item');
    box.classList.toggle('empty', !kind);
    document.querySelector('.touch-btn.item')?.classList.toggle('ready', !!kind);
    if (kind) document.querySelector<HTMLImageElement>('.tc-item-icon')!.src = itemIconURL(kind);
    $('hud-item-name').textContent = kind ? ITEM_STYLE[kind].name : 'NO ITEM';
    if (kind) {
      ($('hud-item-icon') as HTMLImageElement).src = itemIconURL(kind);
      box.classList.remove('fresh');
      void box.offsetWidth;
      box.classList.add('fresh');
    }
  }

  /** The garage caption under the car: its name and a one-line description. */
  setCar(name: string, tagline: string) {
    $('car-name').textContent = name;
    $('car-tagline').textContent = tagline;
    this.garageInfo.classList.remove('swap');
    void this.garageInfo.offsetWidth;
    this.garageInfo.classList.add('swap');
  }

  /** Left edge (px) of the screen space the menu panel leaves free for the car: 0 when the panel sits below it. */
  menuSpaceLeft() {
    const r = this.menuPanel.getBoundingClientRect();
    return r.top > window.innerHeight * 0.4 ? 0 : r.right;
  }

  /**
   * Frames the garage around the car on screen (CSS pixels): the arrows sit `half` either side of
   * the car's centre (cx, cy), and the caption sits below it at `infoY`. The caption never covers the
   * menu: kept above the title when the panel is below the car (portrait phones), and kept right of
   * the panel when it is beside it.
   */
  placeGarage(cx: number, cy: number, half: number, infoY: number) {
    const panel = this.menuPanel.getBoundingClientRect();
    let infoX = cx;
    // Beside the sidebar, the left arrow never goes under it.
    this.garage.style.setProperty('--min-left', panel.top > window.innerHeight * 0.4 ? '12px' : `${(panel.right + 12).toFixed(1)}px`);
    if (panel.top > window.innerHeight * 0.4) {
      const title = this.menuPanel.querySelector('h1')!.getBoundingClientRect().top;
      infoY = Math.max(cy, Math.min(infoY, title - this.garageInfo.offsetHeight - 10));
    } else {
      const halfW = this.garageInfo.offsetWidth / 2;
      infoX = Math.min(window.innerWidth - 12 - halfW, Math.max(infoX, panel.right + 12 + halfW));
    }
    const s = this.garage.style;
    s.setProperty('--info-x', `${infoX.toFixed(1)}px`);
    s.setProperty('--cx', `${cx.toFixed(1)}px`);
    s.setProperty('--cy', `${cy.toFixed(1)}px`);
    s.setProperty('--half', `${half.toFixed(1)}px`);
    s.setProperty('--info-y', `${infoY.toFixed(1)}px`);
  }

  /** The pilot card: name, and a badge with its first letters. */
  setPilot(text: string) {
    $('menu-pilot').textContent = text;
    const letters = text.replace(/[^A-Za-z0-9]/g, '');
    $('pilot-badge').textContent = (letters.match(/[A-Z0-9]/g)?.slice(0, 2).join('') || letters.slice(0, 2) || 'P').toUpperCase();
  }

  /** A line in the menu or game-over panel; null hides it. Always plain text (names are user input). */
  setLine(id: 'menu-challenge' | 'over-challenge' | 'over-rank', text: string | null) {
    const node = $(id);
    node.textContent = text ?? '';
    if (id !== 'over-rank') node.classList.toggle('hidden', !text);
  }

  setShield(on: boolean) {
    $('hud-shield').classList.toggle('hidden', !on);
  }

  setRocket(ratio: number) {
    const pct = Math.floor(ratio * 100);
    if (pct === this.last.rocket) return;
    this.last.rocket = pct;
    this.rocketFill.style.transform = `scaleX(${ratio})`;
    this.rocketVal.textContent = `${pct}%`;
  }

  /** Power-mode banner with a draining timer; `null` hides it. */
  setPower(power: PowerKind | null, timeRatio: number) {
    this.power.classList.toggle('hidden', !power);
    if (!power) return;
    const style = POWER_STYLE[power];
    this.power.style.setProperty('--power', style.color);
    $('power-name').textContent = style.name;
    $('power-sub').textContent = style.sub;
    this.powerFill.style.transform = `scaleX(${timeRatio})`;
  }

  zoneBanner(name: string) {
    this.zone.textContent = name;
    this.zone.classList.remove('show');
    void this.zone.offsetWidth;
    this.zone.classList.add('show');
  }

  setMuted(muted: boolean) {
    $('btn-mute').classList.toggle('muted', muted);
    $('mute-label').textContent = muted ? 'SOUND OFF' : 'SOUND ON';
  }

  /** Streak meter under the score; hidden when no streak is running. */
  updateCombo(count: number, multiplier: number, score: number, timeRatio: number) {
    if (count !== this.last.comboCount) {
      this.combo.classList.toggle('hidden', count === 0);
      if (count > this.last.comboCount && count > 0) {
        this.combo.classList.remove('bump');
        void this.combo.offsetWidth; // restart the CSS animation
        this.combo.classList.add('bump');
      }
      this.last.comboCount = count;
      this.comboMult.textContent = `×${multiplier}`;
      this.comboCount.textContent = String(count);
      this.comboScore.textContent = `+${score.toLocaleString()}`;
    }
    if (count > 0) this.comboFill.style.transform = `scaleX(${timeRatio})`;
  }

  show(screen: Screen) {
    // Remind touch players how the gestures work for the first few seconds of a run.
    const controls = document.querySelector('.touch-controls')!;
    controls.classList.toggle('hint', screen === 'playing' && this.screenShown !== 'paused');
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => controls.classList.remove('hint'), 5000);
    this.screenShown = screen;
    this.screens.menu.classList.toggle('hidden', screen !== 'menu');
    this.screens.paused.classList.toggle('hidden', screen !== 'paused');
    this.screens.over.classList.toggle('hidden', screen !== 'over');
    this.hud.classList.toggle('hidden', screen === 'menu');
    this.hud.classList.toggle('dimmed', screen !== 'playing');
    if (screen !== 'playing') this.popups.replaceChildren();
    if (screen === 'menu') {
      this.updateCombo(0, 1, 0, 0);
      this.setPower(null, 0);
      this.zone.classList.remove('show');
    }
  }

  setMenuStats(best: number, bestDistance: number) {
    $('menu-best').textContent = best > 0 ? best.toLocaleString() : '—';
    $('menu-dist').textContent = bestDistance > 0 ? `${bestDistance.toLocaleString()} m` : '—';
  }

  update(distance: number, score: number, air: number, boosting: boolean) {
    const d = Math.floor(distance);
    if (d !== this.last.dist) this.dist.textContent = String((this.last.dist = d));
    if (score !== this.last.score) this.score.textContent = (this.last.score = score).toLocaleString();
    const a = Math.round(air);
    if (a !== this.last.air) {
      this.last.air = a;
      this.airFill.style.transform = `scaleX(${a / AIR.capacity})`;
      this.airVal.textContent = `${a} L`;
    }
    const low = air / AIR.capacity < AIR.lowRatio;
    if (low !== this.last.low) this.airBox.classList.toggle('low', (this.last.low = low));
    if (boosting !== this.last.boost) this.hud.classList.toggle('boosting', (this.last.boost = boosting));
  }

  popup(text: string, points = 0, tone: PopupTone = 'good', multiplier = 1) {
    const el = document.createElement('div');
    el.className = `popup ${tone}`;
    el.innerHTML = `<span></span>${points ? `<b>+${points}</b>` : ''}${multiplier > 1 ? `<i>×${multiplier}</i>` : ''}`;
    el.querySelector('span')!.textContent = text;
    el.addEventListener('animationend', () => el.remove());
    this.popups.append(el);
    while (this.popups.children.length > 4) this.popups.firstElementChild!.remove();
  }

  showGameOver(run: RunSummary) {
    $('over-reason').textContent = run.reason;
    $('over-score').textContent = run.score.toLocaleString();
    $('over-dist').textContent = `${Math.floor(run.distance).toLocaleString()} m`;
    $('over-time').textContent = formatTime(run.time);
    $('over-best').textContent = run.best.toLocaleString();
    $('over-record').classList.toggle('hidden', !run.isRecord);
    this.show('over');
  }
}
