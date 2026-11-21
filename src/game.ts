import * as THREE from 'three';
import { Sfx } from './audio/sfx';
import {
  AIR,
  PICKUPS,
  POINTS,
  ROCKET_FILL,
  SETTINGS_KEY,
  SHOCKWAVE,
  SMASH_POINTS,
  SPEED_CURVE,
  STORAGE_KEY,
  SUN_DIR,
  TRAFFIC,
  type PowerKind,
} from './config';
import { ITEM_STYLE, Pickups, type PickupKind } from './entities/pickups';
import { Player, type PlayerEvent } from './entities/player';
import { Traffic, warmTrafficModels, type TrafficEvent, type Vehicle } from './entities/traffic';
import { Effects } from './fx/effects';
import { Post } from './fx/post';
import { Weather } from './fx/weather';
import { createLeaderboard, type Pilot, type RunReport } from './online';
import { readChallenge, shareRun } from './online/share';
import { loadJSON, saveJSON } from './storage';
import { Combo } from './systems/combo';
import { IS_TOUCH, Input } from './systems/input';
import type { CarId } from './entities/carModel';
import { CARS, DEFAULT_CAR, carDesign, isCarId } from './entities/cars';
import { PAINTS, WHEELS, paintItem, wheelItem } from './entities/finishes';
import { Haptics } from './systems/haptics';
import { Powers, type PowerEvent } from './systems/powers';
import { Hud, type FinishKind, type PopupTone } from './ui/hud';
import { CallsignDialog } from './ui/onlinePanels';
import { clamp, damp, lerp, sampleCurve } from './util/math';
import { Backdrop } from './world/backdrop';
import { BEND, installWorldBend } from './world/bend';
import { Environment } from './world/environment';
import { Road } from './world/road';
import { Scatter } from './world/scatter';
import { Structures } from './world/structures';
import { ZoneField } from './world/zoneField';
import { Palette, paletteAt, zoneAt } from './world/zones';

type State = 'menu' | 'playing' | 'paused' | 'crashing' | 'over' | 'photo';

interface Settings {
  muted: boolean;
  car: CarId;
  /** Set once the player has picked a pilot name (until then the menu asks for one). */
  named?: boolean;
  haptics: boolean;
  /** Paint shop picks per car. */
  finishes: Partial<Record<CarId, { paint: string; wheels: string }>>;
}

/** Photo mode camera limits: distance from the car (m) and elevation (radians). */
const PHOTO_DIST: readonly [number, number] = [2.6, 30];
const PHOTO_PITCH: readonly [number, number] = [-0.08, 1.45];

/** Screen room (px) a garage arrow takes beside the car, its gap and the screen margin included. */
const GARAGE_ARROW_SPACE = 84;

const CRASH_DURATION = 1.1;
const MAX_DT = 1 / 20;
const BIG_STREAK = 5;
const ORB_CHAIN_WINDOW = 0.6;

/** Adaptive resolution: frame-time windows (s) and the render scale range it moves within. */
const RES_WINDOW = 2;
const RES_MIN = 0.6;
const SLOW_FRAME = 1 / 48;
const FAST_FRAME = 1 / 58;

