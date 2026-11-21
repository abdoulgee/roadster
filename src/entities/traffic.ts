import * as THREE from 'three';
import { LANES, LANE_WIDTH, POINTS, TRAFFIC, laneX } from '../config';
import { clamp, damp, lerp } from '../util/math';
import { mulberry32, pick, shuffle, weighted, type Rng } from '../util/rng';
import { contactShadow } from '../fx/contactShadow';
import { SLOTS, TRAILER_VARIANTS, buildVehicleModel, type ModelKey, type Slot, type VehicleModel } from './vehicleModels';

export type VehicleKind = 'sedan' | 'suv' | 'taxi' | 'bus' | 'semi';

export interface Vehicle {
  kind: VehicleKind;
  obj: THREE.Group;
  lane: number;
  x: number;
  z: number; // centre; the player sits at z = 0 and traffic flows toward +z
  len: number;
  w: number;
  h: number;
  big: boolean;
  alive: boolean;
  stopped: boolean;
  passed: boolean;
  minClearance: number;
  smash: { vx: number; vy: number; vz: number; spin: THREE.Vector3; y: number } | null;
}

export type TrafficEvent = { type: 'clear'; vehicle: Vehicle } | { type: 'near'; vehicle: Vehicle };

export interface PlayerBox {
  x: number;
  y: number;
  width: number;
  length: number;
}

// ---------- models and materials ----------

/** Beyond this distance a vehicle swaps to its low-detail stand-in. */
const LOD_DISTANCE = 75;

const modelCache = new Map<ModelKey, readonly [VehicleModel, VehicleModel]>();
const materialCache = new Map<string, THREE.Material>();

function material(key: string, make: () => THREE.Material) {
  let m = materialCache.get(key);
  if (!m) materialCache.set(key, (m = make()));
  return m;
}

const paint = (color: number) =>
  material(`paint-${color}`, () => new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.32 }));

const SLOT_MATERIAL: Record<Exclude<Slot, 'paint'>, () => THREE.Material> = {
  glass: () => material('glass', () => new THREE.MeshStandardMaterial({ color: 0x1a222c, metalness: 0.5, roughness: 0.05 })),
  trim: () => material('trim', () => new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.15, roughness: 0.7 })),
  metal: () => material('metal', () => new THREE.MeshStandardMaterial({ color: 0xc9cdd3, metalness: 0.9, roughness: 0.28 })),
  // Lamps are unlit, with vertex colours above 1 so they stay bright through tone mapping.
  light: () => material('light', () => new THREE.MeshBasicMaterial({ vertexColors: true })),
};

function models(key: ModelKey) {
  let pair = modelCache.get(key);
  if (!pair) modelCache.set(key, (pair = [buildVehicleModel(key, 1), buildVehicleModel(key, 0)]));
  return pair;
}

function meshes(model: VehicleModel, color: number, shadows: boolean) {
  const g = new THREE.Group();
  for (const slot of SLOTS) {
    const geo = model[slot];
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, slot === 'paint' ? paint(color) : SLOT_MATERIAL[slot]());
    mesh.castShadow = shadows && (slot === 'paint' || slot === 'trim');
    g.add(mesh);
  }
  return g;
}

function vehicleObject(key: ModelKey, color: number) {
  const [near, far] = models(key);
  const lod = new THREE.LOD();
  lod.addLevel(meshes(near, color, true), 0);
  lod.addLevel(meshes(far, color, false), LOD_DISTANCE);
  return new THREE.Group().add(lod);
}

/**
 * One of every traffic model (both detail levels), built ahead of the first run so a bus or semi
 * appearing for the first time doesn't stall a frame. Returned as a group to render once while loading.
 */
export function warmTrafficModels() {
  const keys: ModelKey[] = ['sedan', 'hatch', 'taxi', 'suv', 'bus'];
  for (let i = 0; i < TRAILER_VARIANTS; i++) keys.push(`semi-${i}`);
  const group = new THREE.Group();
  keys.forEach((key, i) => {
    const [near, far] = models(key);
    const a = meshes(near, 0xd9dde3, true);
    const b = meshes(far, 0xd9dde3, false);
    a.position.set((i - keys.length / 2) * 3, 0, -14);
    b.position.set((i - keys.length / 2) * 3, 0, -20);
    group.add(a, b);
  });
  return group;
}

const CAR_COLORS = [0xd9dde3, 0x1e2126, 0x8c96a3, 0x9b1d24, 0x1f4f8f, 0x2f6b4f, 0xc7a467, 0x5c2b6b, 0xf2f2ee, 0x3d4652];
const BUS_COLORS = [0xe8a317, 0x2a6fb0, 0xb8322f, 0x2e7d55];
const CAB_COLORS = [0xd9dde3, 0x9b1d24, 0x1f4f8f, 0x2f6b4f, 0xe08a1e, 0x1e2126];

interface Spec {
  len: number;
  w: number;
  h: number;
  big: boolean;
  build(rng: Rng): THREE.Group;
}

