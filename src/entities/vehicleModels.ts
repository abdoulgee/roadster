import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp } from '../util/math';
import { profile, superellipse } from '../util/shape';

// Procedural traffic models. Each model is merged into at most five material slots, so a vehicle is at
// most five draw calls, and geometry is built once per model and shared by every vehicle using it.
// Vehicles face -z (they drive the same way as the player), so their rear faces +z, towards the camera.

export type Slot = 'paint' | 'glass' | 'trim' | 'metal' | 'light';
export const SLOTS: readonly Slot[] = ['paint', 'glass', 'trim', 'metal', 'light'];
export type VehicleModel = Partial<Record<Slot, THREE.BufferGeometry>>;

/** 1 = full model; 0 = cheap stand-in for distant traffic. */
export type Detail = 0 | 1;

export type ModelKey = 'sedan' | 'hatch' | 'taxi' | 'suv' | 'bus' | `semi-${number}`;

/** A slot, optionally with a vertex colour (trim and light only) and an intensity for lights. */
type Finish = Slot | readonly [Slot, number] | readonly [Slot, number, number];
type Part = 'bottom' | 'cornerB' | 'side' | 'cornerT' | 'top';

const DARK: Finish = ['trim', 0x0d0e10];
const RUBBER: Finish = ['trim', 0x151517];
const PLASTIC: Finish = ['trim', 0x24262a];
const TAIL: Finish = ['light', 0xff1010, 1.25];
const HEAD: Finish = ['light', 0xf3f6ff, 1.6];
const AMBER: Finish = ['light', 0xffa21a, 1.6];

interface LoftSpec {
  z0: number;
  z1: number;
  step: number;
  hw(z: number): number;
  y0(z: number): number;
  y1(z: number): number;
  rb: number;
  rt: number;
  taper?: number;
  crown?: number;
  capFront?: readonly [length: number, exponent: number];
  capRear?: readonly [length: number, exponent: number];
  arches?: readonly { z: number; y: number; r: number }[];
  /** Extra stations, e.g. on window pillar edges, so finish boundaries stay crisp. */
  extraZ?: readonly number[];
  /** Heights where the flat side gets an extra row of vertices, e.g. window lines. */
  sideStops?: readonly number[];
  finish(centre: THREE.Vector3, normal: THREE.Vector3, part: Part, along: number): Finish;
}

// Points per part of the half cross-section, bottom centre round to top centre.
const PARTS: Record<Detail, readonly (readonly [Part, number])[]> = {
  1: [['bottom', 2], ['cornerB', 3], ['side', 3], ['cornerT', 4], ['top', 3]],
  0: [['bottom', 1], ['cornerB', 1], ['side', 1], ['cornerT', 2], ['top', 2]],
};

class Builder {
  private readonly parts = new Map<string, { finish: Finish; geos: THREE.BufferGeometry[] }>();

  constructor(readonly detail: Detail) {}

