import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { clamp } from '../util/math';
import { smoothstep, superellipse } from '../util/shape';
import type { PaintFinish, WheelFinish } from './finishes';

// The car-body engine. Every playable car is a `CarDesign` (see entities/cars/): side and plan profiles,
// glazing, lights and wheels. `buildCar` turns a design into a model with the interface Player drives.

export type CarId = 'roadster' | 'roadsterProto' | 'modelS' | 'model3' | 'modelX' | 'modelY' | 'cybertruck';

export interface CarModel {
  root: THREE.Group;
  wheels: THREE.Object3D[];
  spec: CarSpec;
  thrusters: Thrusters;
  /** Underside plume lengths in metres (0 = off), one per `thrusters.under` nozzle, plus boost flame power. */
  setJets(lengths: readonly number[], boost: number, time: number): void;
  /** Sideways cold-gas jets on the front wings, 0–1 each. */
  setSideJets(left: number, right: number): void;
  setPaintGlow(color: THREE.ColorRepresentation, intensity: number): void;
  /**
   * Moves the sprung body (shell, glass, cabin) against the wheels: `heave` in metres (+ up), `pitch` in
   * radians (+ nose up) and `roll` in radians.
   */
  setSuspension(heave: number, pitch: number, roll: number): void;
  /** Paint shop: repaints the body and wheels; null restores the design's factory finish. */
  setFinish(paint: PaintFinish | null, wheels: WheelFinish | null): void;
  /** How the smoke columns are lit: an overall tint and the sun they glow towards (world direction). */
  setSmokeLight(tint: THREE.Color, sunColor: THREE.Color, sunDir: THREE.Vector3): void;
}

/** @deprecated The roadster is now one `CarModel` among several. */
export type RoadsterModel = CarModel;

/** Size facts gameplay and the camera need about a car. */
export interface CarSpec {
  id: CarId;
  name: string;
  length: number;
  width: number;
  height: number;
  wheelRadius: number;
  /** Height of the centre of mass, which flips and rolls rotate about. */
  pivotY: number;
}

export type Nozzle = readonly [number, number, number];

/** Cold-gas nozzles in the car's frame (nose -z), shared with the smoke effects. */
export interface Thrusters {
  under: readonly Nozzle[];
  side(side: number): Nozzle;
  /** Rear nozzles (boost plume) and deck nozzles (slam blasts up). */
  rear: readonly Nozzle[];
  deck: readonly Nozzle[];
  /** Longest an underside plume gets when there is nothing below it to stop it (mid-roll), in metres. */
  maxJetLength: number;
  /** Underside jets lean back a little (the gas is left behind at speed) and splay apart slightly. */
  rake: number;
  fan: number;
  /** Unit direction of underside jet `i` in the car's frame. */
  underDir(i: number): Nozzle;
}

type Pt = readonly [number, number];
export type Quad = readonly [Pt, Pt, Pt, Pt];
export type Poly = readonly Pt[];
type Fn = (z: number) => number;

/**
 * Section control points along the car. Visible skin: sill edge E, lower side S1, widest point S2,
 * shoulder S3, belt / fender crown B, then T1, T2 and the centreline C across the hood, roof and deck.
 * `width` is S2's x; `scallop` insets S1; `tuck` pulls the sill edge in at the tail.
 */
export interface Profiles {
  width: Fn;
  sill: Fn;
  floor: Fn;
  tuck: Fn;
  scallop: Fn;
  s1y: Fn;
  s2y: Fn;
  s3y: Fn;
  bx: Fn;
  by: Fn;
  t1x: Fn;
  t1y: Fn;
  t2x: Fn;
  t2y: Fn;
  cy: Fn;
}

export type RimStyle = 'split' | 'turbine' | 'aero' | 'cyber' | 'blade';

/** `glow` is a hot nozzle throat that brightens with the boost flame. */
export type DecalMaterial = 'trim' | 'gap' | 'lens' | 'head' | 'tailLens' | 'tail' | 'chrome' | 'paint' | 'glow';

export interface Decal {
  material: DecalMaterial;
  quads: Quad[];
  lift?: number;
  /** Grid resolution along z and along v. */
  ns?: number;
  nt?: number;
}

/** What a design's `extras` hook gets to add one-off parts (splitters, fins, light bars…). */
export interface Kit {
  add(geo: THREE.BufferGeometry, material: DecalMaterial | 'under', name?: string): THREE.Mesh;
  /** A point on the visible skin at body coordinates (z, v), on the right-hand side. */
  surfacePoint(z: number, v: number): THREE.Vector3;
  design: CarDesign;
}

export interface CarDesign {
  id: CarId;
  name: string;
  /** One line for the garage. */
  tagline: string;
  paint: {
    color: number;
    metalness: number;
    roughness: number;
    clearcoat: number;
    clearcoatRoughness?: number;
    /** Brushed metal (stainless steel): 0–1. */
    anisotropy?: number;
  };
  /** Body ends and axle positions in metres; the nose faces -z. */
  nose: number;
  tail: number;
  axles: readonly [number, number];
  height: number;
  wheels: {
    radius: number;
    rim: number;
    /** Wheel centre x for the front and rear axles. */
    track: readonly [number, number];
    width: readonly [number, number];
    style: RimStyle;
    rimColor: number;
    /** Colour of the dish behind the spokes on covered styles (default: rimColor). */
    coverColor?: number;
    caliper: number;
  };
  archR: number;
  /** Arch height above the wheel centre at `dz` from it (default: a circle of radius archR). */
  arch?(dz: number): number;
  /** End caps: [length, superellipse exponent] for the plan-view rounding at each end. */
  noseCap: readonly [number, number];
  tailCap: readonly [number, number];
  /** How far the top/bottom of the tail ease in at the very end, and about which height. */
  tailRound?: number;
  tailRoundY?: number;
  /** Overhangs: lower points shift back at the nose / forward at the tail (see endLean). */
  lean: { nose: number; noseY: readonly [number, number]; tail: number; tailY: readonly [number, number] };
  P: Profiles;
  /** Flat panels with hard edges instead of smooth curves (straight lines between control points). */
  faceted?: boolean;
  /**
   * Straight panels between control points around the section, with hard creases where they meet
   * (angle in radians), but smooth shading along the car. Softer than `faceted`.
   */
  crease?: number;
  /** Station spacing along the car, metres. */
  step?: number;
  greenhouse: Poly;
  windows: Poly[];
  /** Colour of the dark canopy around the glass (roof, pillars). */
  canopyColor?: number;
  /** Tinted glazing: pane colour, and how mirror-like the panes and canopy are (gold visor glass). */
  glassTint?: { color: number; metalness: number };
  decals: Decal[];
  interior: { seatZ: number; seatX: number; seatY: number; dashZ: number; dashY: number; rearSeatZ?: number };
  /** Door mirrors at the front of the side glass (the Roadster prototype has none). */
  mirrors?: { z: number; housing: DecalMaterial };
  extras?(kit: Kit): void;
}

// v at each control point. Roughly arc length through the cabin, so (z, v) is close to metres there.
const VIS_V = [1.0, 1.14, 1.36, 1.54, 1.68, 1.93, 2.18, 2.56] as const;
const VIS_SEGS = [3, 5, 4, 4, 6, 5, 6] as const;
const UNDER_V = [0, 0.6, 0.7, 1.0] as const;
const UNDER_SEGS = [3, 2, 3] as const;
export const V_BELT = VIS_V[4];
export const V_TOP = VIS_V[7];