const SPECS: Record<VehicleKind, Spec> = {
  sedan: {
    len: 4.6,
    w: 1.9,
    h: 1.42,
    big: false,
    build: (rng) => vehicleObject(rng() < 0.55 ? 'sedan' : 'hatch', pick(rng, CAR_COLORS)),
  },
  suv: { len: 4.9, w: 2.0, h: 1.9, big: false, build: (rng) => vehicleObject('suv', pick(rng, CAR_COLORS)) },
  taxi: { len: 4.6, w: 1.9, h: 1.5, big: false, build: () => vehicleObject('taxi', 0xf2b705) },
  bus: { len: 11.5, w: 2.5, h: 3.1, big: true, build: (rng) => vehicleObject('bus', pick(rng, BUS_COLORS)) },
  semi: {
    len: 15.4,
    w: 2.5,
    h: 4.0,
    big: true,
    build: (rng) => vehicleObject(`semi-${Math.floor(rng() * TRAILER_VARIANTS)}`, pick(rng, CAB_COLORS)),
  },
};

// ---------- traffic manager ----------

const MAX_ROWS_PER_FRAME = 4;

export class Traffic {
  readonly vehicles: Vehicle[] = [];
  private readonly group = new THREE.Group();
  private rng: Rng = mulberry32(1);
  private laneLast: (Vehicle | null)[] = new Array(LANES).fill(null);
  private lastFreeLane = 1;
  private lastRowZ = 0;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  reset(seed: number) {
    for (const v of this.vehicles) this.group.remove(v.obj);
    this.vehicles.length = 0;
    this.laneLast.fill(null);
    this.rng = mulberry32(seed);
    this.lastFreeLane = 1;
    // Pre-fill the visible road so the run starts with traffic ahead.
    let z = TRAFFIC.firstRowZ;
    while (z > TRAFFIC.spawnZ) {
      this.spawnRow(z, 0, true);
      z -= this.rowGap(0, 12.5);
    }
    this.lastRowZ = z;
  }

  /** Moves traffic by its speed relative to the player and spawns new rows at the horizon. */
  update(dt: number, relSpeed: number, groundSpeed: number, difficulty: number, spawn: boolean) {
    const rel = relSpeed * dt;
    for (const v of this.vehicles) {
      if (v.smash) {
        this.updateSmashed(v, dt, groundSpeed);
        continue;
      }
      v.z += v.stopped ? groundSpeed * dt : rel;
      v.obj.position.z = v.z;
    }
    this.lastRowZ += rel;

    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      if (v.z - v.len / 2 > TRAFFIC.despawnZ || v.z + v.len / 2 < TRAFFIC.spawnZ - 60) {
        v.alive = false;
        this.group.remove(v.obj);
        this.vehicles.splice(i, 1);
      }
    }