  add(finish: Finish, geo: THREE.BufferGeometry) {
    const [slot, hex = 0xffffff, intensity = 1] = typeof finish === 'string' ? [finish] : finish;
    const g = geo.index ? geo.toNonIndexed() : geo;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (slot === 'trim' || slot === 'light') {
      const c = new THREE.Color(hex).multiplyScalar(intensity);
      const colors = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    let entry = this.parts.get(slot);
    if (!entry) this.parts.set(slot, (entry = { finish, geos: [] }));
    entry.geos.push(g);
  }

  /** A rounded box; `mirror` adds a copy reflected across the centreline. */
  box(
    finish: Finish,
    [w, h, d]: readonly [number, number, number],
    [x, y, z]: readonly [number, number, number],
    o: { r?: number; rx?: number; ry?: number; rz?: number; mirror?: boolean } = {},
  ) {
    const r = Math.min(o.r ?? 0, w / 2, h / 2, d / 2) * 0.999;
    for (const side of o.mirror ? [1, -1] : [1]) {
      const smooth = this.detail && Math.max(w, h, d) > 0.6 ? 2 : 1;
      const geo = r > 0 ? new RoundedBoxGeometry(w, h, d, smooth, r) : new THREE.BoxGeometry(w, h, d);
      geo.rotateX(o.rx ?? 0).rotateY((o.ry ?? 0) * side).rotateZ((o.rz ?? 0) * side);
      this.add(finish, geo.translate(x * side, y, z));
    }
  }

  /** A cylinder lying along x (wheels, tanks). */
  cylinderX(finish: Finish, r: number, len: number, [x, y, z]: readonly [number, number, number], segments?: number) {
    const geo = new THREE.CylinderGeometry(r, r, len, segments ?? (this.detail ? 18 : 8)).rotateZ(Math.PI / 2);
    this.add(finish, geo.translate(x, y, z));
  }

  /**
   * A lofted body: a rounded-rectangle section swept along z, with superellipse end caps and wheel
   * arches cut from below. `finish` picks each triangle's material, so one surface carries paint,
   * glass and trim without seams.
   */
  loft(spec: LoftSpec) {
    const parts = PARTS[this.detail];
    const zs = this.stations(spec);
    const pos: number[] = [];
    const right: number[][] = [];
    const left: number[][] = [];
    let tags: [Part, number][] = [];
    let count = 0;
    for (const z of zs) {
      const s = this.section(spec, z, parts);
      tags = s.tags;
      const r: number[] = [];
      const l: number[] = [];
      for (const [x, y] of s.pts) {
        pos.push(x, y, z);
        r.push(count++);
        if (x < 1e-5) {
          l.push(r[r.length - 1]);
        } else {
          pos.push(-x, y, z);
          l.push(count++);
        }
      }
      right.push(r);
      left.push(l);
    }

    const tris: [number, number, number, Part, number][] = [];
    for (let i = 0; i < zs.length - 1; i++) {
      for (let j = 0; j < tags.length; j++) {
        const [part, along] = tags[j];
        const [a, b, c, d] = [right[i][j], right[i + 1][j], right[i + 1][j + 1], right[i][j + 1]];
        tris.push([a, d, b, part, along], [b, d, c, part, along]);
        const [e, f, g, h] = [left[i][j], left[i + 1][j], left[i + 1][j + 1], left[i][j + 1]];
        tris.push([e, f, h, part, along], [f, g, h, part, along]);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(tris.flatMap(([a, b, c]) => [a, b, c]));
    geo.computeVertexNormals();

    // Split the shared surface by finish.
    const groups = new Map<string, { finish: Finish; index: number[] }>();
    const va = new THREE.Vector3();
    const vb = new THREE.Vector3();
    const vc = new THREE.Vector3();
    const centre = new THREE.Vector3();
    const normal = new THREE.Vector3();
    for (const [a, b, c, part, along] of tris) {
      va.fromArray(pos, a * 3);
      vb.fromArray(pos, b * 3);
      vc.fromArray(pos, c * 3);
      centre.copy(va).add(vb).add(vc).divideScalar(3);
      normal.subVectors(vb, va).cross(vc.sub(va));
      if (normal.lengthSq() < 1e-14) continue; // zero-area sliver where a cap closes
      normal.normalize();
      const finish = spec.finish(centre, normal, part, along);
      const key = String(finish);
      let group = groups.get(key);
      if (!group) groups.set(key, (group = { finish, index: [] }));
      group.index.push(a, b, c);
    }
    for (const { finish, index } of groups.values()) {
      const part = new THREE.BufferGeometry();
      part.setAttribute('position', geo.attributes.position);
      part.setAttribute('normal', geo.attributes.normal);
      part.setIndex(index);
      this.add(finish, part.toNonIndexed());
    }
  }

  wheel(x: number, y: number, z: number, r: number, width: number, style: 'alloy' | 'steel' | 'truck') {
    const side = Math.sign(x);
    const hw = width / 2;
    const rim = r * (style === 'alloy' ? 0.66 : 0.6);
    const segs = this.detail ? 18 : 8;
    const tyre = new THREE.LatheGeometry(
      [
        [rim, -hw * 0.9],
        [r - 0.035, -hw],
        [r, -hw * 0.6],
        [r, hw * 0.6],
        [r - 0.035, hw],
        [rim, hw * 0.9],
      ].map(([a, b]) => new THREE.Vector2(a, b)),
      segs,
    ).rotateZ(-Math.PI / 2);
    this.add(RUBBER, tyre.translate(x, y, z));
    const face = x + side * hw * 0.82;
    const rimFinish: Finish = style === 'alloy' ? 'metal' : style === 'steel' ? ['trim', 0x9a9ea5] : ['trim', 0xb9bdc3];
    // A bright rim disc with a dark recess in front of it leaves a polished lip showing.
    this.cylinderX(rimFinish, rim, 0.03, [face, y, z], segs);
    this.cylinderX(DARK, rim * (style === 'alloy' ? 0.86 : 0.5), 0.02, [face + side * 0.006, y, z], segs);
    if (!this.detail) return;
    this.cylinderX(rimFinish, rim * 0.28, 0.06, [face + side * 0.02, y, z], 12);
    if (style === 'alloy') {
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        const spoke = new THREE.BoxGeometry(0.03, rim * 0.72, 0.055)
          .translate(0, rim * 0.5, 0)
          .rotateX(a)
          .translate(face + side * 0.022, y, z);
        this.add('metal', spoke);
      }
    }
  }

  build(): VehicleModel {
    const model: VehicleModel = {};
    for (const [slot, { geos }] of this.parts) {
      const merged = mergeGeometries(geos);
      merged.computeBoundingSphere();
      model[slot as Slot] = merged;
    }
    return model;
  }

  private stations(spec: LoftSpec) {
    const { z0, z1 } = spec;
    const zs = [...(spec.extraZ ?? [])];
    for (let z = z0; z < z1; z += spec.step) zs.push(z);
    const capSamples = this.detail ? 8 : 3;
    for (let k = 1; k <= capSamples; k++) {
      const e = 1 - Math.cos((k / capSamples) * (Math.PI / 2));
      if (spec.capFront) zs.push(z0 + spec.capFront[0] * e);
      if (spec.capRear) zs.push(z1 - spec.capRear[0] * e);
    }
    const archSamples = this.detail ? 14 : 5;
    for (const a of spec.arches ?? []) {
      for (let k = 0; k <= archSamples; k++) zs.push(a.z + a.r * Math.cos((k / archSamples) * Math.PI));
      zs.push(a.z - a.r - 0.004, a.z + a.r + 0.004);
    }
    zs.sort((a, b) => a - b);
    const out = [z0];
    for (const z of zs) if (z - out[out.length - 1] > 0.004 && z1 - z > 0.004) out.push(z);
    out.push(z1);
    return out;
  }

  private section(spec: LoftSpec, z: number, parts: readonly (readonly [Part, number])[]) {
    let y0 = spec.y0(z);
    for (const a of spec.arches ?? []) {
      const d = z - a.z;
      if (Math.abs(d) <= a.r) y0 = Math.max(y0, a.y + Math.sqrt(a.r * a.r - d * d));
    }
    const y1 = Math.max(spec.y1(z), y0 + 0.01);
    const hw = spec.hw(z);
    const h = y1 - y0;
    const rb = Math.min(spec.rb, h * 0.45, hw * 0.8);
    const rt = Math.min(spec.rt, h * 0.45, hw * 0.8);
    const point = (part: Part, t: number): [number, number] => {
      switch (part) {
        case 'bottom':
          return [(hw - rb) * t, y0];
        case 'cornerB': {
          const a = -Math.PI / 2 + (t * Math.PI) / 2;
          return [hw - rb + rb * Math.cos(a), y0 + rb + rb * Math.sin(a)];
        }
        case 'side':
          return [hw, y0 + rb + (h - rb - rt) * t];
        case 'cornerT': {
          const a = (t * Math.PI) / 2;
          return [hw - rt + rt * Math.cos(a), y1 - rt + rt * Math.sin(a)];
        }
        case 'top':
          return [(hw - rt) * (1 - t), y1];
      }
    };
    const tf = spec.capFront ? clamp((spec.z0 + spec.capFront[0] - z) / spec.capFront[0], 0, 1) : 0;
    const tr = spec.capRear ? clamp((z - spec.z1 + spec.capRear[0]) / spec.capRear[0], 0, 1) : 0;
    const sx =
      (spec.capFront ? superellipse(tf, spec.capFront[1]) : 1) * (spec.capRear ? superellipse(tr, spec.capRear[1]) : 1);
    const pts: [number, number][] = [];
    const tags: [Part, number][] = [];
    const sideLo = y0 + rb;
    const sideH = h - rb - rt;
    for (const [part, n] of parts) {
      let ts = Array.from({ length: n }, (_, i) => i / n);
      if (part === 'side' && spec.sideStops) {
        // Clamped rather than dropped, so every station keeps the same vertex count over the arches.
        const stops = spec.sideStops.map((y) => clamp((y - sideLo) / sideH, 0.001, 0.999));
        ts = [...ts, ...stops].sort((a, b) => a - b);
      }
      ts.forEach((t, i) => {
        pts.push(point(part, t));
        tags.push([part, (t + (ts[i + 1] ?? 1)) / 2]);
      });
    }
    pts.push([0, y1]);
    for (const p of pts) {
      const k = (p[1] - y0) / h;
      p[0] *= 1 - (spec.taper ?? 0) * k;
      p[1] += (spec.crown ?? 0) * (1 - (p[0] / hw) ** 2) * k;
      p[0] *= sx;
    }
    return { pts, tags };
  }
}

/** Glass everywhere on a cabin except the roof, pillars and rear quarters. */
function cabinFinish(roof: readonly [number, number], bPillar: readonly [number, number], rearQuarter: number, darkPillars = false) {
  return (c: THREE.Vector3, _n: THREE.Vector3, part: Part, along: number): Finish => {
    if (part === 'top' || (part === 'cornerT' && along > 0.5)) {
      if (c.z > roof[0] && c.z < roof[1]) return 'paint';
      return part === 'cornerT' ? (darkPillars ? DARK : 'paint') : 'glass';
    }
    if (c.z > bPillar[0] && c.z < bPillar[1]) return DARK;
    if (c.z > rearQuarter) return darkPillars ? DARK : 'paint';
    return 'glass';
  };
}

// ---------- cars ----------

function passengerCar(variant: 'sedan' | 'hatch' | 'taxi', detail: Detail) {
  const b = new Builder(detail);
  const hatch = variant === 'hatch';
  const wr = 0.33;
  const axles = [-1.42, 1.38];
  b.loft({
    z0: -2.3,
    z1: 2.3,
    step: detail ? 0.1 : 0.4,
    hw: profile([[-2.3, 0.88], [-1.85, 0.94], [-1.4, 0.95], [1.4, 0.95], [2.0, 0.94], [2.3, 0.92]]),
    y0: profile([[-2.3, 0.38], [-1.95, 0.3], [1.95, 0.3], [2.3, 0.38]]),
    y1: profile(
      hatch
        ? [[-2.3, 0.7], [-2.05, 0.8], [-1.4, 0.85], [-0.85, 0.88], [1.2, 0.92], [1.8, 0.95], [2.3, 0.93]]
        : [[-2.3, 0.7], [-2.05, 0.8], [-1.4, 0.85], [-0.85, 0.88], [1.3, 0.93], [1.7, 0.96], [2.18, 0.97], [2.3, 0.92]],
    ),
    rb: 0.1,
    rt: 0.09,
    taper: 0.08,
    crown: 0.03,
    capFront: [0.42, 2.6],
    capRear: [0.3, 3.6],
    arches: axles.map((z) => ({ z, y: wr, r: 0.4 })),
    finish: (_c, _n, part) => (part === 'bottom' || part === 'cornerB' ? DARK : 'paint'),
  });
  const cabinEnd = hatch ? 2.08 : 1.55;
  b.loft({
    z0: -0.9,
    z1: cabinEnd,
    step: detail ? 0.08 : 0.4,
    hw: profile([[-0.9, 0.86], [0, 0.85], [1.5, 0.82], [2.08, 0.8]]),
    y0: () => 0.85,
    y1: profile(
      hatch
        ? [[-0.9, 0.86], [-0.15, 1.36], [0.2, 1.42], [0.9, 1.39], [1.6, 1.2], [2.08, 0.92]]
        : [[-0.9, 0.86], [-0.15, 1.36], [0.15, 1.42], [0.75, 1.41], [1.15, 1.3], [1.55, 0.92]],
    ),
    rb: 0.01,
    rt: 0.13,
    taper: 0.26,
    crown: 0.04,
    extraZ: [-0.12, 0.27, 0.4, hatch ? 1.15 : 0.95],
    finish: cabinFinish(hatch ? [-0.12, 1.15] : [-0.12, 0.95], [0.27, 0.4], hatch ? 1.45 : 1.05, hatch),
  });

  b.box(DARK, [1.32, 0.48, 3.9], [0, 0.6, 0]); // fills the body so nothing shows through the arches
  // Front: grille, intake, slim headlights and indicators.
  b.box(DARK, [0.9, 0.12, 0.1], [0, 0.53, -2.27], { r: 0.03 });
  b.box(DARK, [1.36, 0.1, 0.1], [0, 0.4, -2.24], { r: 0.03 });
  b.box(HEAD, [0.4, 0.075, 0.1], [0.57, 0.67, -2.22], { ry: 0.3, mirror: true, r: 0.025 });
  b.box(AMBER, [0.1, 0.05, 0.08], [0.78, 0.62, -2.13], { ry: 0.6, mirror: true });
  // Rear: lamps, a light bar on the saloon, bumper and plate.
  b.box(TAIL, [0.44, 0.1, 0.1], [0.6, 0.84, 2.26], { mirror: true, r: 0.03 });
  b.box(TAIL, [0.12, 0.1, 0.24], [0.88, 0.84, 2.14], { mirror: true, r: 0.03 });
  if (!hatch) b.box(['light', 0xff1616, 1.4], [0.76, 0.03, 0.08], [0, 0.86, 2.275]);
  else b.box(TAIL, [0.5, 0.04, 0.06], [0, 1.0, 2.05], { rx: -0.5 }); // high brake lamp on the hatch
  b.box(DARK, [1.72, 0.17, 0.1], [0, 0.42, 2.26], { r: 0.04 });
  b.box(['trim', 0xdedcd2], [0.5, 0.11, 0.03], [0, 0.6, 2.305]);
  if (detail) b.box('paint', [0.15, 0.09, 0.12], [0.98, 0.97, -0.64], { mirror: true, r: 0.03 });
  if (variant === 'taxi') {
    b.box(DARK, [0.66, 0.04, 0.3], [0, 1.44, 0.32], { r: 0.015 });
    b.box(['light', 0xffcf3a, 1.3], [0.6, 0.14, 0.26], [0, 1.52, 0.32], { r: 0.04 });
  }
  for (const z of axles) for (const s of [-1, 1]) b.wheel(s * 0.8, wr, z, wr, 0.23, 'alloy');
  return b.build();
}

function suv(detail: Detail) {
  const b = new Builder(detail);
  const wr = 0.38;
  const axles = [-1.5, 1.45];
  const cladding: Finish = ['trim', 0x232427];
  b.loft({
    z0: -2.45,
    z1: 2.45,
    step: detail ? 0.1 : 0.4,
    hw: profile([[-2.45, 0.92], [-2.0, 0.99], [2.1, 1.0], [2.45, 0.98]]),
    y0: profile([[-2.45, 0.48], [-2.1, 0.4], [2.1, 0.4], [2.45, 0.5]]),
    y1: profile([[-2.45, 0.92], [-2.15, 1.02], [-1.0, 1.08], [-0.8, 1.1], [2.2, 1.14], [2.45, 1.1]]),
    rb: 0.12,
    rt: 0.1,
    taper: 0.05,
    crown: 0.02,
    capFront: [0.32, 3],
    capRear: [0.2, 5],
    arches: axles.map((z) => ({ z, y: wr, r: 0.47 })),
    sideStops: [0.66],
    finish: (c, _n, part) => (part === 'bottom' ? DARK : part === 'cornerB' || (part === 'side' && c.y < 0.66) ? cladding : 'paint'),
  });
  b.loft({
    z0: -0.98,
    z1: 2.43,
    step: detail ? 0.08 : 0.4,
    hw: profile([[-0.98, 0.94], [0.5, 0.93], [2.43, 0.9]]),
    y0: () => 1.06,
    y1: profile([[-0.98, 1.07], [-0.35, 1.76], [-0.05, 1.84], [2.2, 1.84], [2.36, 1.8], [2.43, 1.12]]),
    rb: 0.01,
    rt: 0.12,
    taper: 0.16,
    crown: 0.03,
    extraZ: [-0.1, 0.42, 0.56, 1.42, 1.54, 2.25, 2.3],
    finish: (c, n, part, along) => {
      if (c.z > 1.42 && c.z < 1.54 && part !== 'top') return DARK; // C-pillar
      if (c.z > 2.25 && part !== 'top' && !(part === 'cornerT' && along > 0.5)) return 'paint';
      return cabinFinish([-0.1, 2.3], [0.42, 0.56], 9)(c, n, part, along);
    },
  });

  b.box(DARK, [1.4, 0.55, 4.1], [0, 0.75, 0]);
  for (const s of [-1, 1]) b.box('metal', [0.05, 0.05, 2.3], [s * 0.72, 1.865, 0.95], { r: 0.02 });
  // Front: tall grille, headlamps, skid plate.
  b.box(DARK, [1.2, 0.28, 0.1], [0, 0.8, -2.44], { r: 0.04 });
  b.box(HEAD, [0.36, 0.1, 0.1], [0.66, 0.96, -2.4], { ry: 0.25, mirror: true, r: 0.03 });
  b.box('metal', [1.0, 0.08, 0.1], [0, 0.5, -2.43], { r: 0.03 });
  // Rear: wraparound lamps, bumper, plate, step.
  b.box(TAIL, [0.32, 0.2, 0.1], [0.74, 1.0, 2.43], { mirror: true, r: 0.04 });
  b.box(TAIL, [0.12, 0.18, 0.3], [0.94, 1.0, 2.28], { mirror: true, r: 0.04 });
  b.box(cladding, [1.8, 0.26, 0.12], [0, 0.6, 2.45], { r: 0.05 });
  b.box(['trim', 0xdedcd2], [0.5, 0.11, 0.03], [0, 0.85, 2.462]);
  if (detail) b.box('paint', [0.16, 0.11, 0.13], [1.03, 1.18, -0.75], { mirror: true, r: 0.03 });
  for (const z of axles) for (const s of [-1, 1]) b.wheel(s * 0.82, wr, z, wr, 0.27, 'alloy');
  return b.build();
}

// ---------- heavy vehicles ----------

function bus(detail: Detail) {
  const b = new Builder(detail);
  const L = 5.75;
  const wr = 0.5;
  const axles = [-3.55, 3.35];
  const pitch = 1.32;
  const first = -5.25;
  const pillars: number[] = [];
  for (let z = first; z < 5.2; z += pitch) pillars.push(z, z + 0.14);
  const livery: Finish = ['trim', 0xeeeee8];
  b.loft({
    z0: -L,
    z1: L,
    step: detail ? 0.12 : 0.8,
    hw: profile([[-L, 1.22], [-5.4, 1.25], [5.4, 1.25], [L, 1.23]]),
    y0: profile([[-L, 0.5], [L, 0.55]]),
    y1: () => 3.1,
    rb: 0.1,
    rt: 0.3,
    taper: 0.03,
    crown: 0.04,
    capFront: [0.24, 5],
    capRear: [0.2, 6],
    sideStops: [0.72, 1.2, 1.55, 2.0, 2.75, 2.85],
    arches: axles.map((z) => ({ z, y: wr, r: 0.62 })),
    extraZ: detail ? [...pillars, -5.1, -4.15] : [],
    finish: (c, n, part) => {
      if (part === 'bottom') return DARK;
      if (n.y > 0.7) return ['trim', 0xd4d6d9]; // roof
      if (n.z < -0.6) {
        if (c.y > 1.2 && c.y < 2.85 && Math.abs(c.x) < 1.12) return 'glass';
        return c.y < 0.78 ? DARK : 'paint';
      }
      if (n.z > 0.6) {
        if (c.y > 2.0 && c.y < 2.85 && Math.abs(c.x) < 1.0) return 'glass';
        if (c.y > 0.9 && c.y < 1.6 && Math.abs(c.x) < 0.8) return PLASTIC;
        return c.y < 0.78 ? DARK : c.y > 2.85 ? livery : 'paint';
      }
      if (c.y < 0.72) return DARK;
      const door = c.x > 0 && c.z > -5.1 && c.z < -4.15;
      if (door && c.y < 2.8) return Math.abs(c.z + 4.625) < 0.03 ? DARK : 'glass';
      const pillar = (((c.z - first) % pitch) + pitch) % pitch < 0.14;
      if (c.y > 1.55 && c.y < 2.75 && c.z > first && c.z < 5.2) return pillar ? DARK : 'glass';
      return c.y > 2.75 ? livery : 'paint';
    },
  });
  b.box(DARK, [1.9, 1.0, 10.6], [0, 1.1, 0]);
  b.box(['light', 0xffb43a, 1.6], [1.5, 0.2, 0.05], [0, 2.95, -L - 0.005], { r: 0.02 });
  b.box(HEAD, [0.3, 0.12, 0.08], [0.85, 0.92, -L], { mirror: true, r: 0.03 });
  b.box(TAIL, [0.14, 0.5, 0.08], [1.06, 1.1, L], { mirror: true, r: 0.03 });
  b.box(AMBER, [0.14, 0.14, 0.08], [1.06, 0.72, L], { mirror: true, r: 0.03 });
  b.box(DARK, [2.3, 0.22, 0.12], [0, 0.66, L + 0.02], { r: 0.05 });
  b.box(['trim', 0xdedcd2], [0.52, 0.12, 0.03], [0, 1.0, L + 0.012]);
  if (detail) {
    b.box(PLASTIC, [0.9, 0.24, 1.8], [0, 3.22, 1.2], { r: 0.08 }); // roof air-con pod
    b.box(DARK, [0.06, 0.06, 0.5], [1.32, 2.6, -5.3], { mirror: true, ry: 0.4 });
    b.box(DARK, [0.1, 0.42, 0.06], [1.5, 2.3, -5.48], { mirror: true, r: 0.02 });
  }
  for (const z of axles) {
    for (const s of [-1, 1]) {
      b.wheel(s * 1.0, wr, z, wr, 0.3, 'truck');
      if (z > 0) b.wheel(s * 0.7, wr, z, wr, 0.3, 'steel');
    }
  }
  return b.build();
}

const TRAILER_COLORS = [0xe8e9ea, 0xb9c0c9, 0x8a1f22, 0x2d4a6b];

function semi(trailerColor: number, detail: Detail) {
  const b = new Builder(detail);
  const wr = 0.5;
  // Cab-over tractor.
  b.loft({
    z0: -7.7,
    z1: -5.3,
    step: detail ? 0.1 : 0.6,
    hw: () => 1.2,
    y0: () => 0.62,
    y1: profile([[-7.7, 3.15], [-7.3, 3.25], [-5.3, 3.25]]),
    rb: 0.08,
    rt: 0.24,
    crown: 0.03,
    capFront: [0.34, 4],
    capRear: [0.06, 8],
    sideStops: [0.75, 0.95, 1.85, 2.05, 2.95, 3.0],
    arches: [{ z: -6.3, y: wr, r: 0.58 }],
    extraZ: [-7.35, -6.55],
    finish: (c, n, part) => {
      if (part === 'bottom') return DARK;
      if (n.z < -0.6) {
        if (c.y > 2.05 && c.y < 3.0 && Math.abs(c.x) < 1.08) return 'glass';
        if (c.y > 0.95 && c.y < 1.85 && Math.abs(c.x) < 0.85) return PLASTIC;
        return c.y < 0.95 ? ['trim', 0x3a3c40] : 'paint';
      }
      if (Math.abs(n.x) > 0.6 && c.y > 2.05 && c.y < 2.95 && c.z > -7.35 && c.z < -6.55) return 'glass';
      return c.y < 0.75 ? DARK : 'paint';
    },
  });
  b.box('paint', [2.3, 0.5, 1.7], [0, 3.48, -6.05], { r: 0.2 }); // roof fairing
  b.box(HEAD, [0.3, 0.14, 0.08], [0.85, 0.82, -7.69], { mirror: true, r: 0.03 });
  b.box(AMBER, [0.12, 0.06, 0.06], [0.5, 3.2, -7.66], { mirror: true });
  b.box('metal', [0.1, 0.7, 0.08], [1.24, 1.5, -7.0], { mirror: true, r: 0.02 }); // grab handles
  b.box(DARK, [0.08, 0.5, 0.06], [1.42, 2.4, -7.45], { mirror: true, r: 0.02 }); // mirrors
  // Chassis, tanks and fifth wheel between cab and trailer.
  b.box(DARK, [0.3, 0.3, 9.8], [0.45, 0.85, -0.6], { mirror: true });
  for (const s of [-1, 1]) {
    const tank = new THREE.CylinderGeometry(0.3, 0.3, 1.1, detail ? 16 : 8).rotateX(Math.PI / 2).translate(s * 1.0, 0.82, -4.75);
    b.add('metal', tank);
  }
  b.box(PLASTIC, [1.2, 0.08, 1.2], [0, 1.08, -3.6]);

  // Box trailer.
  b.loft({
    z0: -3.3,
    z1: 7.7,
    step: detail ? 0.25 : 1.2,
    hw: () => 1.25,
    y0: () => 1.15,
    y1: () => 4.0,
    rb: 0.04,
    rt: 0.06,
    capFront: [0.05, 8],
    capRear: [0.04, 8],
    finish: (c, n, part) => {
      if (part === 'bottom') return DARK;
      if (n.y > 0.7) return ['trim', 0xcfd2d6];
      if (n.z > 0.6) return Math.abs(c.x) < 0.02 ? DARK : ['trim', 0xc4c8cd]; // rear doors
      return ['trim', trailerColor];
    },
  });
  for (const s of [-1, 1]) {
    b.box('metal', [0.08, 2.85, 0.06], [s * 1.23, 2.58, 7.7]); // door frame posts
    if (detail) for (const y of [1.8, 3.4]) b.box('metal', [0.16, 0.06, 0.04], [s * 0.5, y, 7.72]); // hinges
    b.box(DARK, [0.04, 0.55, 5.4], [s * 1.2, 0.86, 1.6]); // side skirts
    b.box(DARK, [0.1, 0.85, 0.1], [s * 0.9, 0.72, -1.6]); // landing gear
  }
  b.box(DARK, [0.03, 2.8, 0.02], [0, 2.58, 7.705]); // door seam
  if (detail) for (const x of [-0.9, -0.32, 0.32, 0.9]) b.box('metal', [0.035, 2.7, 0.04], [x, 2.58, 7.715]); // lock bars
  b.box('metal', [2.1, 0.12, 0.1], [0, 0.58, 7.62]); // underride guard
  b.box(DARK, [2.5, 0.12, 0.2], [0, 1.1, 7.6]);
  b.box(TAIL, [0.26, 0.12, 0.05], [0.95, 0.98, 7.72], { mirror: true, r: 0.02 });
  b.box(AMBER, [0.1, 0.1, 0.05], [0.68, 0.98, 7.72], { mirror: true, r: 0.02 });
  b.box(TAIL, [0.6, 0.04, 0.04], [0, 3.95, 7.72]);
  for (const [z, dual] of [[-6.3, false], [-4.1, true], [-2.9, true], [5.1, true], [6.3, true]] as const) {
    for (const s of [-1, 1]) {
      b.wheel(s * 1.0, wr, z, wr, 0.3, 'truck');
      if (dual) b.wheel(s * 0.7, wr, z, wr, 0.3, 'steel');
    }
  }
  return b.build();
}

export function buildVehicleModel(key: ModelKey, detail: Detail): VehicleModel {
  if (key === 'suv') return suv(detail);
  if (key === 'bus') return bus(detail);
  if (key.startsWith('semi-')) return semi(TRAILER_COLORS[Number(key.slice(5)) % TRAILER_COLORS.length], detail);
  return passengerCar(key as 'sedan' | 'hatch' | 'taxi', detail);
}

export const TRAILER_VARIANTS = TRAILER_COLORS.length;
