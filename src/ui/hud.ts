import { AIR, type ItemKind, type PowerKind } from '../config';
import { ITEM_STYLE, itemIconURL } from '../entities/pickups';
import type { CarDesign } from '../entities/carModel';
import { PAINTS, WHEELS, factorySwatch } from '../entities/finishes';
import { IS_TOUCH, type TouchAction } from '../systems/input';

export type Screen = 'menu' | 'playing' | 'paused' | 'over' | 'photo';
export type FinishKind = 'paint' | 'wheels';

/** What the paint shop shows: the car on display, its current picks and how far the pilot has driven. */
export interface ShopState {
  design: CarDesign;
  paint: string;
  wheels: string;
  km: number;
}

export interface RunSummary {
  score: number;
  distance: number;
  time: number;
  best: number;
  isRecord: boolean;
  reason: string;
}

export type PopupTone = 'good' | 'great' | 'warn';

/** A finish the paint shop's cursor landed on. */
export interface ShopPick {
  kind: FinishKind;
  id: string;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const POWER_STYLE: Record<PowerKind, { name: string; sub: string; color: string }> = {
  starman: { name: '★ STARMAN', sub: 'INVINCIBLE · ×2 SCORE', color: '#ffd23f' },
  rocket: { name: 'ROCKET MODE', sub: 'INFINITE AIR · INVINCIBLE · ×3 SCORE', color: '#ff9a3d' },
  ludicrous: { name: 'LUDICROUS', sub: 'HYPER SPEED · INVINCIBLE · ×2 SCORE', color: '#ff3fa8' },
};

const km = (v: number) => (v < 10 ? v.toFixed(1) : Math.floor(v).toLocaleString());

/** Keys and controller buttons for one prompt in the bar along the bottom. */
interface Prompt {
  keys: string[];
  pad: string[];
  label: string;
}

const prompt = (keys: string[], pad: string[], label: string): Prompt => ({ keys, pad, label });
const SELECT = prompt(['↑', '↓'], ['dpad'], 'Select');
const CONFIRM = prompt(['Enter'], ['A'], 'Confirm');

/** What the prompt bar offers on each screen (and over the paint shop and how-to card). */
const PROMPTS: Record<Screen | 'shop' | 'howto', Prompt[]> = {
  menu: [SELECT, CONFIRM, prompt(['←', '→'], ['dpad-h'], 'Car'), prompt(['M'], ['View'], 'Sound')],
  shop: [prompt(['↑', '↓'], ['dpad'], 'Body / wheels'), prompt(['←', '→'], ['dpad-h'], 'Finish'), prompt(['Esc'], ['B'], 'Back')],
  paused: [SELECT, CONFIRM, prompt(['Esc'], ['Start'], 'Resume')],
  over: [SELECT, CONFIRM, prompt(['C'], ['Y'], 'Photo'), prompt(['Esc'], ['B'], 'Menu')],
  howto: [prompt(['Esc'], ['B'], 'Close')],
  playing: [],
  photo: [],
};

/** A d-pad with its up / down arms lit, or (`h`) its left / right arms. */
const DPAD_SVG = (h: boolean) =>
  `<svg viewBox="0 0 24 24"><path d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7z" opacity=".4"/><path d="${h ? 'M2 9h7v6H2zM15 9h7v6h-7z' : 'M9 2h6v7H9zM9 15h6v7H9z'}"/></svg>`;

/** A keycap (`k`) or a controller button (`p`) for the prompt bar. */
function keycap(label: string, kind: 'k' | 'p') {
  const el = document.createElement('kbd');
  el.className = kind;
  if (kind === 'p' && label.startsWith('dpad')) {
    el.classList.add('dpad');
    el.innerHTML = DPAD_SVG(label === 'dpad-h');
  } else {
    if (kind === 'p' && /^[ABXY]$/.test(label)) el.classList.add('pad-glyph', label.toLowerCase());
    el.textContent = label;
  }
  return el;
}

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
  /** The screen photo mode was opened from, so returning to it keeps its highlight. */
  private photoFrom: Screen = 'paused';
  private hintTimer = 0;
  /** The home screen's sheet: the garage frames the car in the space it leaves. */
  private readonly menuPanel = document.querySelector<HTMLElement>('#menu .sheet')!;
  private readonly dist = $('hud-dist');
  private readonly score = $('hud-score');
  private readonly airFill = $('hud-air-fill');
  private readonly airVal = $('hud-air-val');
  private readonly airBox = $('hud-air');
  private readonly boostButton = document.querySelector<HTMLElement>('.touch-btn.boost')!;
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
  private readonly paintShop = $('paintshop');
  private readonly menuHome = document.querySelector<HTMLElement>('.menu-home')!;
  private readonly howTo = $('howto');
  private readonly prompts = $('prompts');
  private promptsShown = '';
  /** The highlighted item of the list menu on show. */
  private focusIndex = 0;
  /** Paint shop: which row the arrows work on, the cursor in each row, and what was last drawn. */
  private shopRow = 0;
  private readonly shopCursor = [0, 0];
  private shopState: ShopState | null = null;
  private readonly photo = $('photo');
  private readonly toastEl = $('toast');
  private toastTimer = 0;
  private last = { dist: -1, score: -1, air: -1, low: false, boost: false, comboCount: -1, rocket: -1 };