const POWER_GLOW: Record<PowerKind, number> = { starman: 0xffd23f, rocket: 0xff7a2a, ludicrous: 0xff3fa8 };

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1500);
  private readonly env: Environment;
  private readonly field = new ZoneField();
  private readonly post: Post;
  private readonly road: Road;
  private readonly scatter: Scatter;
  private readonly structures: Structures;
  private readonly backdrop: Backdrop;
  private readonly weather: Weather;
  private readonly traffic: Traffic;
  private readonly pickups: Pickups;
  private readonly effects: Effects;
  private readonly player = new Player();
  private readonly input = new Input();
  private readonly combo = new Combo();
  private readonly powers = new Powers();
  private readonly palette = new Palette();
  private readonly hud: Hud;
  private readonly sfx: Sfx;
  private readonly board = createLeaderboard();
  private readonly callsignDialog: CallsignDialog;
  private readonly challenge = readChallenge();
  private pilot: Pilot | null = null;
  /** Server run id for the current run; resolves to null if the run could not be opened. */
  private runTicket: Promise<string | null> = Promise.resolve(null);

  private state: State = 'menu';
  /** Admin free-drive mode: no traffic collision and no riding on vehicle roofs. */
  private adminMode = false;
  private stateT = 0;
  private speed = 0;
  private distance = 0;
  private distanceScore = 0;
  private bonus = 0;
  private runTime = 0;
  private maxStreak = 0;
  private zoneIndex = 0;
  private orbChain = 0;
  private lastOrbT = -1;
  private lowAirWarned = false;
  /** `totalDistance` is lifetime metres driven, which unlocks paint shop finishes. */
  private records = loadJSON(STORAGE_KEY, { bestScore: 0, bestDistance: 0, totalDistance: 0 });
  private settings = loadJSON<Settings>(SETTINGS_KEY, { muted: false, car: DEFAULT_CAR, haptics: true, finishes: {} });
  private readonly haptics: Haptics;

  // Photo mode: where to return to, and the orbit camera around the car.
  private photoFrom: State = 'paused';
  private photoYaw = 0;
  private photoPitch = 0.3;
  private photoDist = 8;
  private readonly photoPointers = new Map<number, { x: number; y: number }>();
  private photoPinch = 0;
  private photoBusy = false;
  private lastFrame = performance.now();
  private readonly maxPixelRatio = Math.min(window.devicePixelRatio, IS_TOUCH ? 1.5 : 1.75);
  /** Render scale against maxPixelRatio, lowered when frames run slow and raised again when they recover. */
  private resScale = 1;
  private resTime = 0;
  private resFrames = 0;
  private resFastWindows = 0;

  private readonly camPos = new THREE.Vector3(0, 3, 8);
  private readonly camLook = new THREE.Vector3(0, 1, -14);
  private readonly garagePoint = new THREE.Vector3();
  private camRoll = 0;
  /** 0 on landscape screens, 1 on tall portrait phones; blends the camera framing between them. */
  private portrait = 0;
  private lastPlayerX = 0;
  private menuAngle = 0.6;
  private shake = 0;
  private readonly trafficEvents: TrafficEvent[] = [];
  private readonly collected: PickupKind[] = [];
  private readonly glowColor = new THREE.Color();
  private readonly sweepColor = new THREE.Color();
  private readonly smokeTint = new THREE.Color();
  private readonly smokeSun = new THREE.Color();
  private readonly sunDir = new THREE.Vector3(...SUN_DIR).normalize();

  constructor(private readonly canvas: HTMLCanvasElement) {
    installWorldBend();
    // Anti-aliasing happens in the post pipeline's multisampled render target instead.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.maxPixelRatio);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.env = new Environment(this.scene, this.renderer, this.field);
    this.post = new Post(this.renderer, this.scene, this.camera);
    this.road = new Road(this.scene, this.renderer);
    this.scatter = new Scatter(this.scene, this.field);
    this.structures = new Structures(this.scene);
    this.backdrop = new Backdrop(this.scene);
    this.weather = new Weather(this.scene);
    this.traffic = new Traffic(this.scene);
    this.pickups = new Pickups(this.scene);
    this.effects = new Effects(this.scene);
    this.scene.add(this.player.object);
    this.settings.finishes ??= {};
    this.haptics = new Haptics(this.settings.haptics !== false);

    this.sfx = new Sfx(this.settings.muted);
    this.input.onGesture = () => this.sfx.unlock();
    this.input.attachGestures(canvas);

    this.hud = new Hud({
      play: () => this.start(),
      resume: () => this.setPaused(false),
      menu: () => this.toMenu(),
      pause: () => this.setPaused(true),
      mute: () => this.toggleMute(),
      touch: (action, down) => this.input.touch(action, down),
      car: (step) => this.cycleCar(step),
      callsign: () => this.pilot && this.callsignDialog.open(this.pilot.callsign),
      share: () => void this.share(),
      paint: () => this.togglePaintShop(),
      pick: (kind, id) => this.pickFinish(kind, id),
      howTo: (open) => this.setHowTo(open),
      photo: () => this.enterPhoto(),
      photoSave: () => void this.savePhoto(),
      photoBack: () => this.exitPhoto(),
      haptics: () => this.toggleHaptics(),
    });
    this.hud.setMuted(this.settings.muted);
    this.hud.setHaptics(this.haptics.enabled);
    this.input.onGamepad = (on) => {
      this.hud.toast(on ? 'Controller connected' : 'Controller disconnected');
      if (on) this.haptics.buzz('ui');
    };
    this.input.onDevice = (pad) => this.hud.setPad(pad);
    this.attachPhotoControls(canvas);
    this.selectCar(isCarId(this.settings.car) ? this.settings.car : DEFAULT_CAR);

    this.callsignDialog = new CallsignDialog(this.board, (callsign) => {
      if (this.pilot) this.pilot.callsign = callsign;
      this.hud.setPilot(callsign);
      this.settings.named = true;
      saveJSON(SETTINGS_KEY, this.settings);
    });
    this.board
      .init()
      .then((pilot) => {
        this.pilot = pilot;
        this.hud.setPilot(pilot.callsign);
        // First visit: ask for a pilot name before the first run.
        if (!this.settings.named && this.state === 'menu') this.callsignDialog.open(pilot.callsign, true);
      })
      .catch(() => this.hud.setPilot('Offline'));
    if (this.challenge) {
      const c = this.challenge;
      this.hud.setLine(
        'menu-challenge',
        `${c.name} challenges you: ${c.distance.toLocaleString()} m (${c.score.toLocaleString()} pts). Catch them if you can!`,
      );
    }

    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.setPaused(true);
    });
    this.resize();
    this.toMenu();

    if (import.meta.env.DEV) Object.assign(window, { __game: this });
  }

  /**
   * Gets the game ready before the first frame: puts one of every traffic vehicle and pickup in view,
   * compiles their shaders and renders a frame through the post pipeline, so the first bus or item
   * doesn't stall a frame mid-run.
   */
  async prepare() {
    const warm = warmTrafficModels();
    this.pickups.warmUp();
    this.player.setShield(true);
    this.scene.add(warm);
    this.camera.position.set(0, 4, 10);
    this.camera.lookAt(0, 1, -12);
    this.camera.updateMatrixWorld();
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch {
      this.renderer.compile(this.scene, this.camera);
    }
    this.renderFrame();
    this.scene.remove(warm);
    this.toMenu();
  }

  run() {
    const frame = (now: number) => {
      const raw = (now - this.lastFrame) / 1000;
      const dt = clamp(raw, 0, MAX_DT);
      this.lastFrame = now;
      this.adaptResolution(raw);
      this.update(dt);
      this.renderFrame();
      this.input.endFrame();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /**
   * Keeps the frame rate up on slower GPUs by rendering fewer pixels: drops the resolution a step when a
   * two-second window averages under ~48 fps, and creeps back up after two windows at a full 60.
   */
  private adaptResolution(frame: number) {
    if (frame > 0.25 || document.hidden) return; // a stall or a background tab says nothing about the GPU
    this.resTime += frame;
    this.resFrames++;
    if (this.resTime < RES_WINDOW) return;
    const avg = this.resTime / this.resFrames;
    this.resTime = this.resFrames = 0;
    let next = this.resScale;
    if (avg > SLOW_FRAME) {
      next = Math.max(RES_MIN, this.resScale - 0.15);
      this.resFastWindows = 0;
    } else if (avg < FAST_FRAME && ++this.resFastWindows >= 2) {
      next = Math.min(1, this.resScale + 0.1);
      this.resFastWindows = 0;
    }
    if (Math.abs(next - this.resScale) < 1e-3) return;
    this.resScale = next;
    this.renderer.setPixelRatio(this.maxPixelRatio * next);
    this.resize();
  }

  renderFrame() {
    this.post.render();
  }

  /** Snapshot for debugging and automated play-testing. */
  info() {
    return {
      state: this.state,
      distance: Math.round(this.distance),
      speed: +this.speed.toFixed(1),
      score: this.score,
      air: Math.round(this.player.air),
      y: +this.player.y.toFixed(2),
      lane: this.player.lane,
      vehicles: this.traffic.vehicles.length,
      streak: this.combo.count,
      power: this.powers.power,
      item: this.powers.item,
      shield: this.powers.shield,
      rocket: +this.powers.rocketMeter.toFixed(2),
      adminMode: this.adminMode,
      zone: zoneAt(this.distance).zone.name,
    };
  }

  private get score() {
    return Math.floor(this.distanceScore) + this.bonus;
  }

  private resetRun(seed: number) {
    this.player.reset();
    this.traffic.reset(seed);
    this.pickups.reset(seed);
    this.road.reset();
    this.structures.reset();
    this.effects.reset();
    this.combo.reset();
    this.powers.reset();
    this.distance = this.distanceScore = this.bonus = this.runTime = this.maxStreak = 0;
    this.shake = 0;
    this.zoneIndex = 0;
    this.orbChain = 0;
    this.lastOrbT = -1;
    this.lowAirWarned = false;
    this.canvas.classList.remove('crashed');
    this.applyZone();
    this.hud.setItem(null);
    this.hud.setShield(false);
    this.hud.setRocket(0);
    this.hud.setPower(null, 0);
  }

  private start() {
    const seed = (Math.random() * 2 ** 32) >>> 0;
    this.resetRun(seed);
    this.runTicket = this.pilot ? this.board.startRun(seed).catch(() => null) : Promise.resolve(null);
    this.speed = SPEED_CURVE[0][1];
    this.setState('playing');
    this.hud.show('playing');
    this.hud.popup('GO!', 0, 'great');
    this.sfx.go();
  }

  private toMenu() {
    this.resetRun(1);
    this.speed = 0;
    this.hud.setMenuStats(this.records.bestScore, this.records.bestDistance, this.km);
    this.setState('menu');
    this.hud.show('menu');
  }

  private setPaused(paused: boolean) {
    if (paused && this.state === 'playing') {
      const zone = zoneAt(this.distance).zone.name;
      this.hud.setPauseLine(`${zone} · ${Math.floor(this.distance).toLocaleString()} m · ${this.score.toLocaleString()} pts`);
      this.setState('paused');
      this.hud.show('paused');
    } else if (!paused && this.state === 'paused') {
      this.setState('playing');
      this.hud.show('playing');
    }
  }

  /** Garage: step through the cars on the menu. */
  private cycleCar(step: -1 | 1) {
    if (this.state !== 'menu') return;
    const i = CARS.findIndex((c) => c.id === this.settings.car);
    this.selectCar(CARS[(i + step + CARS.length) % CARS.length].id, step);
    this.sfx.click();
    this.haptics.buzz('ui');
  }

  private selectCar(id: CarId, step: -1 | 1 = 1) {
    this.player.setCar(id);
    this.settings.car = id;
    saveJSON(SETTINGS_KEY, this.settings);
    const design = carDesign(id);
    this.hud.setCar(design.name, design.tagline, CARS.findIndex((c) => c.id === id), CARS.length, step);
    this.applyFinish();
    if (this.hud.paintShopOpen) this.renderShop();
  }

  private toggleHaptics() {
    this.haptics.enabled = !this.haptics.enabled;
    this.settings.haptics = this.haptics.enabled;
    saveJSON(SETTINGS_KEY, this.settings);
    this.hud.setHaptics(this.haptics.enabled);
    this.haptics.buzz('ui');
    this.sfx.click();
  }

  // ---------- paint shop ----------

  private get km() {
    return this.records.totalDistance / 1000;
  }

  private finishOf(id: CarId) {
    const f = this.settings.finishes[id];
    // A pick that has since become locked (or no longer exists) falls back to factory.
    const paint = paintItem(f?.paint);
    const wheels = wheelItem(f?.wheels);
    return { paint: this.km >= paint.km ? paint : PAINTS[0], wheels: this.km >= wheels.km ? wheels : WHEELS[0] };
  }

  private applyFinish() {
    const { paint, wheels } = this.finishOf(this.settings.car);
    this.player.setFinish(paint.finish, wheels.finish);
  }

  private renderShop(message?: string) {
    const { paint, wheels } = this.finishOf(this.settings.car);
    this.hud.renderPaintShop({ design: carDesign(this.settings.car), paint: paint.id, wheels: wheels.id, km: this.km }, message);
  }

  private togglePaintShop() {
    if (this.state !== 'menu') return;
    const open = !this.hud.paintShopOpen;
    this.hud.setPaintShop(open);
    if (open) this.renderShop();
    this.sfx.click();
  }

  private pickFinish(kind: FinishKind, id: string) {
    const item = kind === 'paint' ? paintItem(id) : wheelItem(id);
    if (this.km < item.km) {
      const left = Math.max(0.1, item.km - this.km);
      this.renderShop(`Drive ${left < 10 ? left.toFixed(1) : Math.ceil(left)} km more to unlock ${item.name}.`);
      this.haptics.buzz('ui');
      return;
    }
    const car = this.settings.car;
    const current = this.finishOf(car);
    this.settings.finishes[car] = {
      paint: kind === 'paint' ? item.id : current.paint.id,
      wheels: kind === 'wheels' ? item.id : current.wheels.id,
    };
    saveJSON(SETTINGS_KEY, this.settings);
    this.applyFinish();
    this.renderShop();
    this.sfx.click();
    this.haptics.buzz('ui');
  }

  /** Arrows and controller in the paint shop: the cursor moves along a row, trying on each finish it reaches. */
  private stepFinish(step: -1 | 1) {
    const pick = this.hud.shopStep(step);
    if (pick) this.pickFinish(pick.kind, pick.id);
  }

  private setHowTo(open: boolean) {
    if (open && this.state !== 'menu' && this.state !== 'paused') return;
    if (open === this.hud.howToOpen) return;
    this.hud.setHowTo(open);
    this.sfx.click();
  }

  /** Arrow / d-pad step through a list menu, with a tick. */
  private navigate(step: -1 | 1) {
    if (!this.hud.navigate(step)) return;
    this.sfx.click();
    this.haptics.buzz('ui');
  }

  /** Lists finishes that a run's distance just unlocked. */
  private unlockedBetween(beforeKm: number, afterKm: number) {
    return [...PAINTS.map((p) => ({ ...p, kind: 'paint' })), ...WHEELS.map((w) => ({ ...w, kind: 'wheels' }))].filter(
      (i) => i.km > beforeKm && i.km <= afterKm,
    );
  }

  private toggleMute() {
    this.settings.muted = !this.settings.muted;
    saveJSON(SETTINGS_KEY, this.settings);
    this.sfx.setMuted(this.settings.muted);
    this.hud.setMuted(this.settings.muted);
  }

  private toggleAdminMode() {
    this.adminMode = !this.adminMode;
    this.hud.setAdminMode(this.adminMode);
    this.hud.toast(this.adminMode ? 'ADMIN FREE DRIVE ON · TRAFFIC PHASED' : 'ADMIN FREE DRIVE OFF', 3000);
    this.haptics.buzz('ui');
  }

  private setState(state: State) {
    this.state = state;
    this.stateT = 0;
    this.sfx.musicDucked(state === 'paused');
    if (state === 'menu') this.sfx.music(0);
    else if (state === 'crashing' || state === 'over') this.sfx.music('off');
  }

  private update(dt: number) {
    this.stateT += dt;
    const input = this.input;
    input.pollGamepad();
    this.haptics.pad = input.gamepad;
    this.haptics.phone = input.touchMode;
    if (this.callsignDialog.isOpen) {
      // The name dialog swallows game input.
      input.endFrame();
    }
    if (input.wasPressed('adminToggle')) {
      if (this.hud.paintShopOpen) this.togglePaintShop();
      this.toggleAdminMode();
    }
    if (input.wasPressed('mute')) this.toggleMute();
    if (this.hud.howToOpen) {
      if (input.wasPressed('back') || input.wasPressed('pause') || input.wasPressed('confirm')) this.setHowTo(false);
      input.endFrame();
    }
    // List menus: ↑ / ↓ (d-pad, stick) move the highlight and Enter / Space / A picks it.
    const confirm = input.wasPressed('confirm');
    const nav = input.wasPressed('menuUp') ? -1 : input.wasPressed('menuDown') ? 1 : 0;

    switch (this.state) {
      case 'menu':
        if (this.hud.paintShopOpen) {
          if (input.wasPressed('back') || input.wasPressed('paint') || confirm) this.togglePaintShop();
          else if (input.wasPressed('left')) this.stepFinish(-1);
          else if (input.wasPressed('right')) this.stepFinish(1);
          else if (nav && this.hud.shopRowStep(nav)) this.sfx.click();
        } else if (confirm) this.hud.activate();
        else if (nav) this.navigate(nav);
        else if (input.wasPressed('left')) this.cycleCar(-1);
        else if (input.wasPressed('right')) this.cycleCar(1);
        else if (input.wasPressed('paint')) this.togglePaintShop();
        break;
      case 'paused':
        if (input.wasPressed('photo')) this.enterPhoto();
        else if (input.wasPressed('pause')) this.setPaused(false);
        else if (confirm) this.hud.activate();
        else if (nav) this.navigate(nav);
        break;
      case 'photo':
        // The arrows steer the camera here, so only Esc / P / Start / B leave and Enter / A takes the shot.
        if (input.wasPressed('pause') || input.wasPressed('back')) this.exitPhoto();
        else if (input.wasPressed('confirm')) void this.savePhoto();
        break;
      case 'over':
        // A short grace period, so a key still held from the crash doesn't pick an item.
        if (this.stateT > 0.25) {
          if (input.wasPressed('photo')) this.enterPhoto();
          else if (confirm) this.hud.activate();
          else if (input.wasPressed('pause') || input.wasPressed('back')) this.toMenu();
          else if (nav) this.navigate(nav);
        }
        this.simulate(dt, false);
        break;
      case 'crashing':
        this.simulate(dt, false);
        if (this.stateT > CRASH_DURATION) this.gameOver();
        break;
      case 'playing':
        if (input.wasPressed('pause')) {
          this.setPaused(true);
          break;
        }
        if (input.wasPressed('left')) {
          this.player.steer(-1);
          this.hud.laneFlash('left');
        }
        if (input.wasPressed('right')) {
          this.player.steer(1);
          this.hud.laneFlash('right');
        }
        if (input.wasPressed('jump')) {
          this.player.pressJump();
          this.hud.laneFlash('up');
        }
        if (input.wasPressed('down')) {
          this.player.slam();
          this.hud.laneFlash('down');
        }
        if (input.wasPressed('item')) this.useItem();
        this.simulate(dt, true);
        // The soundtrack builds up on a streak or in a power mode.
        this.sfx.music(this.combo.multiplier >= 3 || this.powers.power ? 2 : 1);
        break;
    }

    const photo = this.state === 'photo';
    const frozen = this.state === 'menu' || this.state === 'paused' || photo;
    const p = this.player;
    this.updateCamera(dt);
    this.env.update(dt, frozen ? 0 : this.speed * dt, p.x, this.camera);
    // Photo mode stops the clock for the whole world: rain, birds and the grade's grain hold still.
    this.updateWorld(photo ? 0 : dt, frozen);
    if (!frozen) this.effects.update(dt, p, this.speed, this.powers.power, this.camera, this.canvas.height);
    this.sfx.update({
      active: this.state === 'playing',
      speed: this.speed,
      boosting: p.boosting || this.powers.power !== null,
      hovering: p.hovering,
    });
  }

  private simulate(dt: number, live: boolean) {
    const p = this.player;
    const powers = this.powers;
    const baseSpeed = sampleCurve(SPEED_CURVE, this.distance);
    const trafficSpeed = baseSpeed * TRAFFIC.speedRatio;

    if (live) {
      this.speed = damp(this.speed, baseSpeed * powers.speedMult(p.boosting), 3, dt);
      this.distance += this.speed * dt;
      this.distanceScore += this.speed * dt * POINTS.perMeter * powers.scoreMult;
      this.runTime += dt;
    } else {
      this.speed = damp(this.speed, 0, 2.2, dt);
    }

    const difficulty = clamp(this.distance / TRAFFIC.difficultyDistance, 0, 1);
    this.traffic.update(dt, this.speed - trafficSpeed, this.speed, difficulty, live);
    this.pickups.update(dt, this.speed * dt, this.distance, live);

    const box = { x: p.x, y: p.y, width: p.width, length: p.length };
    const ground = live && !this.adminMode ? this.traffic.roofUnder(box) : 0;
    p.rocket = powers.power === 'rocket';
    p.autoFlip = this.input.touchMode;
    p.update(dt, ground, this.speed, this.input.isHeld('jump'), this.input.isHeld('boost'));
    this.road.update(this.speed * dt, this.distance);
    this.scatter.update(this.speed * dt, this.distance);
    this.structures.update(dt, this.speed * dt, this.distance, this.camera.position.z);

    if (!live) return;

    box.x = p.x;
    box.y = p.y;
    const hit = this.adminMode ? null : this.traffic.hit(box);
    if (hit) {
      if (powers.invincible) {
        this.smash(hit, true);
      } else if (powers.absorbHit()) {
        p.setShield(false);
        this.hud.setShield(false);
        this.sfx.shieldBreak();
        this.haptics.buzz('shield');
        this.hud.popup('SHIELD SAVE', 0, 'great');
        this.smash(hit, false);
      } else {
        this.crash(hit);
        return;
      }
    }

    this.collected.length = 0;
    this.pickups.collect(box, this.collected);
    for (const kind of this.collected) this.onPickup(kind);

    this.trafficEvents.length = 0;
    this.traffic.scorePasses(box, this.trafficEvents);
    for (const e of this.trafficEvents) this.onTrafficEvent(e);
    for (const e of p.events) this.onPlayerEvent(e);
    p.events.length = 0;

    powers.update(dt);
    for (const e of powers.events) this.onPowerEvent(e);
    powers.events.length = 0;
    this.updatePowerGlow();

    const streak = this.combo.update(dt, !p.grounded);
    if (streak) this.onStreakEnd(streak.count, streak.score);

    const lowAir = p.air / AIR.capacity < AIR.lowRatio;
    if (lowAir && !this.lowAirWarned) this.sfx.lowAir();
    this.lowAirWarned = lowAir;

    const zone = zoneAt(this.distance);
    if (zone.index !== this.zoneIndex) {
      this.zoneIndex = zone.index;
      this.hud.zoneBanner(zone.zone.name);
      this.post.zoneSweep(this.sweepColor.setHex(zone.zone.palette.sun));
      this.sfx.zone();
    }
    this.applyZone();

    if (p.boosting || powers.power) this.shake = Math.max(this.shake, powers.power === 'ludicrous' ? 0.09 : 0.05);
    this.hud.update(this.distance, this.score, p.air, p.boosting || powers.power !== null);
    this.hud.updateCombo(this.combo.count, this.combo.multiplier, this.combo.score, this.combo.timeRatio);
    this.hud.setRocket(powers.rocketMeter);
    this.hud.setPower(powers.power, powers.timeRatio);
  }

  /**
   * Per-frame world dressing that follows the distance travelled: the zone field, the bend of the
   * road ahead (sweeping curves and hills, scaled by each zone's character) and the post grade.
   */
  private updateWorld(dt: number, frozen: boolean) {
    const d = this.distance;
    this.field.update(d);
    this.backdrop.update(dt, d, this.palette);
    this.weather.update(dt, frozen ? 0 : this.speed * dt, this.speed, this.camera, this.canvas.height, this.palette);
    const pal = this.palette;
    BEND[0] = pal.curve * 3.2e-4 * (Math.sin(d / 620) * 0.75 + Math.sin(d / 233 + 1.7) * 0.25);
    BEND[1] = pal.hills * 1.3e-4 * (Math.sin(d / 410 + 0.5) * 0.7 + Math.sin(d / 170 + 2.1) * 0.3);
    const speedK = clamp((this.speed - 25) / 75, 0, 1);
    const rush = this.player.boosting || this.powers.power ? 1 : 0;
    this.post.update(dt, pal, this.state === 'playing' ? speedK : 0, this.state === 'playing' ? rush : 0);
  }

  private applyZone() {
    paletteAt(this.distance, this.palette);
    this.env.shade = this.structures.shade;
    this.env.applyPalette(this.palette);
    this.structures.applyPalette(this.palette);
    // Thruster smoke takes the zone's light: a soft light grey in daylight (not glaring white), cooler and
    // dimmer at night or in the tunnel, with the sun glowing through its edges.
    const pal = this.palette;
    const daylight = clamp((pal.sunIntensity * 0.3 + pal.hemiIntensity * 0.5) / 1.2, 0.35, 1) * (1 - this.structures.shade * 0.55);
    this.smokeTint.setRGB(0.86, 0.87, 0.9).lerp(pal.hemiSky, 1 - daylight).multiplyScalar(daylight);
    this.smokeSun.copy(pal.sun).multiplyScalar(pal.sunIntensity * 0.3 * (1 - this.structures.shade));
    this.player.setSmokeLight(this.smokeTint, this.smokeSun, this.sunDir);
    this.player.setNight(Math.max(pal.stars, this.structures.shade));
    this.effects.setSmokeTint(this.smokeTint);
    this.road.applyPalette(this.palette);
  }

  // ---------- events ----------

  private onTrafficEvent(e: TrafficEvent) {
    const v = e.vehicle;
    if (e.type === 'near') {
      this.effects.nearMiss(this.player.x, v.x);
      this.sfx.nearMiss();
      this.haptics.buzz('near');
      this.addSkill('NEAR MISS', POINTS.nearMiss, 'good', ROCKET_FILL.nearMiss);
    } else {
      if (v.big) this.addSkill(v.kind === 'semi' ? 'SEMI CLEARED' : 'BUS CLEARED', POINTS.clearedBig, 'great', ROCKET_FILL.cleared);
      else this.addSkill('CLEAR', POINTS.cleared, 'good', ROCKET_FILL.cleared);
      this.sfx.clear(v.big);
    }
  }

  private onPlayerEvent(e: PlayerEvent) {
    const p = this.player;
    switch (e.type) {
      case 'jump':
        this.sfx.jump();
        break;
      case 'land':
        this.sfx.land(e.impact);
        this.haptics.buzz('land', clamp((e.impact - 5) / 25, 0, 1));
        this.effects.landing(p.x, p.y, e.impact);
        this.shake = Math.max(this.shake, clamp((e.impact - 8) / 30, 0, 0.45));
        break;
      case 'trick':
        this.addSkill(e.kind === 'flip' ? 'FRONT FLIP' : 'BARREL ROLL', POINTS.trick, 'good', ROCKET_FILL.trick);
        this.sfx.trick(e.kind);
        break;
      case 'stunt':
        this.addSkill(e.count > 1 ? `${e.count}× STUNT LANDING` : 'STUNT LANDING', POINTS.stuntLanding * e.count, 'great');
        this.sfx.stunt(e.count);
        break;
      case 'thrust':
        this.effects.thrust(p, e.kind, e.dir);
        break;
      case 'sloppy':
        this.hud.popup('SLOPPY LANDING', 0, 'warn');
        break;
    }
  }

  private onPickup(kind: PickupKind) {
    const p = this.player;
    const powers = this.powers;
    if (kind === 'orb') {
      this.orbChain = this.runTime - this.lastOrbT < ORB_CHAIN_WINDOW ? this.orbChain + 1 : 0;
      this.lastOrbT = this.runTime;
      p.addAir(PICKUPS.orbAir);
      this.bonus += PICKUPS.orbPoints * powers.scoreMult;
      powers.chargeRocket(ROCKET_FILL.orb);
      this.effects.pickup(p.x, p.y + 0.8, 0x7fe6ff, 6);
      this.sfx.orb(this.orbChain);
      this.haptics.buzz('pickup', 0.6);
      return;
    }
    if (kind === 'star') {
      this.effects.pickup(p.x, p.y + 0.8, 0xffd23f, 30);
      powers.start('starman');
      return;
    }

    const style = ITEM_STYLE[kind];
    this.effects.pickup(p.x, p.y + 0.8, style.color, 20);
    this.haptics.buzz('pickup');
    switch (kind) {
      case 'airCan':
        p.addAir(PICKUPS.airCan);
        powers.chargeRocket(ROCKET_FILL.airCan);
        this.sfx.item();
        break;
      case 'overpressure':
        p.addAir(AIR.capacity);
        this.sfx.item();
        break;
      case 'shield':
        powers.shield = true;
        p.setShield(true);
        this.hud.setShield(true);
        this.sfx.shield();
        break;
      case 'shockwave':
      case 'ludicrous':
        powers.item = kind;
        this.hud.setItem(kind);
        this.sfx.item();
        this.hud.popup(`${style.name} READY`, 0, 'great');
        return;
    }
    this.hud.popup(style.name, 0, 'good');
  }

  private useItem() {
    const kind = this.powers.item;
    if (!kind) return;
    this.powers.item = null;
    this.hud.setItem(null);
    if (kind === 'ludicrous') {
      this.powers.start('ludicrous');
      return;
    }
    const cars = this.traffic.nearby(SHOCKWAVE.reach);
    for (const v of cars) this.smash(v, false);
    this.effects.shockwave(this.player.x);
    this.sfx.shockwave();
    this.haptics.buzz('shockwave');
    this.shake = Math.max(this.shake, 0.6);
    if (cars.length > 0) this.addSkill(`SHOCKWAVE ×${cars.length}`, SHOCKWAVE.points * cars.length, 'great');
    else this.hud.popup('SHOCKWAVE', 0, 'good');
  }

  private onPowerEvent(e: PowerEvent) {
    if (e.type === 'start') {
      this.sfx.powerStart();
      this.haptics.buzz('power');
      this.shake = Math.max(this.shake, 0.4);
      const label = e.power === 'starman' ? '★ STARMAN' : e.power === 'rocket' ? 'ROCKET MODE' : 'LUDICROUS';
      this.hud.popup(label, 0, 'great');
    } else {
      this.sfx.powerEnd();
      this.player.setGlow(0x000000, 0);
      if (!this.powers.power) this.hud.popup('SLOWING DOWN · STILL PROTECTED', 0, 'warn');
    }
  }

  private updatePowerGlow() {
    const powers = this.powers;
    if (powers.power === 'starman') {
      this.player.setGlow(this.glowColor.setHSL((this.runTime * 1.6) % 1, 1, 0.55), 0.9);
    } else if (powers.power) {
      this.player.setGlow(POWER_GLOW[powers.power], 0.45 + Math.sin(this.runTime * 14) * 0.2);
    } else if (powers.grace > 0) {
      this.player.setGlow(0xffffff, Math.sin(this.runTime * 40) > 0 ? 0.5 : 0);
    } else {
      this.player.setGlow(0x000000, 0);
    }
  }

  private addSkill(label: string, points: number, tone: PopupTone = 'good', rocketFill = 0) {
    const earned = this.combo.add(points) * this.powers.scoreMult;
    const mult = this.combo.multiplier;
    this.bonus += earned;
    this.maxStreak = Math.max(this.maxStreak, mult);
    this.hud.popup(label, earned, tone, mult);
    this.sfx.skill(mult);
    if (rocketFill > 0) this.powers.chargeRocket(rocketFill);
  }

  private onStreakEnd(count: number, score: number) {
    const big = count >= BIG_STREAK;
    this.hud.popup(`${count} STREAK`, score, big ? 'great' : 'good');
    this.sfx.streakEnd(big);
  }

  private smash(v: Vehicle, award: boolean) {
    this.traffic.smash(v, this.player.x);
    this.effects.smash(v.x, 0, v.z);
    this.sfx.smash();
    this.haptics.buzz('smash');
    this.shake = Math.max(this.shake, 0.35);
    if (award) this.addSkill('SMASH', SMASH_POINTS, 'great');
  }

  private crash(vehicle: Vehicle) {
    this.player.crash();
    this.player.setGlow(0x000000, 0);
    this.traffic.stop(vehicle);
    this.combo.reset();
    this.effects.crash(this.player.x, this.player.y);
    this.sfx.crash();
    this.haptics.buzz('crash');
    this.shake = 0.8;
    this.canvas.classList.add('crashed');
    this.hud.update(this.distance, this.score, this.player.air, false);
    this.hud.updateCombo(0, 1, 0, 0);
    this.hud.setPower(null, 0);
    this.setState('crashing');
  }

  private gameOver() {
    const score = this.score;
    const isRecord = score > this.records.bestScore;
    const kmBefore = this.km;
    this.records = {
      bestScore: Math.max(score, this.records.bestScore),
      bestDistance: Math.max(Math.floor(this.distance), this.records.bestDistance),
      totalDistance: this.records.totalDistance + Math.floor(this.distance),
    };
    saveJSON(STORAGE_KEY, this.records);
    const unlocked = this.unlockedBetween(kmBefore, this.km);
    if (unlocked.length) {
      const names = unlocked.map((u) => `${u.name}${u.kind === 'wheels' ? ' wheels' : ''}`).join(', ');
      this.hud.toast(`Paint shop unlocked: ${names}`, 4200);
    }
    this.setState('over');
    this.hud.setLine('over-rank', '');
    this.hud.setLine('over-challenge', this.challengeLine(score));
    void this.submitRun({ distance: this.distance, score, duration: this.runTime, maxStreak: this.maxStreak });
    this.hud.showGameOver({
      score,
      distance: this.distance,
      time: this.runTime,
      best: this.records.bestScore,
      isRecord,
      reason: `Crashed · ${zoneAt(this.distance).zone.name}`,
    });
  }

  // ---------- online ----------

  /** Saves the run in the background; the game-over card doesn't show where it ranks. */
  private async submitRun(report: RunReport) {
    try {
      const runId = await this.runTicket;
      if (runId) await this.board.submitRun(runId, report);
    } catch {
      // A score that couldn't be saved online is simply skipped.
    }
  }

  private challengeLine(score: number) {
    const c = this.challenge;
    if (!c) return null;
    if (score > c.score) return `You beat ${c.name}'s ${c.score.toLocaleString()}!`;
    const gap = c.distance - Math.floor(this.distance);
    return gap > 0
      ? `${gap.toLocaleString()} m behind ${c.name}`
      : `${(c.score - score + 1).toLocaleString()} pts short of ${c.name}`;
  }

  private async share() {
    const result = await shareRun({
      name: this.pilot?.callsign ?? 'A pilot',
      score: this.score,
      distance: Math.floor(this.distance),
    });
    if (result === 'copied') this.hud.setLine('over-rank', 'Link copied — send it to a friend!');
    else if (result === 'failed') this.hud.setLine('over-rank', 'Could not share from this browser.');
  }

  // ---------- photo mode ----------

  /** Freezes the world and hands the camera over to an orbit around the car. */
  private enterPhoto() {
    if (this.state !== 'paused' && this.state !== 'over') return;
    this.photoFrom = this.state;
    // Start from where the chase camera already is, so the view doesn't jump.
    const p = this.player;
    const off = this.camera.position.clone().sub(this.photoTarget());
    this.photoDist = clamp(off.length(), PHOTO_DIST[0], PHOTO_DIST[1]);
    this.photoYaw = Math.atan2(off.x, off.z);
    this.photoPitch = clamp(Math.asin(clamp(off.y / Math.max(off.length(), 1e-3), -1, 1)), PHOTO_PITCH[0], PHOTO_PITCH[1]);
    this.lastPlayerX = p.x;
    this.setState('photo');
    this.sfx.musicDucked(true);
    this.hud.show('photo');
    this.hud.toast('Photo mode', 1200);
  }

  private exitPhoto() {
    if (this.state !== 'photo') return;
    this.photoPointers.clear();
    const back = this.photoFrom;
    this.setState(back);
    if (back === 'over') this.hud.show('over');
    else this.hud.show('paused');
  }

  private photoTarget() {
    return new THREE.Vector3(this.player.x, this.player.y + this.player.car.height * 0.45, 0);
  }

  private photoCamera(dt: number) {
    const input = this.input;
    const a = input.analog;
    // Keyboard arrows / WASD and either stick orbit; up/down tilts. Triggers zoom.
    const turn = (input.isHeld('right') ? 1 : 0) - (input.isHeld('left') ? 1 : 0) + a.lx + a.rx;
    const tilt = (input.isHeld('jump') ? 1 : 0) - (input.isHeld('down') ? 1 : 0) - a.ly - a.ry;
    this.photoYaw += turn * dt * 1.6;
    this.photoPitch = clamp(this.photoPitch + tilt * dt * 1.1, PHOTO_PITCH[0], PHOTO_PITCH[1]);
    this.photoDist = clamp(this.photoDist * Math.exp(-a.zoom * dt * 1.4), PHOTO_DIST[0], PHOTO_DIST[1]);

    const cam = this.camera;
    const target = this.photoTarget();
    const r = this.photoDist;
    cam.position.set(
      target.x + Math.sin(this.photoYaw) * Math.cos(this.photoPitch) * r,
      Math.max(0.25, target.y + Math.sin(this.photoPitch) * r),
      target.z + Math.cos(this.photoYaw) * Math.cos(this.photoPitch) * r,
    );
    cam.lookAt(target);
    cam.fov = damp(cam.fov, 50, 6, dt);
    cam.filmOffset = 0;
    cam.updateProjectionMatrix();
  }

  /** Mouse drag / one finger orbits, the wheel or a pinch zooms. Only active in photo mode. */
  private attachPhotoControls(canvas: HTMLCanvasElement) {
    const pinchDist = () => {
      const [a, b] = [...this.photoPointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (this.state !== 'photo') return;
      this.photoPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.photoPointers.size === 2) this.photoPinch = pinchDist();
    });
    canvas.addEventListener('pointermove', (e) => {
      const last = this.photoPointers.get(e.pointerId);
      if (this.state !== 'photo' || !last) return;
      if (this.photoPointers.size === 1) {
        this.photoYaw -= (e.clientX - last.x) * 0.006;
        this.photoPitch = clamp(this.photoPitch + (e.clientY - last.y) * 0.005, PHOTO_PITCH[0], PHOTO_PITCH[1]);
      }
      last.x = e.clientX;
      last.y = e.clientY;
      if (this.photoPointers.size === 2) {
        const d = pinchDist();
        if (this.photoPinch > 0) this.photoDist = clamp((this.photoDist * this.photoPinch) / d, PHOTO_DIST[0], PHOTO_DIST[1]);
        this.photoPinch = d;
      }
    });
    const up = (e: PointerEvent) => {
      this.photoPointers.delete(e.pointerId);
      this.photoPinch = 0;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (this.state !== 'photo') return;
        e.preventDefault();
        this.photoDist = clamp(this.photoDist * Math.exp(e.deltaY * 0.0012), PHOTO_DIST[0], PHOTO_DIST[1]);
      },
      { passive: false },
    );
  }

  /**
   * Renders the frame, copies it straight off the WebGL canvas (before the browser clears it), stamps a
   * small caption in the corner and saves it as a PNG, or offers the share sheet on phones.
   */
  private async savePhoto() {
    if (this.state !== 'photo' || this.photoBusy) return;
    this.photoBusy = true;
    this.hud.photoSaving(true);
    try {
      this.renderFrame();
      const src = this.renderer.domElement;
      const shot = document.createElement('canvas');
      shot.width = src.width;
      shot.height = src.height;
      const ctx = shot.getContext('2d')!;
      ctx.drawImage(src, 0, 0);
      this.stampPhoto(ctx, shot.width, shot.height);
      const blob = await new Promise<Blob | null>((r) => shot.toBlob(r, 'image/png'));
      if (!blob) throw new Error('capture failed');
      const name = `drive-roadster-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
      const file = new File([blob], name, { type: 'image/png' });
      if (this.input.touchMode && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Drive Roadster' });
        } catch {
          // Cancelled share sheet: nothing saved, nothing to report.
        }
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        this.hud.toast('Photo saved', 1600);
      }
      this.sfx.click();
      this.haptics.buzz('ui');
    } catch {
      this.hud.toast('Could not save the photo in this browser', 2600);
    } finally {
      this.hud.photoSaving(false);
      this.photoBusy = false;
    }
  }

  /** The caption: game name, then the car, zone and distance of the moment. */
  private stampPhoto(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const u = h / 720;
    const pad = 26 * u;
    const line2 = `${carDesign(this.settings.car).name} · ${zoneAt(this.distance).zone.name} · ${Math.floor(this.distance).toLocaleString()} m`;
    ctx.save();
    const grad = ctx.createLinearGradient(0, h - 120 * u, 0, h);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, h - 120 * u, w, 120 * u);
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 8 * u;
    ctx.fillStyle = '#ff3b4e';
    ctx.fillRect(pad, h - pad - 52 * u, 4 * u, 46 * u);
    ctx.fillStyle = '#f6f1ea';
    ctx.font = `italic 800 ${30 * u}px 'Barlow Condensed', system-ui, sans-serif`;
    ctx.fillText('DRIVE ROADSTER', pad + 14 * u, h - pad - 26 * u);
    ctx.font = `500 ${15 * u}px 'Barlow', system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(246,241,234,0.8)';
    ctx.fillText(line2, pad + 14 * u, h - pad - 5 * u);
    ctx.restore();
  }

  // ---------- camera ----------

  private updateCamera(dt: number) {
    const p = this.player;
    const cam = this.camera;

    const pt = this.portrait;
    if (this.state === 'menu') {
      // Landscape: the car sits right of the menu panel. Portrait: it sits above the panel.
      this.menuAngle += dt * 0.2;
      // Bigger cars (Model X, Cybertruck) get a wider orbit so they still fit the frame.
      let size = Math.pow(p.car.length / 4.4, 0.85);
      cam.fov = lerp(45, 58, pt);
      // Centre the car in the screen space the menu panel leaves free, and back off until the car
      // plus a garage arrow either side fits across it.
      const w = window.innerWidth;
      const h = window.innerHeight;
      const left = this.hud.menuSpaceLeft();
      const fitHalf = Math.max(60, (w - left) / 2 - GARAGE_ARROW_SPACE);
      const tan = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
      const fitDist = (0.5 * Math.hypot(p.car.length, p.car.width) * h) / 2 / (tan * fitHalf);
      const dist = Math.hypot(lerp(7.5, 10.5, pt), lerp(2.1, 3.4, pt) - p.car.height * 0.5) * size;
      size *= Math.max(1, fitDist / dist);
      const r = lerp(7.5, 10.5, pt) * size;
      cam.position.set(p.x + Math.sin(this.menuAngle) * r, lerp(2.1, 3.4, pt) * size, Math.cos(this.menuAngle) * r);
      cam.lookAt(p.x, lerp(0.6, -2.6, pt) * size, 0);
      cam.filmOffset = -((left + (w - left) / 2) / w - 0.5) * cam.getFilmWidth();
      cam.updateProjectionMatrix();
      this.camPos.copy(cam.position);
      this.camLook.set(p.x, 0.6, 0);
      this.lastPlayerX = p.x;
      this.frameGarage();
      return;
    }
    if (this.state === 'paused') return;
    if (this.state === 'photo') {
      this.photoCamera(dt);
      return;
    }

    const speedK = clamp((this.speed - 25) / 75, 0, 1);
    const rate = this.state === 'playing' && this.stateT < 1 ? 4 : 7;
    // A high chase view looking down the road, so the traffic ahead is easy to read; the car sits in the
    // lower part of the screen. Portrait screens are narrow, so the camera rises and pulls back further.
    this.camPos.set(
      damp(this.camPos.x, p.x * lerp(0.75, 0.55, pt), rate, dt),
      damp(this.camPos.y, lerp(5.2, 7.4, pt) + p.y * 0.55, rate, dt),
      damp(this.camPos.z, lerp(10, 12.4, pt) - speedK * 0.8, rate, dt),
    );
    this.camLook.set(
      damp(this.camLook.x, p.x * lerp(0.85, 0.6, pt), rate, dt),
      damp(this.camLook.y, lerp(0.3, -1.4, pt) + p.y * 0.6, rate, dt),
      damp(this.camLook.z, lerp(-20, -24, pt), rate, dt),
    );

    this.shake = damp(this.shake, 0, 4, dt);
    cam.position.set(
      this.camPos.x + (Math.random() - 0.5) * this.shake,
      this.camPos.y + (Math.random() - 0.5) * this.shake,
      this.camPos.z,
    );
    cam.lookAt(this.camLook);

    // Bank slightly into lane changes.
    const lateral = dt > 0 ? (p.x - this.lastPlayerX) / dt : 0;
    this.lastPlayerX = p.x;
    // ...and lean a touch into the bend of the road ahead.
    this.camRoll = damp(this.camRoll, clamp(-lateral * 0.0035, -0.06, 0.06) + BEND[0] * 90, 8, dt);
    cam.rotateZ(this.camRoll);

    const powerFov = this.powers.power === 'ludicrous' ? 14 : this.powers.power ? 8 : 0;
    const kick = (speedK * 14 + (p.boosting ? 7 : 0) + powerFov) * lerp(1, 0.55, pt);
    const targetFov = lerp(60, 80, pt) + kick;
    cam.fov = damp(cam.fov, targetFov, 4, dt);
    cam.filmOffset = damp(cam.filmOffset, 0, 6, dt);
    cam.updateProjectionMatrix();
  }

  /**
   * Puts the garage arrows either side of the orbiting car and its name card underneath. The car's
   * footprint radius is used rather than its outline, so the arrows hold still as the camera circles.
   */
  private frameGarage() {
    const cam = this.camera;
    const car = this.player.car;
    const w = window.innerWidth;
    const h = window.innerHeight;
    cam.updateMatrixWorld();
    const radius = 0.5 * Math.hypot(car.length, car.width);
    const centre = this.garagePoint.set(this.player.x, car.height * 0.5, 0);
    const pxPerUnit = h / 2 / (cam.position.distanceTo(centre) * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)));
    centre.project(cam);
    const cx = ((centre.x + 1) / 2) * w;
    const cy = ((1 - centre.y) / 2) * h;
    // The footprint's nearest edge to the camera is the lowest point of the car on screen.
    const front = this.garagePoint.set(cam.position.x - this.player.x, 0, cam.position.z).setLength(radius);
    front.x += this.player.x;
    front.project(cam);
    this.hud.placeGarage(cx, cy, radius * pxPerUnit, ((1 - front.y) / 2) * h);
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.portrait = clamp((1.25 - w / h) / 0.75, 0, 1);
  }
}
