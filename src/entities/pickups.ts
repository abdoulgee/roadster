import * as THREE from 'three';
import { LANES, PICKUPS, laneX, type ItemKind } from '../config';
import { mulberry32, weighted, type Rng } from '../util/rng';
import {
  buildItemCapsule,
  buildStar,
  coinGeometry,
  coinGlowMaterial,
  coinMaterial,
  coinRimGeometry,
  coinRimMaterial,
  tickItemLooks,
} from './pickupModels';
import type { PlayerBox } from './traffic';

export type PickupKind = 'orb' | 'star' | ItemKind;

interface Pickup {
  kind: PickupKind;
  obj: THREE.Object3D | null; // air coins are drawn by shared instanced meshes instead
  x: number;
  y: number;
  z: number;
  phase: number;
}

export const ITEM_STYLE: Record<ItemKind, { color: number; name: string; detail: string }> = {
  airCan: { color: 0x6fe3ff, name: 'AIR CAN', detail: '+150 L' },
  overpressure: { color: 0xc6f4ff, name: 'OVERPRESSURE', detail: 'Full air' },
  shield: { color: 0xff9a3d, name: 'HEAT SHIELD', detail: 'Blocks one hit' },
  shockwave: { color: 0xb07bff, name: 'SHOCKWAVE', detail: 'Clears nearby traffic' },
  ludicrous: { color: 0xff3fa8, name: 'LUDICROUS', detail: 'Hyper speed · invincible · ×2' },
};

const SPAWN_AHEAD = 300;
const DESPAWN_Z = 12;
const MAX_ORBS = 160;

// ---------- visuals ----------

function drawItemIcon(kind: ItemKind) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const c = canvas.getContext('2d')!;
  const color = `#${ITEM_STYLE[kind].color.toString(16).padStart(6, '0')}`;
  c.fillStyle = 'rgba(10, 8, 20, 0.85)';
  c.beginPath();
  c.arc(64, 64, 58, 0, Math.PI * 2);
  c.fill();
  c.lineWidth = 7;
  c.strokeStyle = color;
  c.stroke();
  c.fillStyle = color;
  c.strokeStyle = color;
  c.lineWidth = 8;
  c.lineCap = c.lineJoin = 'round';
  switch (kind) {
    case 'airCan':
    case 'overpressure':
      c.fillRect(44, 36, 40, 58);
      c.fillRect(56, 26, 16, 12);
      c.fillStyle = '#0a0814';
      c.font = 'bold 22px sans-serif';
      c.textAlign = 'center';
      c.fillText(kind === 'airCan' ? 'AIR' : 'MAX', 64, 72);
      break;
    case 'shield':
      c.beginPath();
      c.moveTo(64, 28);
      c.lineTo(94, 40);
      c.quadraticCurveTo(92, 82, 64, 100);
      c.quadraticCurveTo(36, 82, 34, 40);
      c.closePath();
      c.fill();
      break;
    case 'shockwave':
      for (const r of [12, 26, 40]) {
        c.beginPath();
        c.arc(64, 64, r, 0, Math.PI * 2);
        c.stroke();
      }
      break;
    case 'ludicrous':
      for (const x of [38, 64]) {
        c.beginPath();
        c.moveTo(x, 36);
        c.lineTo(x + 26, 64);
        c.lineTo(x, 92);
        c.stroke();
      }
      break;
  }
  return canvas;
}

const iconURLs = new Map<ItemKind, string>();

/** The same icon as an image URL, for the HUD. */
export function itemIconURL(kind: ItemKind) {
  let url = iconURLs.get(kind);
  if (!url) iconURLs.set(kind, (url = drawItemIcon(kind).toDataURL()));
  return url;
}

// ---------- manager ----------

/** Things lying on the road: lines of air coins, item capsules and the rare golden star. */
export class Pickups {
  private readonly items: Pickup[] = [];
  private readonly group = new THREE.Group();
  private readonly coins: THREE.InstancedMesh;
  private readonly rims: THREE.InstancedMesh;
  private readonly glow: THREE.Points;
  private readonly glowAt = new Float32Array(MAX_ORBS * 3);
  private readonly matrix = new THREE.Matrix4();
  private readonly spin = new THREE.Quaternion();
  private readonly at = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private rng: Rng = mulberry32(1);
  private nextOrbAt = 0;
  private nextItemAt = 0;
  private nextStarAt = 0;
  private time = 0;

  constructor(scene: THREE.Scene) {
    // Air coins: a body and a milled rim per coin, plus one glow cloud behind them all.
    this.coins = new THREE.InstancedMesh(coinGeometry, coinMaterial, MAX_ORBS);
    this.rims = new THREE.InstancedMesh(coinRimGeometry, coinRimMaterial, MAX_ORBS);
    const glowGeo = new THREE.BufferGeometry();
    glowGeo.setAttribute('position', new THREE.BufferAttribute(this.glowAt, 3).setUsage(THREE.DynamicDrawUsage));
    this.glow = new THREE.Points(glowGeo, coinGlowMaterial);
    for (const m of [this.coins, this.rims, this.glow]) m.frustumCulled = false;
    this.coins.count = this.rims.count = 0;
    this.coins.castShadow = true;
    scene.add(this.group, this.coins, this.rims, this.glow);
  }