  constructor(handlers: {
    play(): void;
    resume(): void;
    menu(): void;
    pause(): void;
    mute(): void;
    touch(action: TouchAction, down: boolean): void;
    car(step: -1 | 1): void;
    callsign(): void;
    share(): void;
    paint(): void;
    pick(kind: FinishKind, id: string): void;
    howTo(open: boolean): void;
    photo(): void;
    photoSave(): void;
    photoBack(): void;
    haptics(): void;
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
    bind('btn-paint', handlers.paint);
    bind('btn-paint-close', handlers.paint);
    bind('btn-howto', () => handlers.howTo(true));
    bind('btn-pause-howto', () => handlers.howTo(true));
    bind('btn-howto-close', () => handlers.howTo(false));
    bind('btn-sound', handlers.mute);
    this.howTo.addEventListener('click', (e) => {
      if (e.target === this.howTo) handlers.howTo(false);
    });
    bind('btn-photo', handlers.photo);
    bind('btn-over-photo', handlers.photo);
    bind('btn-photo-save', handlers.photoSave);
    bind('btn-photo-back', handlers.photoBack);
    bind('btn-haptics', handlers.haptics);
    for (const kind of ['paint', 'wheels'] as const) {
      const row = kind === 'paint' ? 0 : 1;
      const list = kind === 'paint' ? PAINTS : WHEELS;
      $(kind === 'paint' ? 'paint-swatches' : 'wheel-swatches').addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
        if (!btn) return;
        this.shopRow = row;
        this.shopCursor[row] = list.findIndex((item) => item.id === btn.dataset.id);
        handlers.pick(kind, btn.dataset.id!);
      });
    }
    // A mouse moves the list highlight with it, so the keyboard carries on from where the pointer is.
    for (const list of document.querySelectorAll<HTMLElement>('.menu-list')) {
      list.addEventListener('pointerover', (e) => {
        if (e.pointerType !== 'mouse') return;
        const item = (e.target as HTMLElement).closest<HTMLElement>('.menu-item');
        const items = this.menuItems();
        if (item && items.includes(item)) this.setFocus(items.indexOf(item));
      });
    }