const smax = (a: number, b: number, k = 0.04) => 0.5 * (a + b + Math.sqrt((a - b) * (a - b) + k * k));

interface Section {
  vis: Pt[]; // E S1 S2 S3 B T1 T2 C
  under: Pt[]; // floor centre, floor edge, wheel-well top, E
}

/** Centripetal Catmull–Rom: passes through every control point without cusps or loops. */
function catmull(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const knot = (a: Pt, b: Pt) => Math.max(Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])), 1e-4);
  const t1 = knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const u = t1 + (t2 - t1) * t;
  const mix = (a: Pt, b: Pt, ta: number, tb: number): Pt => {
    const k = (u - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  };
  const a1 = mix(p0, p1, 0, t1);
  const a2 = mix(p1, p2, t1, t2);
  const a3 = mix(p2, p3, t2, t3);
  return mix(mix(a1, a2, 0, t2), mix(a2, a3, t1, t3), t1, t2);
}

function evalUnder(under: Pt[], v: number): Pt {
  let k = 0;
  while (k < UNDER_V.length - 2 && v > UNDER_V[k + 1]) k++;
  const t = clamp((v - UNDER_V[k]) / (UNDER_V[k + 1] - UNDER_V[k]), 0, 1);
  return [under[k][0] + (under[k + 1][0] - under[k][0]) * t, under[k][1] + (under[k + 1][1] - under[k][1]) * t];
}

function sampleV(knots: readonly number[], segs: readonly number[]) {
  const vs: number[] = [];
  segs.forEach((n, k) => {
    for (let s = 0; s < n; s++) vs.push(knots[k] + ((knots[k + 1] - knots[k]) * s) / n);
  });
  vs.push(knots[knots.length - 1]);
  return vs;
}

// ---------- body surface ----------
//
// The body is a loft: a half cross-section is defined at every z by a handful of control points whose
// positions are keyframed along the car, then mirrored. Each surface point therefore has natural (z, v)
// coordinates, where v runs around the section. Glass, lights and trim are cut or laid onto the body in
// that (z, v) space, so they always sit exactly on the surface.

export class Body {
  constructor(readonly d: CarDesign) {}

  // Snapped to exactly 1 at the very end: a steep superellipse turns a 1e-14 rounding error into a
  // visible gap down the middle of the nose.
  capFront(z: number) {
    const [len] = this.d.noseCap;
    const t = clamp((this.d.nose + len - z) / len, 0, 1);
    return t > 1 - 1e-9 ? 1 : t;
  }

  capRear(z: number) {
    const [len] = this.d.tailCap;
    const t = clamp((z - this.d.tail + len) / len, 0, 1);
    return t > 1 - 1e-9 ? 1 : t;
  }

  /**
   * Shears the caps along z by height, so the nose's leading edge and the tail's lip overhang a fascia
   * that tucks back underneath them. Monotonic in z, so stations never cross.
   */
  endLean(z: number, y: number) {
    const l = this.d.lean;
    return (
      l.nose * smoothstep(l.noseY[0], l.noseY[1], y) * this.capFront(z) ** 2 -
      l.tail * smoothstep(l.tailY[0], l.tailY[1], y) * this.capRear(z) ** 2
    );
  }

  archHeight(dz: number) {
    const r = this.d.archR;
    if (Math.abs(dz) > r) return -Infinity;
    return this.d.arch ? this.d.arch(dz) : Math.sqrt(r * r - dz * dz);
  }

  sectionAt(z: number): Section {
    const { P, wheels } = this.d;
    const w = P.width(z);
    let arch = -Infinity;
    let flare = 0;
    for (const a of this.d.axles) {
      const d = z - a;
      arch = Math.max(arch, wheels.radius + this.archHeight(d));
      flare = Math.max(flare, 1 - (d / (this.d.archR + 0.15)) ** 2);
    }
    const ey = Math.max(P.sill(z), arch);
    const ex = w - 0.045 + 0.035 * flare - P.tuck(z);
    const vis: [number, number][] = [
      [ex, ey],
      [w - P.scallop(z), smax(P.s1y(z), ey + 0.015)],
      [w, smax(P.s2y(z), ey + 0.035)],
      [w - 0.03, smax(P.s3y(z), ey + 0.06)],
      [P.bx(z), P.by(z)],
      [P.t1x(z), P.t1y(z)],
      [P.t2x(z), P.t2y(z)],
      [0, P.cy(z)],
    ];
    const wellX = Math.min(0.6, ex - 0.02);
    const floor = P.floor(z);
    const under: [number, number][] = [[0, floor], [wellX, floor], [wellX, ey], [ex, ey]];

    // Nose and tail caps: pull every point to the centreline along a superellipse, which rounds the
    // corners in plan view and closes the shell. The tail also eases its top and bottom edges in.
    const tf = this.capFront(z);
    const tt = this.capRear(z);
    const sx = superellipse(tf, this.d.noseCap[1]) * superellipse(tt, this.d.tailCap[1]);
    const cy = this.d.tailRoundY ?? 0.6;
    const sy = 1 - (this.d.tailRound ?? 0.07) * Math.pow(tt, 6);
    for (const p of [...vis, ...under]) {
      p[0] *= sx;
      p[1] = cy + (p[1] - cy) * sy;
    }
    return { vis, under };
  }

  evalVis(vis: Pt[], v: number): Pt {
    v = clamp(v, VIS_V[0], V_TOP);
    let k = 0;
    while (k < VIS_V.length - 2 && v > VIS_V[k + 1]) k++;
    const t = (v - VIS_V[k]) / (VIS_V[k + 1] - VIS_V[k]);
    if (this.d.faceted || this.d.crease) return [vis[k][0] + (vis[k + 1][0] - vis[k][0]) * t, vis[k][1] + (vis[k + 1][1] - vis[k][1]) * t];
    const p0: Pt = k === 0 ? [2 * vis[0][0] - vis[1][0], 2 * vis[0][1] - vis[1][1]] : vis[k - 1];
    // Mirror T2 across the centreline so the roof crosses it with a level tangent.
    const p3: Pt = k === VIS_V.length - 2 ? [-vis[k][0], vis[k][1]] : vis[k + 2];
    return catmull(p0, vis[k], vis[k + 1], p3, t);
  }

  /** Stations along the car: even spacing, denser over the end caps and around each wheel arch. */
  stations() {
    const { nose, tail, archR } = this.d;
    const zs: number[] = [];
    for (let z = nose; z < tail; z += this.d.step ?? 0.03) zs.push(z);
    for (let k = 0; k <= 16; k++) {
      const e = 1 - Math.cos((k / 16) * (Math.PI / 2));
      zs.push(nose + this.d.noseCap[0] * e, tail - this.d.tailCap[0] * e);
    }
    for (const a of this.d.axles) {
      for (let k = 0; k <= 36; k++) zs.push(a + archR * Math.cos((k / 36) * Math.PI));
      zs.push(a - archR - 0.004, a + archR + 0.004);
    }
    zs.sort((a, b) => a - b);
    const out = [nose];
    for (const z of zs) if (z - out[out.length - 1] > 0.003 && tail - z > 0.003) out.push(z);
    out.push(tail); // the caps close only on the exact end stations
    return out;
  }