  reset(seed: number) {
    for (const p of this.items) if (p.obj) this.group.remove(p.obj);
    this.items.length = 0;
    this.rng = mulberry32(seed ^ 0x5eed);
    this.nextOrbAt = 70;
    this.nextItemAt = this.range(PICKUPS.itemGap) * 0.6;
    this.nextStarAt = PICKUPS.starFirst;
    this.coins.count = this.rims.count = 0;
    this.glow.geometry.setDrawRange(0, 0);
  }

  update(dt: number, scroll: number, distance: number, spawn: boolean) {
    this.time += dt;
    for (const p of this.items) p.z += scroll;
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.items[i].z > DESPAWN_Z) this.remove(i);
    }

    if (spawn) {
      const horizon = distance + SPAWN_AHEAD;
      while (this.nextOrbAt <= horizon) this.nextOrbAt = this.spawnOrbLine(this.nextOrbAt, distance);
      while (this.nextItemAt <= horizon) {
        this.add(weighted(this.rng, PICKUPS.itemWeights), this.randomLaneX(), 1.3, distance - this.nextItemAt);
        this.nextItemAt += this.range(PICKUPS.itemGap);
      }
      while (this.nextStarAt <= horizon) {
        this.add('star', this.randomLaneX(), 1.7, distance - this.nextStarAt);
        this.nextStarAt += this.range(PICKUPS.starGap);
      }
    }

    this.animate();
  }

  /** Removes and reports every pickup the player's box touches. */
  collect(p: PlayerBox, out: PickupKind[]) {
    const cy = p.y + 0.6;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      const reach = it.kind === 'orb' ? 1.3 : 1.6;
      if (Math.abs(p.x - it.x) < reach && Math.abs(it.z) < p.length / 2 + 0.6 && Math.abs(cy - it.y) < reach) {
        out.push(it.kind);
        this.remove(i);
      }
    }
  }

  private spawnOrbLine(at: number, distance: number) {
    const count = 6 + Math.floor(this.rng() * 5);
    const arc = this.rng() < PICKUPS.orbArcChance;
    const x = this.randomLaneX();
    for (let i = 0; i < count; i++) {
      const y = arc ? 1 + Math.sin((i / (count - 1)) * Math.PI) * 4 : 1;
      this.add('orb', x, y, distance - (at + i * PICKUPS.orbSpacing));
    }
    return at + count * PICKUPS.orbSpacing + this.range(PICKUPS.orbLineGap);
  }

  /** Puts one of every pickup in view (for the loading warm-up); the next reset clears them. */
  warmUp() {
    const kinds: PickupKind[] = ['orb', 'star', 'airCan', 'overpressure', 'shield', 'shockwave', 'ludicrous'];
    kinds.forEach((kind, i) => this.add(kind, (i - 3) * 1.8, 1.2, -9));
    this.animate();
  }

  private add(kind: PickupKind, x: number, y: number, z: number) {
    if (kind === 'orb' && this.items.filter((p) => p.kind === 'orb').length >= MAX_ORBS) return;
    let obj: THREE.Object3D | null = null;
    if (kind === 'star') obj = buildStar();
    else if (kind !== 'orb') obj = buildItemCapsule(kind, ITEM_STYLE[kind].color);
    if (obj) {
      obj.position.set(x, y, z);
      this.group.add(obj);
    }
    this.items.push({ kind, obj, x, y, z, phase: this.rng() * Math.PI * 2 });
  }

  private remove(i: number) {
    const p = this.items[i];
    if (p.obj) this.group.remove(p.obj);
    this.items.splice(i, 1);
  }

  private animate() {
    const t = this.time;
    let n = 0;
    for (const p of this.items) {
      const bob = Math.sin(t * 3 + p.phase) * 0.15;
      if (p.kind === 'orb') {
        // Coins spin on edge, each a little out of step with its neighbours.
        this.spin.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, t * 3.2 + p.phase);
        this.matrix.compose(this.at.set(p.x, p.y + bob, p.z), this.spin, this.one);
        this.coins.setMatrixAt(n, this.matrix);
        this.rims.setMatrixAt(n, this.matrix);
        this.glowAt.set([p.x, p.y + bob, p.z - 0.05], n * 3);
        n++;
      } else if (p.obj) {
        p.obj.position.set(p.x, p.y + bob, p.z);
        const spin = p.obj.getObjectByName('spin')!;
        if (p.kind === 'star') {
          spin.rotation.set(Math.sin(t * 1.7 + p.phase) * 0.25, t * 2.6, 0);
          const sparkles = p.obj.getObjectByName('sparkles')!;
          sparkles.rotation.y = -t * 1.4;
          sparkles.children.forEach((s, i) => s.scale.setScalar((0.25 + 0.2 * Math.abs(Math.sin(t * 5 + i * 1.7))) * 1.2));
        } else {
          spin.rotation.y = t * 1.8 + p.phase;
          p.obj.getObjectByName('ring')!.rotation.z = t * 1.2;
          const gyro = spin.getObjectByName('gyro');
          if (gyro) gyro.rotation.set(t * 1.9, t * 1.3, 0);
        }
      }
    }
    this.coins.count = this.rims.count = n;
    this.coins.instanceMatrix.needsUpdate = this.rims.instanceMatrix.needsUpdate = true;
    this.glow.geometry.setDrawRange(0, n);
    this.glow.geometry.attributes.position.needsUpdate = true;
    tickItemLooks(t);
  }

  private randomLaneX() {
    return laneX(Math.floor(this.rng() * LANES));
  }

  private range([min, max]: readonly [number, number]) {
    return min + this.rng() * (max - min);
  }
}