    if (!spawn) return;
    const gap = this.rowGap(difficulty, relSpeed);
    for (let rows = 0; rows < MAX_ROWS_PER_FRAME && this.lastRowZ - gap >= TRAFFIC.spawnZ; rows++) {
      this.lastRowZ -= gap;
      this.spawnRow(this.lastRowZ, difficulty, false);
    }
  }

  /** Height of the highest roof the player is over and already above (so they can ride on top). */
  roofUnder(p: PlayerBox): number {
    let ground = 0;
    for (const v of this.vehicles) {
      if (v.stopped || v.smash) continue;
      if (this.overlapsXZ(p, v, 0.8, 0.85) && p.y >= v.h - 0.35) ground = Math.max(ground, v.h);
    }
    return ground;
  }

  hit(p: PlayerBox): Vehicle | null {
    for (const v of this.vehicles) {
      if (!v.smash && this.overlapsXZ(p, v, 0.82, 0.9) && p.y < v.h - 0.35) return v;
    }
    return null;
  }

  /** Scores vehicles as the player passes them: jumped over → clear, squeezed past → near miss. */
  scorePasses(p: PlayerBox, out: TrafficEvent[]) {
    for (const v of this.vehicles) {
      if (v.passed || v.stopped || v.smash) continue;
      const zOverlap = Math.abs(v.z) < (p.length + v.len) / 2;
      if (zOverlap && p.y < v.h) {
        const clearance = Math.abs(p.x - v.x) - (p.width + v.w) / 2;
        v.minClearance = Math.min(v.minClearance, clearance);
      }
      if (v.z - v.len / 2 > p.length / 2) {
        v.passed = true;
        const over = Math.abs(p.x - v.x) < (p.width + v.w) / 2 && p.y >= v.h - 0.35;
        if (over) out.push({ type: 'clear', vehicle: v });
        else if (v.minClearance < POINTS.nearMissClearance) out.push({ type: 'near', vehicle: v });
      }
    }
  }

  stop(v: Vehicle) {
    v.stopped = true;
  }

  /** Knocks a vehicle off the road, tumbling away from `fromX`. */
  smash(v: Vehicle, fromX: number) {
    if (v.smash) return;
    const side = Math.sign(v.x - fromX) || (this.rng() < 0.5 ? -1 : 1);
    const heavy = v.big ? 0.5 : 1;
    v.passed = true;
    // Thrown off the road: its footprint no longer sits on the tarmac.
    const shadow = v.obj.getObjectByName('contact-shadow');
    if (shadow) shadow.visible = false;
    v.smash = {
      vx: side * (6 + this.rng() * 6) * heavy,
      vy: (9 + this.rng() * 6) * heavy,
      vz: -(8 + this.rng() * 8), // relative to the player: thrown ahead first, then left behind
      spin: new THREE.Vector3((this.rng() - 0.5) * 8, (this.rng() - 0.5) * 6, side * -(3 + this.rng() * 5)).multiplyScalar(heavy),
      y: 0,
    };
  }

  /** Every live vehicle within `reach` metres ahead of (or just beside) the player. */
  nearby(reach: number) {
    return this.vehicles.filter((v) => !v.smash && !v.stopped && v.z > -reach && v.z - v.len / 2 < 6);
  }

  private updateSmashed(v: Vehicle, dt: number, groundSpeed: number) {
    const s = v.smash!;
    s.vy -= 28 * dt;
    s.vz = damp(s.vz, groundSpeed * 0.7, 1.5, dt);
    v.x += s.vx * dt;
    s.y += s.vy * dt;
    v.z += s.vz * dt;
    if (s.y < 0) {
      s.y = 0;
      s.vy = Math.abs(s.vy) * 0.3;
      s.vx *= 0.7;
      s.spin.multiplyScalar(0.6);
    }
    v.obj.position.set(v.x, s.y, v.z);
    v.obj.rotation.x += s.spin.x * dt;
    v.obj.rotation.y += s.spin.y * dt;
    v.obj.rotation.z += s.spin.z * dt;
  }

  private overlapsXZ(p: PlayerBox, v: Vehicle, wScale: number, lScale: number) {
    return Math.abs(p.x - v.x) < ((p.width + v.w) / 2) * wScale && Math.abs(v.z) < ((p.length + v.len) / 2) * lScale;
  }

  private rowGap(difficulty: number, relSpeed: number) {
    const rowTime = lerp(TRAFFIC.rowTimeEasy, TRAFFIC.rowTimeHard, difficulty);
    return Math.max(TRAFFIC.minRowGap, relSpeed * rowTime);
  }

  private laneFree(lane: number, rearZ: number) {
    const last = this.laneLast[lane];
    if (!last || !last.alive) return true;
    return rearZ < last.z - last.len / 2 - TRAFFIC.minLaneGap;
  }

  /**
   * Spawns one row with its rear edge at `rearZ`. Each row keeps one lane open, and that open lane
   * is at most one lane away from the previous row's, so there is always a ground-level path.
   */
  private spawnRow(rearZ: number, difficulty: number, warmup: boolean) {
    const open = [...Array(LANES).keys()].filter((l) => this.laneFree(l, rearZ));
    if (open.length === 0) return;
    const reachable = open.filter((l) => Math.abs(l - this.lastFreeLane) <= 1);
    const freeLane = pick(this.rng, reachable.length ? reachable : open);
    this.lastFreeLane = freeLane;

    const emptyChance = lerp(TRAFFIC.emptyRowEasy, TRAFFIC.emptyRowHard, difficulty) + (warmup ? 0.15 : 0);
    if (this.rng() < emptyChance) return;

    const maxBlocked = clamp(1 + Math.floor(difficulty * 2.2), 1, LANES - 1);
    const count = 1 + Math.floor(this.rng() * maxBlocked);
    const lanes = shuffle(this.rng, open.filter((l) => l !== freeLane)).slice(0, count);
    for (const lane of lanes) this.spawnVehicle(lane, rearZ, difficulty);
  }

  private spawnVehicle(lane: number, rearZ: number, difficulty: number) {
    const kind = weighted<VehicleKind>(this.rng, {
      sedan: 40,
      suv: 22,
      taxi: 14,
      bus: lerp(4, 10, difficulty),
      semi: lerp(4, 16, difficulty),
    });
    const spec = SPECS[kind];
    const obj = spec.build(this.rng);
    const v: Vehicle = {
      kind,
      obj,
      lane,
      x: laneX(lane) + (this.rng() - 0.5) * (LANE_WIDTH - spec.w - 0.8) * 0.5,
      z: rearZ - spec.len / 2,
      len: spec.len,
      w: spec.w,
      h: spec.h,
      big: spec.big,
      alive: true,
      stopped: false,
      passed: false,
      minClearance: Infinity,
      smash: null,
    };
    obj.position.set(v.x, 0, v.z);
    obj.add(contactShadow(spec.len, spec.w));
    this.group.add(obj);
    this.vehicles.push(v);
    this.laneLast[lane] = v;
  }
}