  /** Builds both halves of a loft, welding vertices on the centreline so shading is seamless. */
  loftGeometry(zs: number[], vs: number[], pointAt: (s: Section, v: number) => Pt) {
    const pos: number[] = [];
    const uv: number[] = [];
    const right: number[][] = [];
    const left: number[][] = [];
    let count = 0;
    for (const z of zs) {
      const s = this.sectionAt(z);
      const r: number[] = [];
      const l: number[] = [];
      for (const v of vs) {
        const [x, y] = pointAt(s, v);
        const zl = z + this.endLean(z, y);
        pos.push(x, y, zl);
        uv.push(z, v);
        r.push(count++);
        if (x < 1e-5) {
          l.push(r[r.length - 1]);
        } else {
          pos.push(-x, y, zl);
          uv.push(z, v);
          l.push(count++);
        }
      }
      right.push(r);
      left.push(l);
    }
    const index: number[] = [];
    for (let i = 0; i < zs.length - 1; i++) {
      for (let j = 0; j < vs.length - 1; j++) {
        const [a, b, c, d] = [right[i][j], right[i + 1][j], right[i + 1][j + 1], right[i][j + 1]];
        index.push(a, d, b, b, d, c);
        const [e, f, g, h] = [left[i][j], left[i + 1][j], left[i + 1][j + 1], left[i][j + 1]];
        index.push(e, f, h, f, g, h);
      }
    }
    let geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(index);
    // Faceted bodies keep a hard normal per panel; smooth ones share normals across every seam.
    if (this.d.crease) return toCreasedNormals(geo, this.d.crease);
    if (this.d.faceted) geo = geo.toNonIndexed();
    geo.computeVertexNormals();
    return geo;
  }

  skin() {
    const zs = this.stations();
    return {
      outer: this.loftGeometry(zs, sampleV(VIS_V, VIS_SEGS), (s, v) => this.evalVis(s.vis, v)),
      under: this.loftGeometry(zs, sampleV(UNDER_V, UNDER_SEGS), (s, v) => evalUnder(s.under, v)),
    };
  }

  surfacePoint(z: number, v: number) {
    z = clamp(z, this.d.nose, this.d.tail);
    const [x, y] = this.evalVis(this.sectionAt(z).vis, v);
    return new THREE.Vector3(x, y, z + this.endLean(z, y));
  }

  surfaceNormal(z: number, v: number) {
    const e = 0.002;
    // Keep the z samples on the body: past the nose or tail they clamp together and the normal vanishes.
    z = clamp(z, this.d.nose + e, this.d.tail - e);
    const dv = this.surfacePoint(z, v + e).sub(this.surfacePoint(z, v - e));
    const dz = this.surfacePoint(z + e, v).sub(this.surfacePoint(z - e, v));
    const n = dv.cross(dz);
    return n.lengthSq() > 1e-14 ? n.normalize() : n.set(0, 1, 0);
  }