    // On-screen buttons capture their own pointer, so boost and item use work alongside road gestures.
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
    }
  }

  /** Directional edge feedback for lane changes, jumps and slams. */
  laneFlash(side: 'left' | 'right' | 'up' | 'down') {
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

  /** The garage caption under the car: its name, a one-line description and its place in the line-up. */
  setCar(name: string, tagline: string, index: number, count: number, step = 1) {
    $('car-name').textContent = name;
    $('car-tagline').textContent = tagline;
    const pips = $('car-pips');
    if (pips.childElementCount !== count) pips.replaceChildren(...Array.from({ length: count }, () => document.createElement('i')));
    [...pips.children].forEach((pip, i) => pip.classList.toggle('on', i === index));
    this.garageInfo.style.setProperty('--swap-from', `${step * 16}px`);
    this.garageInfo.classList.remove('swap');
    void this.garageInfo.offsetWidth;
    this.garageInfo.classList.add('swap');
  }

  /** Left edge (px) of the screen space the sheet leaves free for the car: 0 when the sheet sits below it. */
  menuSpaceLeft() {
    const r = this.menuPanel.getBoundingClientRect();
    return r.top > window.innerHeight * 0.4 ? 0 : r.right;
  }

  /**
   * Frames the garage around the car on screen (CSS pixels): the arrows sit `half` either side of
   * the car's centre (cx, cy), and the caption sits below it at `infoY`. The caption never covers the
   * sheet: kept above it when the sheet is below the car (portrait phones), and kept right of it when
   * it is beside it.
   */
  placeGarage(cx: number, cy: number, half: number, infoY: number) {
    const panel = this.menuPanel.getBoundingClientRect();
    let infoX = cx;
    // Beside the sidebar, the left arrow never goes under it.
    this.garage.style.setProperty('--min-left', panel.top > window.innerHeight * 0.4 ? '12px' : `${(panel.right + 12).toFixed(1)}px`);
    if (panel.top > window.innerHeight * 0.4) {
      infoY = Math.max(cy, Math.min(infoY, panel.top - this.garageInfo.offsetHeight - 14));
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
    $('mute-label').textContent = muted ? 'Sound off' : 'Sound on';
    this.setToggle('btn-sound', 'sound-state', !muted);
  }

  private setToggle(id: string, stateId: string, on: boolean) {
    const btn = $(id);
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
    $(stateId).textContent = on ? 'On' : 'Off';
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

  // ---------- list menus ----------

  /** The items of the list menu on show: none while the paint shop or the how-to card covers it. */
  private menuItems(): HTMLElement[] {
    if (this.howToOpen) return [];
    const root =
      this.screenShown === 'menu' ? (this.paintShopOpen ? null : this.menuHome)
      : this.screenShown === 'paused' ? this.screens.paused
      : this.screenShown === 'over' ? this.screens.over
      : null;
    return root ? [...root.querySelectorAll<HTMLElement>('.menu-item')] : [];
  }

  private setFocus(index: number) {
    const items = this.menuItems();
    if (!items.length) return;
    this.focusIndex = Math.max(0, Math.min(items.length - 1, index));
    items.forEach((item, i) => item.classList.toggle('focus', i === this.focusIndex));
  }

  /** Moves the highlight up (-1) or down (1), wrapping round; false when there is no list on show. */
  navigate(step: -1 | 1) {
    const n = this.menuItems().length;
    if (!n) return false;
    this.setFocus((this.focusIndex + step + n) % n);
    return true;
  }

  /** Picks the highlighted item, as a click would. */
  activate() {
    this.menuItems()[this.focusIndex]?.click();
  }

  // ---------- how to play ----------

  get howToOpen() {
    return !this.howTo.classList.contains('hidden');
  }

  setHowTo(open: boolean) {
    this.howTo.classList.toggle('hidden', !open);
    this.refreshPrompts();
  }

  // ---------- paint shop ----------

  get paintShopOpen() {
    return !this.paintShop.classList.contains('hidden');
  }

  /** The shop takes the home menu's place in the sheet; closing it brings the menu back. */
  setPaintShop(open: boolean) {
    if (open === this.paintShopOpen) return;
    this.paintShop.classList.toggle('hidden', !open);
    this.menuHome.classList.toggle('hidden', open);
    if (open) {
      this.shopRow = 0;
      this.shopState = null;
    } else {
      this.setFocus(this.focusIndex);
    }
    this.refreshPrompts();
  }

  /** Switches the row the arrows work on: body (0) or wheels (1). */
  shopRowStep(step: -1 | 1) {
    const row = Math.max(0, Math.min(1, this.shopRow + step));
    if (row === this.shopRow || !this.shopState) return false;
    this.shopRow = row;
    this.renderPaintShop(this.shopState);
    return true;
  }

  /** Moves the cursor along the active row; returns the finish it lands on (locked ones included). */
  shopStep(step: -1 | 1): ShopPick | null {
    const items = this.shopRow === 0 ? PAINTS : WHEELS;
    const i = Math.max(0, Math.min(items.length - 1, this.shopCursor[this.shopRow] + step));
    if (i === this.shopCursor[this.shopRow]) return null;
    this.shopCursor[this.shopRow] = i;
    return { kind: this.shopRow === 0 ? 'paint' : 'wheels', id: items[i].id };
  }

  /** Redraws the swatches for the car on show; locked ones carry a padlock. `message` replaces the status line. */
  renderPaintShop(state: ShopState, message?: string) {
    // A fresh shop, or another car, puts the cursors back on the finishes in use.
    if (this.shopState?.design !== state.design) {
      this.shopCursor[0] = PAINTS.findIndex((p) => p.id === state.paint);
      this.shopCursor[1] = WHEELS.findIndex((w) => w.id === state.wheels);
    }
    this.shopState = state;
    $('paint-car').textContent = state.design.name;
    $('paint-total').textContent = `${km(state.km)} km`;
    const fill = (row: number, id: string, items: typeof PAINTS | typeof WHEELS, picked: string) => {
      const section = document.querySelector<HTMLElement>(`.shop-row[data-row="${row}"]`)!;
      section.classList.toggle('active', row === this.shopRow);
      $(id).replaceChildren(
        ...items.map((item, i) => {
          const b = document.createElement('button');
          const locked = state.km < item.km;
          b.className = 'swatch';
          b.classList.toggle('factory', !item.finish);
          b.classList.toggle('locked', locked);
          b.classList.toggle('selected', item.id === picked);
          b.classList.toggle('cursor', i === this.shopCursor[row]);
          b.dataset.id = item.id;
          b.tabIndex = -1;
          b.style.setProperty('--sw', item.finish ? item.swatch : factorySwatch(state.design, row === 1));
          const label = locked ? `${item.name} (drive ${item.km} km to unlock)` : item.name;
          b.title = label;
          b.setAttribute('aria-label', label);
          return b;
        }),
      );
      return items.find((x) => x.id === picked)!;
    };
    $('paint-name').textContent = fill(0, 'paint-swatches', PAINTS, state.paint).name;
    $('wheel-name').textContent = fill(1, 'wheel-swatches', WHEELS, state.wheels).name;

    const status = $('paint-status');
    if (message) {
      status.textContent = message;
      return;
    }
    const all = [...PAINTS, ...WHEELS];
    const next = all.filter((i) => i.km > state.km).sort((a, b) => a.km - b.km)[0];
    const bold = (text: string) => Object.assign(document.createElement('b'), { textContent: text });
    status.replaceChildren(bold(`${this.unlocked(state.km)} of ${all.length}`), ' finishes unlocked. ');
    if (next) status.append('Next: ', bold(next.name), ` at ${next.km} km.`);
    else status.append('Every finish is yours.');
  }

  private unlocked(kmDriven: number) {
    return [...PAINTS, ...WHEELS].filter((i) => kmDriven >= i.km).length;
  }

  // ---------- settings, controller, photo ----------

  setHaptics(on: boolean) {
    this.setToggle('btn-haptics', 'haptics-state', on);
  }

  /** Switches the prompts and hints to controller buttons while a pad is in use. */
  setPad(on: boolean) {
    document.documentElement.classList.toggle('pad', on);
  }

  /** The button prompts along the bottom, for the screen (or card) on show. */
  private refreshPrompts() {
    const name = this.howToOpen ? 'howto' : this.screenShown === 'menu' && this.paintShopOpen ? 'shop' : this.screenShown;
    if (name === this.promptsShown) return;
    this.promptsShown = name;
    this.prompts.replaceChildren(
      ...PROMPTS[name].map((p) => {
        const el = document.createElement('span');
        el.className = 'prompt';
        const label = document.createElement('span');
        label.textContent = p.label;
        el.append(...p.keys.map((k) => keycap(k, 'k')), ...p.pad.map((k) => keycap(k, 'p')), label);
        return el;
      }),
    );
  }

  toast(text: string, ms = 2200) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  /** Hides the photo bar for the capture, then plays the shutter flash. */
  photoSaving(on: boolean) {
    this.photo.classList.toggle('saving', on);
    if (on) return;
    const flash = $('photo-flash');
    flash.classList.remove('go');
    void flash.offsetWidth;
    flash.classList.add('go');
  }

  show(screen: Screen) {
    // Remind touch players how the gestures work for the first few seconds of a run.
    const controls = document.querySelector('.touch-controls')!;
    controls.classList.toggle('hint', screen === 'playing' && this.screenShown !== 'paused');
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => controls.classList.remove('hint'), 5000);
    const from = this.screenShown;
    this.screenShown = screen;
    this.screens.menu.classList.toggle('hidden', screen !== 'menu');
    this.screens.paused.classList.toggle('hidden', screen !== 'paused');
    this.screens.over.classList.toggle('hidden', screen !== 'over');
    // The pause and game-over sheets carry the run's figures, so the HUD only shows while driving.
    this.hud.classList.toggle('hidden', screen !== 'playing');
    this.photo.classList.toggle('hidden', screen !== 'photo');
    document.body.classList.toggle('photo-mode', screen === 'photo');
    if (screen !== 'menu') this.setPaintShop(false);
    this.howTo.classList.add('hidden');
    // A screen opens on its first item (PLAY, RESUME, RETRY); coming back from photo mode keeps the place.
    if (screen === 'photo') this.photoFrom = from;
    else if (screen !== from && !(from === 'photo' && screen === this.photoFrom)) this.focusIndex = 0;
    this.setFocus(this.focusIndex);
    this.refreshPrompts();
    if (screen !== 'playing') this.popups.replaceChildren();
    if (screen === 'menu') {
      this.updateCombo(0, 1, 0, 0);
      this.setPower(null, 0);
      this.zone.classList.remove('show');
    }
  }

  /** The records under the pilot's name, and how much of the paint shop is open. */
  setMenuStats(best: number, bestDistance: number, kmDriven: number) {
    const figure = (id: string, value: string | null, unit = '') => {
      const el = $(id);
      el.textContent = value ?? '—';
      if (value && unit) el.append(Object.assign(document.createElement('small'), { textContent: unit }));
    };
    figure('menu-best', best > 0 ? best.toLocaleString() : null);
    figure('menu-dist', bestDistance > 0 ? bestDistance.toLocaleString() : null, 'm');
    figure('menu-driven', kmDriven > 0 ? km(kmDriven) : null, 'km');
    $('menu-unlocked').textContent = `${this.unlocked(kmDriven)} / ${PAINTS.length + WHEELS.length}`;
  }

  /** The pause sheet's line about the run so far. */
  setPauseLine(text: string) {
    $('pause-run').textContent = text;
  }

  update(distance: number, score: number, air: number, boosting: boolean) {
    const d = Math.floor(distance);
    if (d !== this.last.dist) this.dist.textContent = String((this.last.dist = d));
    if (score !== this.last.score) this.score.textContent = (this.last.score = score).toLocaleString();
    const a = Math.round(air);
    this.boostButton.classList.toggle('empty', a <= 0);
    if (a !== this.last.air) {
      this.last.air = a;
      this.airFill.style.transform = `scaleX(${a / AIR.capacity})`;
      this.airVal.textContent = `${a} L`;
    }
    const low = air / AIR.capacity < AIR.lowRatio;
    if (low !== this.last.low) this.airBox.classList.toggle('low', (this.last.low = low));
    if (boosting !== this.last.boost) this.hud.classList.toggle('boosting', (this.last.boost = boosting));
    this.boostButton.classList.toggle('held', boosting);
  }

  setAdminMode(enabled: boolean) {
    this.hud.classList.toggle('admin-mode', enabled);
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