  /**
   * A skin laid over a (z, v) quad of the body on both sides, lifted `lift` metres along the surface
   * normal. Corners are ordered so a→b runs along z and a→d runs along v.
   */
  patchGeometry(quad: Quad, ns: number, nt: number, lift: number) {
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const index: number[] = [];
    const [a, b, c, d] = quad;
    // On creased bodies a patch row lands on every crease it spans (for quads with level v edges),
    // so the patch folds with the panel instead of cutting under it.
    let ts = Array.from({ length: nt + 1 }, (_, j) => j / nt);
    if ((this.d.crease || this.d.faceted) && a[1] === b[1] && d[1] === c[1] && a[1] !== d[1]) {
      const knots = VIS_V.map((k) => (k - a[1]) / (d[1] - a[1])).filter((t) => t > 1e-3 && t < 1 - 1e-3);
      ts = [...ts, ...knots].sort((x, y) => x - y).filter((t, i, all) => i === 0 || t - all[i - 1] > 1e-3);
    }
    nt = ts.length - 1;
    for (const side of [1, -1]) {
      const base = pos.length / 3;
      for (let j = 0; j <= nt; j++) {
        const t = ts[j];
        for (let i = 0; i <= ns; i++) {
          const s = i / ns;
          const z0 = a[0] + (b[0] - a[0]) * s;
          const v0 = a[1] + (b[1] - a[1]) * s;
          const z1 = d[0] + (c[0] - d[0]) * s;
          const v1 = d[1] + (c[1] - d[1]) * s;
          const z = z0 + (z1 - z0) * t;
          const v = clamp(v0 + (v1 - v0) * t, VIS_V[0], V_TOP);
          const n = this.surfaceNormal(z, v);
          const p = this.surfacePoint(z, v).addScaledVector(n, lift);
          pos.push(p.x * side, p.y, p.z);
          nor.push(n.x * side, n.y, n.z);
          uv.push(z, v);
        }
      }
      for (let j = 0; j < nt; j++) {
        for (let i = 0; i < ns; i++) {
          const p0 = base + j * (ns + 1) + i;
          const p1 = p0 + 1;
          const p3 = p0 + ns + 1;
          const p2 = p3 + 1;
          if (side > 0) index.push(p0, p3, p1, p1, p3, p2);
          else index.push(p0, p1, p3, p1, p2, p3);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(index);
    return geo;
  }
}

/** The (z, v) bounding box of a polygon, grown by `pad` and kept on the visible skin. */
function boundsQuad(poly: Poly, pad: number): Quad {
  const zs = poly.map((p) => p[0]);
  const vs = poly.map((p) => p[1]);
  const z0 = Math.min(...zs) - pad;
  const z1 = Math.max(...zs) + pad;
  const v0 = clamp(Math.min(...vs) - pad, VIS_V[0], V_TOP);
  const v1 = clamp(Math.max(...vs) + pad, VIS_V[0], V_TOP);
  return [[z0, v0], [z1, v0], [z1, v1], [z0, v1]];
}

// ---------- glazing masks ----------

const WINDOW_ROUND = 0.03;
const GREENHOUSE_ROUND = 0.05;
const REGION_OVERLAP = 0.012;

/** Signed distance to an n-gon (negative inside), for masking in the fragment shader. */
const sdPolyGlsl = (n: number) => /* glsl */ `
float sdPoly${n}(vec2 p, vec2 v[${n}]) {
  float dist = dot(p - v[0], p - v[0]);
  float s = 1.0;
  for (int i = 0, j = ${n - 1}; i < ${n}; j = i, i++) {
    vec2 e = v[j] - v[i];
    vec2 w = p - v[i];
    vec2 q = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    dist = min(dist, dot(q, q));
    bvec3 cond = bvec3(p.y >= v[i].y, p.y < v[j].y, e.x * w.y > e.y * w.x);
    if (all(cond) || all(not(cond))) s *= -1.0;
  }
  return s * sqrt(dist);
}
`;

const glslDistance = (polys: Poly[]) =>
  polys
    .map((q) => `sdPoly${q.length}(vBodyUv, vec2[${q.length}](${q.map(([z, v]) => `vec2(${z.toFixed(4)}, ${v.toFixed(4)})`).join(', ')}))`)
    .reduce((a, b) => `min(${a}, ${b})`);

interface Region {
  polys: Poly[];
  round: number;
}

/**
 * Discards fragments by their body (z, v) coordinate, keeping only what lies inside `inside` (if given)
 * and outside every region in `outside`. Regions have rounded corners. Materials that share the body
 * surface use complementary masks; the inner one grows by REGION_OVERLAP and wins the depth test with a
 * polygon offset, so no seam opens between them at grazing angles.
 */
function maskByBodyUv<T extends THREE.Material>(mat: T, key: string, inside: Region | null, outside: Region[]) {
  const regions = inside ? [inside, ...outside] : outside;
  const sizes = new Set(regions.flatMap((r) => r.polys.map((q) => q.length)));
  let test = inside ? `if (${glslDistance(inside.polys)} > ${(inside.round + REGION_OVERLAP).toFixed(3)}) discard;\n` : '';
  for (const r of outside) test += `if (${glslDistance(r.polys)} < ${r.round.toFixed(3)}) discard;\n`;
  const header = 'varying vec2 vBodyUv;\n' + [...sizes].map(sdPolyGlsl).join('');
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader =
      'varying vec2 vBodyUv;\n' + shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvBodyUv = uv;');
    shader.fragmentShader =
      header + shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${test}`);
  };
  mat.customProgramCacheKey = () => `car-${key}`;
  return mat;
}

// ---------- wheels ----------

let tyreGrain: THREE.Texture | null = null;

/** Fine, repeating rubber grain for the tyre sidewalls and tread. */
function tyreGrainMap() {
  if (tyreGrain) return tyreGrain;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#858585';
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 2400; i++) {
    const value = 95 + Math.random() * 90;
    ctx.fillStyle = `rgb(${value},${value},${value})`;
    const size = Math.random() < 0.92 ? 1 : 2;
    ctx.fillRect(Math.random() * 128, Math.random() * 128, size, size);
  }
  tyreGrain = new THREE.CanvasTexture(canvas);
  tyreGrain.wrapS = tyreGrain.wrapT = THREE.RepeatWrapping;
  tyreGrain.repeat.set(2, 2);
  tyreGrain.anisotropy = 4;
  tyreGrain.generateMipmaps = true;
  tyreGrain.needsUpdate = true;
  return tyreGrain;
}

function latheX(points: Pt[], segments: number) {
  const geo = new THREE.LatheGeometry(
    points.map(([r, a]) => new THREE.Vector2(r, a)),
    segments,
  );
  return geo.rotateZ(-Math.PI / 2); // lathe axis y → axle x
}

/** Low-profile tyre; +x is the outer sidewall. */
function tyreGeometry(width: number, r: number, rim: number) {
  const h = width / 2;
  const wall = r - rim;
  const pts: Pt[] = [
    [rim + 0.004, -h * 0.82], [rim + wall * 0.28, -h * 0.95], [r - wall * 0.45, -h], [r - 0.018, -h * 0.97], [r - 0.004, -h * 0.86],
    [r, -h * 0.7], [r, -h * 0.32], [r - 0.006, -h * 0.29], [r - 0.006, -h * 0.2], [r, -h * 0.17],
    [r, h * 0.17], [r - 0.006, h * 0.2], [r - 0.006, h * 0.29], [r, h * 0.32], [r, h * 0.7],
    [r - 0.004, h * 0.86], [r - 0.018, h * 0.97], [r - wall * 0.45, h], [rim + wall * 0.28, h * 0.95], [rim + 0.004, h * 0.82],
  ];
  return latheX(pts, 56);
}

interface SpokeSpec {
  count: number;
  /** Paired spokes (two per position, splayed apart) or single ones. */
  paired: boolean;
  hubWidth: number;
  rimWidth: number;
  splay: number;
  twist: number;
  dish: number;
  depth: number;
}

/** Spokes from hub to rim, dished so the hub sits back from the rim lip. */
function spokeGeometry(face: number, rimR: number, s: SpokeSpec) {
  const r0 = 0.068;
  const r1 = rimR + 0.004; // tucked under the lip so the spokes visibly meet the rim
  const parts: THREE.BufferGeometry[] = [];
  const polar = (r: number, a: number) => new THREE.Vector2(r * Math.cos(a), r * Math.sin(a));
  for (let k = 0; k < s.count; k++) {
    const base = (k / s.count) * Math.PI * 2;
    for (const dir of s.paired ? [-1, 1] : [0]) {
      const hub = polar(r0, base + dir * s.splay * 0.45);
      const rim = polar(r1, base + dir * s.splay + s.twist);
      const along = rim.clone().sub(hub).normalize();
      const across = new THREE.Vector2(-along.y, along.x);
      const mid = hub.clone().lerp(rim, 0.5).addScaledVector(across, 0.008);
      const shape = new THREE.Shape();
      const p = (v: THREE.Vector2, w: number) => v.clone().addScaledVector(across, w);
      const midW = (s.hubWidth + s.rimWidth) / 2;
      shape.moveTo(p(hub, s.hubWidth).x, p(hub, s.hubWidth).y);
      shape.quadraticCurveTo(p(mid, midW).x, p(mid, midW).y, p(rim, s.rimWidth).x, p(rim, s.rimWidth).y);
      shape.lineTo(p(rim, -s.rimWidth).x, p(rim, -s.rimWidth).y);
      shape.quadraticCurveTo(p(mid, -midW).x, p(mid, -midW).y, p(hub, -s.hubWidth).x, p(hub, -s.hubWidth).y);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: s.depth,
        bevelEnabled: true,
        bevelThickness: 0.005,
        bevelSize: 0.004,
        bevelSegments: 2,
        curveSegments: 6,
      });
      geo.rotateY(Math.PI / 2); // extrude along the axle
      geo.translate(face - s.depth, 0, 0);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const r = Math.hypot(pos.getY(i), pos.getZ(i));
        pos.setX(i, pos.getX(i) - s.dish * (1 - clamp((r - r0) / (r1 - r0), 0, 1)));
      }
      geo.computeVertexNormals();
      parts.push(geo);
    }
  }
  return mergeGeometries(parts);
}

const SPOKES: Record<RimStyle, SpokeSpec> = {
  // Roadster: five split pairs.
  split: { count: 5, paired: true, hubWidth: 0.012, rimWidth: 0.017, splay: 0.2, twist: 0.05, dish: 0.04, depth: 0.024 },
  // Model S / X: ten slim straight spokes.
  turbine: { count: 10, paired: false, hubWidth: 0.012, rimWidth: 0.02, splay: 0, twist: 0.12, dish: 0.03, depth: 0.022 },
  // Model 3 / Y: an aero cover with five broad swept blades.
  aero: { count: 5, paired: false, hubWidth: 0.03, rimWidth: 0.06, splay: 0, twist: 0.5, dish: 0.012, depth: 0.012 },
  // Cybertruck: a flat cover with six shallow ribs.
  cyber: { count: 6, paired: false, hubWidth: 0.02, rimWidth: 0.03, splay: 0, twist: 0, dish: 0.006, depth: 0.01 },
  // Roadster (2026): five broad twisted blades over a pale dish.
  blade: { count: 5, paired: false, hubWidth: 0.04, rimWidth: 0.05, splay: 0, twist: 0.42, dish: 0.03, depth: 0.026 },
};

function rimGeometries(width: number, rimR: number, style: RimStyle) {
  const h = width / 2;
  const face = h * 0.62;
  const lip = latheX(
    [[rimR - 0.016, face - 0.004], [rimR - 0.004, face + 0.006], [rimR + 0.012, face + 0.004], [rimR + 0.016, face - 0.012]],
    56,
  );
  const barrel = latheX([[rimR - 0.012, -h * 0.8], [rimR - 0.016, face - 0.01]], 40);
  const hub = new THREE.CylinderGeometry(0.075, 0.082, 0.05, 28).rotateZ(Math.PI / 2).translate(face - 0.065, 0, 0);
  const cap = new THREE.CylinderGeometry(0.034, 0.038, 0.016, 24).rotateZ(Math.PI / 2).translate(face - 0.034, 0, 0);
  const nuts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.3;
    nuts.push(
      new THREE.CylinderGeometry(0.0095, 0.0095, 0.02, 6)
        .rotateZ(Math.PI / 2)
        .translate(face - 0.038, Math.cos(a) * 0.052, Math.sin(a) * 0.052),
    );
  }
  const parts = [spokeGeometry(face, rimR, SPOKES[style]), hub.toNonIndexed(), ...nuts.map((g) => g.toNonIndexed())];
  // Covered wheels: a shallow dish fills the gaps between the blades.
  const cover =
    style === 'aero' || style === 'cyber' || style === 'blade'
      ? latheX([[0.07, face - 0.05], [rimR * 0.6, face - 0.03], [rimR - 0.006, face - 0.012]], style === 'cyber' ? 6 : 48)
      : null;
  const spokes = mergeGeometries(parts);
  const discR = Math.min(0.19, rimR - 0.06);
  const disc = mergeGeometries([
    new THREE.CylinderGeometry(discR, discR, 0.026, 40).rotateZ(Math.PI / 2).translate(-0.03, 0, 0),
    new THREE.CylinderGeometry(0.1, 0.1, 0.06, 24).rotateZ(Math.PI / 2),
  ]);
  return { lip, barrel, spokes, cap, disc, cover };
}

function caliperGeometry(rimR: number) {
  const k = rimR / 0.255;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, 0.205 * k, -0.55, 0.55, false);
  shape.absarc(0, 0, 0.14 * k, 0.55, -0.55, true);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.05,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.008,
    bevelSegments: 2,
    curveSegments: 10,
  });
  return geo.rotateY(Math.PI / 2).translate(-0.055, 0, 0);
}

// ---------- thruster smoke ----------

const PLUME_NOISE = /* glsl */ `
  uniform float time;
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      s += a * noise(p);
      p = p * 2.03 + vec3(1.7, 9.2, 3.1);
      a *= 0.5;
    }
    return s;
  }
  // Billows in the jet's own frame (metres, nozzle at the origin, gas flowing down -y). The lumps
  // stream away from the nozzle and grow as the gas expands, so they're small at the neck.
  float billow(vec3 lp, float t) {
    float grow = 1.0 / (0.3 + t * 1.4);
    // Along the jet the grain is finer still (squared growth), so the gas reads as streaming lumps.
    // The flow offset is added after scaling, so the same scroll rate carries the bigger lumps lower
    // down faster, as the gas accelerates out of the nozzle.
    return fbm(vec3(lp.x * grow * 1.7, lp.y * (0.8 * grow + 4.0 * grow * grow) + time * 40.0, lp.z * grow * 1.7));
  }
`;

const PLUME_VERTEX = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vSeed;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vWorld;
  varying float vT;
  ${PLUME_NOISE}
  void main() {
    vec3 scale = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
    vT = uv.y; // 0 at the nozzle, 1 at the far end
    vSeed = modelMatrix[3].xyz * 1.3; // each nozzle gets its own billows
    vLocal = position * scale;
    // Push the surface in and out with the billows so the silhouette is lumpy, not a clean cone.
    vec3 radial = normalize(vec3(position.x, 0.0, position.z));
    float b = billow(vLocal + vSeed, vT);
    vec3 p = position + radial * (b - 0.45) * vT * 0.9;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vView = -mv.xyz;
    vWorld = (modelMatrix * vec4(p, 1.0)).xyz;
    vNormal = normalize(normalMatrix * radial);
    gl_Position = projectionMatrix * mv;
  }
`;

const PLUME_FRAGMENT = /* glsl */ `
  uniform vec3 uTint;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  varying vec3 vLocal;
  varying vec3 vSeed;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vWorld;
  varying float vT;
  ${PLUME_NOISE}
  void main() {
    float t = vT;
    float b = billow(vLocal + vSeed, t);
    vec3 n = normalize(vNormal);
    // How square-on we see this bit of the column: solid through the middle, thinning to a wispy rim.
    float facing = abs(dot(n, normalize(vView)));
    float rim = smoothstep(0.0, 0.5 + 0.3 * t, facing + (b - 0.5) * 0.6 * t);
    // A dense neck that breaks up into thick and thin billows further out.
    float body = mix(1.0, smoothstep(0.18, 0.6, b), 0.7 * smoothstep(0.05, 0.6, t));
    float ends = smoothstep(0.0, 0.03, t) * (1.0 - smoothstep(0.8, 1.0, t));
    // Kept thin: from behind, four double-sided columns stack about eight layers deep.
    float a = clamp(rim * body * ends * 0.26, 0.0, 1.0);
    if (a < 0.01) discard;
    // Lit from above: billow tops catch the light, the folds go a cool lavender grey.
    float shade = clamp(0.45 + 0.6 * b + 0.18 * n.y - 0.12 * t, 0.0, 1.0);
    vec3 color = mix(vec3(0.6, 0.63, 0.78), vec3(1.0), shade);
    color = mix(vec3(0.95, 0.97, 1.0), color, smoothstep(0.0, 0.15, t));
    // The zone's light: full white by day, cooler and dimmer under a night sky.
    color *= uTint;
    // Looking towards the sun, the thin gas at the edges scatters it forwards and glows.
    float toSun = pow(max(dot(normalize(vWorld - cameraPosition), uSunDir), 0.0), 6.0);
    color += uSunColor * toSun * (1.0 - facing) * 0.9;
    gl_FragColor = vec4(color * 0.82, a);
    #include <colorspace_fragment>
  }
`;

/** Shared by every plume; `time` drives the gas flowing down them. */
function plumeMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: PLUME_VERTEX,
    fragmentShader: PLUME_FRAGMENT,
    uniforms: {
      time: { value: 0 },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uSunColor: { value: new THREE.Color(0, 0, 0) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * A smoke column one metre long down -y from the nozzle (scale.y sets its length): a tight neck
 * flaring out to `r1` at the far end. uv.y runs 0 at the nozzle to 1 at the end.
 */
function plumeGeometry(r0: number, r1: number) {
  const points: THREE.Vector2[] = [];
  const steps = 28;
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    points.push(new THREE.Vector2(r0 + (r1 - r0) * (0.25 * Math.sqrt(t) + 0.75 * Math.pow(t, 1.4)), -t));
  }
  return new THREE.LatheGeometry(points, 32);
}

function jetMaterial(color: number) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
}

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/** Nozzles placed from the design: two under each axle's overhang side, one on each front wing. */
function thrustersFor(d: CarDesign): Thrusters {
  const [front, rear] = d.axles;
  const zf = front + 0.33;
  const zr = rear + 0.28;
  const zs = front + 0.63;
  const under: Nozzle[] = [
    [-0.6, d.P.floor(zf) + 0.07, zf],
    [0.6, d.P.floor(zf) + 0.07, zf],
    [-0.6, d.P.floor(zr) + 0.12, zr],
    [0.6, d.P.floor(zr) + 0.12, zr],
  ];
  const rake = 0.35;
  const fan = 0.1;
  const dirs = under.map(([x]) => {
    const dir = new THREE.Vector3(0, -1, 0).applyAxisAngle(X_AXIS, -rake).applyAxisAngle(Z_AXIS, -Math.sign(x) * fan);
    return [dir.x, dir.y, dir.z] as const;
  });
  const sideX = d.P.width(zs) + 0.04;
  const sideY = (d.P.s2y(zs) + d.P.s3y(zs)) / 2;
  const boostY = Math.min(0.3, d.P.sill(d.tail - 0.1) - 0.08);
  const zd = d.tail - 0.62;
  return {
    under,
    side: (side) => [side * sideX, sideY, zs],
    rear: [-1, 1].map((s) => [s * 0.35, boostY, d.tail - 0.06] as const),
    deck: [-1, 1].map((s) => [s * 0.5, d.P.by(zd) + 0.08, zd] as const),
    maxJetLength: 7,
    rake,
    fan,
    underDir: (i) => dirs[i],
  };
}

// ---------- paint ----------

let flakeMap: THREE.DataTexture | null = null;

/**
 * Metallic flake: a tangent-space normal map of tiny randomly tilted platelets for the base coat only.
 * The clear coat keeps the smooth geometric normal, so reflections stay crisp while the colour coat
 * glitters up close and averages out (via mipmaps) into a soft sheen at a distance.
 */
function paintFlakes() {
  if (flakeMap) return flakeMap;
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < size * size; i++) {
    // Mostly level flakes, a few steep ones that catch the light.
    const tilt = Math.pow(rnd(), 2.2) * 0.9;
    const a = rnd() * Math.PI * 2;
    const x = Math.sin(tilt) * Math.cos(a);
    const y = Math.sin(tilt) * Math.sin(a);
    const z = Math.cos(tilt);
    data.set([(x * 0.5 + 0.5) * 255, (y * 0.5 + 0.5) * 255, (z * 0.5 + 0.5) * 255, 255], i * 4);
  }
  flakeMap = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  flakeMap.wrapS = flakeMap.wrapT = THREE.RepeatWrapping;
  flakeMap.magFilter = THREE.LinearFilter;
  flakeMap.minFilter = THREE.LinearMipmapLinearFilter;
  flakeMap.generateMipmaps = true;
  flakeMap.anisotropy = 4;
  // Body uv is (z, v) in metres: one tile every 40 cm puts a flake at about 1.5 mm.
  flakeMap.repeat.set(2.5, 2.5);
  flakeMap.needsUpdate = true;
  return flakeMap;
}

/** Metallic paints get flake in the base coat; solid whites, chrome and brushed steel stay plain. */
const flaked = (p: PaintFinish) => p.metalness >= 0.2 && p.metalness < 0.9 && !p.anisotropy;

// ---------- the car ----------

export function buildCar(d: CarDesign): CarModel {
  const body = new Body(d);
  const root = new THREE.Group();
  const GLASS: Region = { polys: d.windows, round: WINDOW_ROUND };
  const CANOPY: Region = { polys: [d.greenhouse], round: GREENHOUSE_ROUND };
  const key = (k: string) => `${d.id}-${k}`;

  // Decals win the depth test against the paint they sit on, whatever the tessellation.
  const decalBias = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 };
  const paintSpec = {
    // Soft metallic base coat under a sharp clear coat: the clear coat carries the reflections.
    color: d.paint.color,
    metalness: d.paint.metalness,
    roughness: d.paint.roughness,
    specularIntensity: 0.5,
    clearcoat: d.paint.clearcoat,
    clearcoatRoughness: d.paint.clearcoatRoughness ?? 0.03,
    anisotropy: d.paint.anisotropy ?? 0,
    normalMap: flaked(d.paint) ? paintFlakes() : null,
    normalScale: new THREE.Vector2(0.22, 0.22),
  };
  const paint = maskByBodyUv(new THREE.MeshPhysicalMaterial(paintSpec), key('paint'), null, [CANOPY, GLASS]);
  const cabinShell = maskByBodyUv(
    new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.8, side: THREE.BackSide }),
    key('cabin'),
    null,
    [GLASS],
  );
  const canopy = maskByBodyUv(
    new THREE.MeshPhysicalMaterial({
      color: d.canopyColor ?? 0x030304,
      metalness: d.glassTint?.metalness ?? 0,
      roughness: 0.1,
      clearcoat: 0.5,
      clearcoatRoughness: 0.02,
      ...decalBias,
    }),
    key('canopy'),
    CANOPY,
    [GLASS],
  );
  const glass = maskByBodyUv(
    new THREE.MeshPhysicalMaterial({
      color: d.glassTint?.color ?? 0x080b10,
      metalness: d.glassTint?.metalness ?? 0.1,
      roughness: 0.04,
      transparent: true,
      opacity: 0.68,
      ...decalBias,
    }),
    key('glass'),
    GLASS,
    [],
  );
  const under = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.9 });
  const lens = new THREE.MeshPhysicalMaterial({ color: 0x0a0c10, metalness: 0.6, roughness: 0.14, clearcoat: 1, ...decalBias });
  const tailLens = new THREE.MeshPhysicalMaterial({ color: 0x2a0407, metalness: 0.3, roughness: 0.12, clearcoat: 1, ...decalBias });
  const decalMats: Record<DecalMaterial, THREE.Material> = {
    trim: new THREE.MeshStandardMaterial({ color: 0x0e0f11, roughness: 0.55, metalness: 0.1, ...decalBias }),
    gap: new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.7, ...decalBias }),
    lens,
    head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeaf4ff, emissiveIntensity: 2.4, ...decalBias }),
    tailLens,
    tail: new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1a2a, emissiveIntensity: 3, ...decalBias }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xd6d9de, metalness: 1, roughness: 0.18, ...decalBias }),
    paint: new THREE.MeshPhysicalMaterial({ ...paintSpec, ...decalBias }),
    glow: new THREE.MeshStandardMaterial({ color: 0x150806, roughness: 0.6, emissive: 0xff6a2a, emissiveIntensity: 0.25, ...decalBias }),
  };
  const tyre = new THREE.MeshStandardMaterial({
    color: 0x141416,
    roughness: 0.88,
    bumpMap: tyreGrainMap(),
    bumpScale: 0.008,
  });
  const rim = new THREE.MeshStandardMaterial({ color: d.wheels.rimColor, metalness: 0.85, roughness: 0.3 });
  const coverMat = new THREE.MeshStandardMaterial({ color: d.wheels.coverColor ?? d.wheels.rimColor, metalness: 0.5, roughness: 0.45, side: THREE.DoubleSide });
  const machined = new THREE.MeshStandardMaterial({ color: 0xb4b8bf, metalness: 1, roughness: 0.22, side: THREE.DoubleSide });
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x1c1d20, metalness: 0.7, roughness: 0.5, side: THREE.DoubleSide });
  const discMat = new THREE.MeshStandardMaterial({ color: 0x6d7076, metalness: 0.9, roughness: 0.42 });
  const caliperMat = new THREE.MeshPhysicalMaterial({ color: d.wheels.caliper, roughness: 0.35, clearcoat: 0.8 });
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x121316, roughness: 0.65 });
  const dashMat = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.7 });

  const group = new THREE.Group();
  group.name = 'body';
  root.add(group);
  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, name = '') => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    parent.add(mesh);
    return mesh;
  };

  // Shell: painted outside, dark cabin trim inside, black underbody and wheel wells.
  const skin = body.skin();
  const shell = add(group, skin.outer, paint, 'paint');
  shell.castShadow = true;

  // The scene environment is kept dim for the world. Materials only honour envMapIntensity with their own
  // envMap, so the car's paint and glass adopt the scene's map and take a stronger share of it.
  // Paint and brightwork reflect the car's own map, the sky plus studio light strips (see Environment);
  // the glass keeps the plain sky, where the strips would read as odd bright loops on the curved panes.
  const reflective: [THREE.MeshStandardMaterial, number, boolean][] = [
    [paint, 1.8, true],
    [canopy, 1.6, false],
    [glass, 2.4, false],
    [lens, 2.5, true],
    [tailLens, 2.2, true],
    [decalMats.chrome as THREE.MeshStandardMaterial, 2, true],
    [decalMats.paint as THREE.MeshStandardMaterial, 1.8, true],
  ];
  shell.onBeforeRender = (_renderer, scene) => {
    const studio = (scene.userData.carEnvironment as THREE.Texture | undefined) ?? scene.environment;
    for (const [m, boost, lit] of reflective) {
      const env = lit ? studio : scene.environment;
      if (m.envMap !== env) {
        m.envMap = env;
        m.needsUpdate = true;
      }
      m.envMapIntensity = scene.environmentIntensity * boost;
    }
  };
  add(group, skin.outer, cabinShell, 'cabin-shell').receiveShadow = true;
  add(group, skin.under, under, 'underbody').castShadow = true;

  // Canopy and glass are skins over the same surface, so they meet the paint with no seam.
  add(group, body.patchGeometry(boundsQuad(d.greenhouse, GREENHOUSE_ROUND + 0.03), 56, 20, 0.002), canopy, 'canopy');
  const panes = d.windows.map((w) => body.patchGeometry(boundsQuad(w, WINDOW_ROUND + 0.025), 28, 12, 0.002));
  add(group, mergeGeometries(panes), glass, 'glass').renderOrder = 1;

  // Lights and trim laid onto the paint.
  for (const decal of d.decals) {
    const geos = decal.quads.map((q) => body.patchGeometry(q, decal.ns ?? 24, decal.nt ?? 3, decal.lift ?? 0.003));
    add(group, mergeGeometries(geos), decalMats[decal.material], decal.material);
  }

  if (d.mirrors) {
    // A stalk out of the door top and a teardrop housing with a dark glass face towards the back.
    const { z, housing } = d.mirrors;
    const p = body.surfacePoint(z, V_BELT + 0.01);
    const shell = new RoundedBoxGeometry(0.09, 0.11, 0.2, 3, 0.04);
    const face = new THREE.PlaneGeometry(0.075, 0.085);
    const stalk = new THREE.BoxGeometry(0.1, 0.025, 0.05);
    for (const side of [-1, 1]) {
      const m = new THREE.Group();
      m.position.set(side * p.x, p.y + 0.05, p.z);
      m.rotation.y = side * 0.12;
      const h = add(m, shell, decalMats[housing], 'mirror');
      h.position.set(side * 0.15, 0.03, 0);
      h.castShadow = true;
      add(m, face, decalMats.lens, 'mirror-glass').position.set(side * 0.15, 0.03, 0.101);
      add(m, stalk, decalMats.trim, 'mirror-stalk').position.set(side * 0.05, 0, 0.02);
      group.add(m);
    }
  }

  d.extras?.({
    add: (geo, material, name = '') => add(group, geo, material === 'under' ? under : decalMats[material], name),
    surfacePoint: (z, v) => body.surfacePoint(z, v),
    design: d,
  });

  // Cabin: low dark seats, dashboard, console and a yoke, enough to read through the glass.
  const cabin = new THREE.Group();
  cabin.name = 'interior';
  root.add(cabin);
  const { seatZ, seatX, seatY, dashZ, dashY, rearSeatZ } = d.interior;
  const cushion = new RoundedBoxGeometry(0.46, 0.1, 0.5, 3, 0.04);
  const back = new RoundedBoxGeometry(0.46, 0.66, 0.12, 3, 0.05);
  for (const x of [-seatX, seatX]) {
    add(cabin, cushion, seatMat).position.set(x, seatY, seatZ);
    const b = add(cabin, back, seatMat);
    b.position.set(x, seatY + 0.3, seatZ + 0.31);
    b.rotation.x = -0.28;
  }
  if (rearSeatZ !== undefined) {
    add(cabin, new RoundedBoxGeometry(1.3, 0.12, 0.5, 3, 0.05), seatMat).position.set(0, seatY + 0.04, rearSeatZ);
    const bench = add(cabin, new RoundedBoxGeometry(1.3, 0.6, 0.12, 3, 0.05), seatMat);
    bench.position.set(0, seatY + 0.34, rearSeatZ + 0.3);
    bench.rotation.x = -0.25;
  }
  const dash = add(cabin, new RoundedBoxGeometry(1.42, 0.16, 0.42, 3, 0.05), dashMat);
  dash.position.set(0, dashY, dashZ);
  dash.rotation.x = 0.12;
  add(cabin, new RoundedBoxGeometry(0.2, 0.16, 0.95, 2, 0.04), dashMat).position.set(0, seatY + 0.06, (seatZ + dashZ) / 2 + 0.1);
  const yoke = add(cabin, new THREE.TorusGeometry(0.15, 0.018, 8, 24, Math.PI * 1.25).rotateZ(-Math.PI * 0.125 + Math.PI), dashMat);
  yoke.position.set(-seatX, dashY + 0.04, dashZ + 0.28);
  yoke.rotation.x = -0.35;
  cabin.traverse((o) => {
    if (o instanceof THREE.Mesh) o.receiveShadow = true;
  });

  // Wheels: each pivot spins its tyre, rim and disc; the caliper stays put on the upright.
  const W = d.wheels;
  const caliperGeo = caliperGeometry(W.rim);
  const tyreGeos = new Map<number, THREE.BufferGeometry>();
  const rimGeos = new Map<number, ReturnType<typeof rimGeometries>>();
  const wheels: THREE.Object3D[] = [];
  const spots = d.axles.flatMap((z, axle) => [-1, 1].map((side) => ({ x: side * W.track[axle], z, width: W.width[axle] })));
  for (const { x, z, width } of spots) {
    if (!tyreGeos.has(width)) {
      tyreGeos.set(width, tyreGeometry(width, W.radius, W.rim));
      rimGeos.set(width, rimGeometries(width, W.rim, W.style));
    }
    const side = Math.sign(x);
    const parts = rimGeos.get(width)!;
    const wheel = new THREE.Group();
    wheel.name = 'wheel';
    const spin = new THREE.Group();
    spin.scale.x = side; // +x is always the outer face
    add(spin, tyreGeos.get(width)!, tyre).castShadow = true;
    add(spin, parts.spokes, rim);
    if (parts.cover) add(spin, parts.cover, coverMat);
    add(spin, parts.lip, machined);
    add(spin, parts.cap, machined);
    add(spin, parts.barrel, barrelMat);
    add(spin, parts.disc, discMat);
    wheel.add(spin);
    wheel.position.set(x, W.radius, z);
    root.add(wheel);
    wheels.push(wheel);

    const caliper = add(root, caliperGeo, caliperMat);
    caliper.position.set(x, W.radius, z);
    caliper.scale.x = side;
    caliper.rotation.x = z < 0 ? 0.9 : -0.9;
  }

  // Thrusters: white cold-gas smoke columns down for hover and sideways for steering, rearward flames
  // for boost. Each plume points down local -y from the nozzle, so scale.y sets its length.
  const thrusters = thrustersFor(d);
  const gas = plumeMaterial();
  const hoverGeo = plumeGeometry(0.07, 1.0);
  const hoverJets: THREE.Mesh[] = [];
  for (const [x, y, z] of thrusters.under) {
    const jet = new THREE.Mesh(hoverGeo, gas);
    jet.position.set(x, y, z);
    // Same lean as thrusters.underDir: rake back about x, then fan out about z.
    jet.rotation.set(-thrusters.rake, 0, -Math.sign(x) * thrusters.fan, 'ZYX');
    root.add(jet);
    hoverJets.push(jet);
  }
  const sideGeo = plumeGeometry(0.05, 0.5);
  const sideJets = [-1, 1].map((side) => {
    const jet = new THREE.Mesh(sideGeo, gas);
    jet.position.set(...thrusters.side(side));
    jet.rotation.set(0, -0.25 * side, side * (Math.PI / 2 + 0.12)); // out of the wing, slightly up and back
    root.add(jet);
    return jet;
  });

  const boostGeo = new THREE.ConeGeometry(0.17, 1.1, 12).rotateX(Math.PI / 2).translate(0, 0, 0.55);
  const boostMat = jetMaterial(0xff7a3d);
  const boostJets: THREE.Mesh[] = [];
  // Three translucent layers give the exhaust a hot core and a softer expanding envelope.
  const boostMidGeo = new THREE.ConeGeometry(0.115, 0.78, 12).rotateX(Math.PI / 2).translate(0, 0, 0.39);
  const boostCoreGeo = new THREE.ConeGeometry(0.065, 0.48, 10).rotateX(Math.PI / 2).translate(0, 0, 0.24);
  const boostMidMat = jetMaterial(0xffb354);
  const boostCoreMat = jetMaterial(0xfff0ce);
  const boostMids: THREE.Mesh[] = [];
  const boostCores: THREE.Mesh[] = [];
  for (const [x, y] of thrusters.rear) {
    const jet = new THREE.Mesh(boostGeo, boostMat);
    jet.position.set(x, y, d.tail - 0.08);
    root.add(jet);
    boostJets.push(jet);
    const mid = new THREE.Mesh(boostMidGeo, boostMidMat);
    mid.position.copy(jet.position);
    root.add(mid);
    boostMids.push(mid);
    const core = new THREE.Mesh(boostCoreGeo, boostCoreMat);
    core.position.copy(jet.position);
    root.add(core);
    boostCores.push(core);
  }

  const nozzleGlow = decalMats.glow as THREE.MeshStandardMaterial;
  const setJets = (lengths: readonly number[], boost: number, time: number) => {
    gas.uniforms.time.value = time % 600; // keep the noise coordinates small enough for float precision
    hoverJets.forEach((jet, i) => {
      const len = lengths[i];
      jet.visible = len > 0.05;
      // Short puffs are slimmer; a full column reaching the road gets its full width.
      const width = 0.55 + 0.45 * Math.min(1, len / 5);
      jet.scale.set(width, Math.max(len, 0.001), width);
    });
    boostJets.forEach((jet, i) => {
      const flicker = 0.88 + 0.12 * Math.sin(time * 58 + i * 2.3) + 0.035 * Math.sin(time * 113 + i * 4.1);
      jet.visible = boost > 0.02;
      jet.scale.set(1, 1, boost * flicker * 1.6);
      boostMids[i].visible = boost > 0.02;
      boostMids[i].scale.set(flicker, flicker, boost * flicker * 1.28);
      boostCores[i].visible = boost > 0.02;
      boostCores[i].scale.set(flicker, flicker, boost * flicker * 0.88);
    });
    // Nozzle throats glow faintly at rest and white-hot while the boost burns.
    nozzleGlow.emissiveIntensity = 0.25 + boost * (4 + Math.sin(time * 53) * 0.8);
  };
  setJets([0, 0, 0, 0], 0, 0);

  const setSideJets = (left: number, right: number) => {
    [left, right].forEach((power, i) => {
      sideJets[i].visible = power > 0.02;
      sideJets[i].scale.set(0.6 + power * 0.4, Math.max(power * 1.8, 0.001), 0.6 + power * 0.4);
    });
  };
  setSideJets(0, 0);

  const setPaintGlow = (color: THREE.ColorRepresentation, intensity: number) => {
    for (const m of [paint, decalMats.paint as THREE.MeshPhysicalMaterial]) {
      m.emissive.set(color);
      m.emissiveIntensity = intensity;
    }
  };

  const setSmokeLight = (tint: THREE.Color, sunColor: THREE.Color, sunDir: THREE.Vector3) => {
    gas.uniforms.uTint.value.copy(tint);
    gas.uniforms.uSunColor.value.copy(sunColor);
    gas.uniforms.uSunDir.value.copy(sunDir);
  };

  const setSuspension = (heave: number, pitch: number, roll: number) => {
    for (const g of [group, cabin]) {
      g.position.y = heave;
      g.rotation.set(pitch, 0, roll);
    }
  };

  const factoryCover = { color: coverMat.color.getHex(), metalness: coverMat.metalness, roughness: coverMat.roughness };
  const setFinish = (p: PaintFinish | null, w: WheelFinish | null) => {
    const f = p ?? d.paint;
    for (const m of [paint, decalMats.paint as THREE.MeshPhysicalMaterial]) {
      m.color.setHex(f.color);
      m.metalness = f.metalness;
      m.roughness = f.roughness;
      m.clearcoat = f.clearcoat;
      m.clearcoatRoughness = f.clearcoatRoughness ?? 0.03;
      m.anisotropy = f.anisotropy ?? 0;
      m.normalMap = flaked(f) ? paintFlakes() : null;
      m.needsUpdate = true; // flake, clear coat and anisotropy switch shader features
    }
    rim.color.setHex(w ? w.rim : d.wheels.rimColor);
    rim.metalness = w ? w.metalness : 0.85;
    rim.roughness = w ? w.roughness : 0.3;
    coverMat.color.setHex(w ? w.cover : factoryCover.color);
    coverMat.metalness = w ? Math.min(0.75, w.metalness) : factoryCover.metalness;
    coverMat.roughness = w ? w.roughness + 0.12 : factoryCover.roughness;
  };

  const width = Math.max(...d.axles.map((z) => d.P.width(z))) * 2 + 0.06;
  const spec: CarSpec = {
    id: d.id,
    name: d.name,
    length: d.tail - d.nose,
    width,
    height: d.height,
    wheelRadius: W.radius,
    pivotY: Math.round(d.height * 0.52 * 100) / 100,
  };
  return { root, wheels, spec, thrusters, setJets, setSideJets, setPaintGlow, setSmokeLight, setSuspension, setFinish };
}
