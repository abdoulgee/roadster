import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ROAD_HALF } from '../config';
import { IS_TOUCH } from '../systems/input';
import { mulberry32, type Rng } from '../util/rng';
import { ZONE_FIELD_GLSL, type ZoneField } from './zoneField';
import { ZONES, zoneWeights } from './zones';

// The strip of world the scatter covers; instances wrap from the near end back to the far end.
const NEAR = 30;
const FAR = -380;
const LEN = NEAR - FAR;

// ---------- geometry (vertex-coloured so a whole kind is one draw call) ----------

function paint(geo: THREE.BufferGeometry, hex: number, shade = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const p = g.attributes.position;
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    // Optional darkening towards the base, like ambient occlusion at the ground.
    const k = shade ? 1 - shade * Math.max(0, 1 - p.getY(i) / 0.6) : 1;
    colors.set([c.r * k, c.g * k, c.b * k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function merge(parts: THREE.BufferGeometry[]) {
  const geo = mergeGeometries(parts);
  geo.computeBoundingSphere();
  return geo;
}

/** A tuft of thin blades fanning out from one point; normals point up so it lights like a soft mass. */
function tuftGeometry(rng: Rng, blades: number, height: number, base: number, tip: number) {
  const pos: number[] = [];
  const col: number[] = [];
  const cBase = new THREE.Color(base);
  const cTip = new THREE.Color(tip);
  for (let b = 0; b < blades; b++) {
    const a = rng() * Math.PI * 2;
    const lean = 0.15 + rng() * 0.45;
    const h = height * (0.6 + rng() * 0.5);
    const w = 0.035 + rng() * 0.03;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const ox = dx * rng() * 0.12;
    const oz = dz * rng() * 0.12;
    // Base corners across the blade, tip leaning outwards.
    pos.push(ox - dz * w, 0, oz + dx * w, ox + dz * w, 0, oz - dx * w, ox + dx * h * lean, h, oz + dz * h * lean);
    col.push(cBase.r, cBase.g, cBase.b, cBase.r, cBase.g, cBase.b, cTip.r, cTip.g, cTip.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const n = new Float32Array(pos.length);
  for (let i = 1; i < n.length; i += 3) n[i] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  return geo;
}

/** A lumpy clump of low-poly blobs: shrubs, bushes, moss. */
function clumpGeometry(rng: Rng, blobs: number, size: number, hex: number, detail = 1, spread = 0.6) {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < blobs; i++) {
    const r = size * (0.45 + rng() * 0.55);
    const blob = new THREE.IcosahedronGeometry(r, detail);
    const p = blob.attributes.position;
    for (let k = 0; k < p.count; k++) p.setXYZ(k, p.getX(k) * (0.85 + rng() * 0.3), p.getY(k) * (0.7 + rng() * 0.3), p.getZ(k) * (0.85 + rng() * 0.3));
    blob.translate((rng() - 0.5) * size * spread * 2, r * 0.75, (rng() - 0.5) * size * spread * 2);
    const tone = new THREE.Color(hex).multiplyScalar(0.85 + rng() * 0.3).getHex();
    parts.push(paint(blob, tone, 0.45));
  }
  const geo = merge(parts);
  geo.computeVertexNormals();
  return geo;
}

function rockGeometry(rng: Rng, hex: number) {
  const geo = mergeVertices(new THREE.IcosahedronGeometry(0.5, 1));
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setXYZ(i, p.getX(i) * (0.8 + rng() * 0.45), Math.max(-0.1, y) * (0.5 + rng() * 0.3) + 0.08, p.getZ(i) * (0.8 + rng() * 0.45));
  }
  const out = paint(geo, hex, 0.3);
  out.computeVertexNormals();
  return out;
}

/** Saguaro: a ribbed column with up-turned arms. */
function saguaroGeometry(rng: Rng) {
  const green = 0x5f7d3c;
  const ribbed = (r: number, h: number) => {
    const g = new THREE.CylinderGeometry(r * 0.92, r, h, 12, 6);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const a = Math.atan2(p.getZ(i), p.getX(i));
      const k = 1 + 0.08 * Math.cos(a * 12);
      p.setXYZ(i, p.getX(i) * k, p.getY(i), p.getZ(i) * k);
    }
    return g;
  };
  const dome = (r: number) => new THREE.SphereGeometry(r * 0.92, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const h = 4 + rng() * 2;
  const parts = [ribbed(0.32, h).translate(0, h / 2, 0), dome(0.32).translate(0, h, 0)];
  const arms = 1 + Math.floor(rng() * 2.5);
  for (let k = 0; k < arms; k++) {
    const side = k % 2 ? -1 : 1;
    const y = h * (0.35 + rng() * 0.25);
    const out = 0.7 + rng() * 0.3;
    const up = 1.2 + rng() * 1.2;
    parts.push(ribbed(0.2, out).rotateZ(Math.PI / 2).translate((side * out) / 2, y, 0));
    parts.push(new THREE.SphereGeometry(0.2, 10, 8).translate(side * out, y, 0));
    parts.push(ribbed(0.2, up).translate(side * out, y + up / 2, 0), dome(0.2).translate(side * out, y + up, 0));
  }
  const geo = merge(parts.map((g) => paint(g, green, 0.25)));
  geo.computeVertexNormals();
  return geo;
}

/** A wildflower patch: stems with coloured heads. */
function flowerGeometry(rng: Rng, head: number) {
  const parts: THREE.BufferGeometry[] = [tuftGeometry(rng, 5, 0.35, 0x2f4a1e, 0x4f7a2c)];
  for (let i = 0; i < 4; i++) {
    const x = (rng() - 0.5) * 0.3;
    const z = (rng() - 0.5) * 0.3;
    const h = 0.3 + rng() * 0.25;
    parts.push(paint(new THREE.CylinderGeometry(0.008, 0.01, h, 3).translate(x, h / 2, z), 0x3f6a2a));
    const bloom = paint(new THREE.OctahedronGeometry(0.05 + rng() * 0.03, 0).translate(x, h, z), head);
    bloom.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(bloom.attributes.position.count * 3).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
    parts.push(bloom);
  }
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
}

/** Young fir: two stacked cones on a stub of trunk. */
function saplingGeometry(rng: Rng) {
  const h = 1.6 + rng() * 1.2;
  const parts = [
    paint(new THREE.CylinderGeometry(0.05, 0.08, h * 0.3, 5).translate(0, h * 0.15, 0), 0x4a3426),
    paint(new THREE.ConeGeometry(h * 0.33, h * 0.6, 8).translate(0, h * 0.5, 0), 0x2a4d2f, 0.2),
    paint(new THREE.ConeGeometry(h * 0.24, h * 0.45, 8).translate(0, h * 0.8, 0), 0x31593a),
  ];
  const geo = merge(parts);
  geo.computeVertexNormals();
  return geo;
}

/** A fallen, mossy log. */
function logGeometry(rng: Rng) {
  const len = 2.5 + rng() * 2;
  const parts = [
    paint(new THREE.CylinderGeometry(0.22, 0.26, len, 9).rotateZ(Math.PI / 2).translate(0, 0.22, 0), 0x5a4130),
    paint(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 9).rotateZ(Math.PI / 2).translate(len / 2, 0.22, 0), 0xb08a5a),
    paint(new THREE.IcosahedronGeometry(0.18, 0).scale(2.2, 0.5, 1.2).translate(-len * 0.2, 0.43, 0), 0x4c6b2c),
  ];
  const geo = merge(parts);
  geo.computeVertexNormals();
  return geo;
}

/** Salt crystals breaking through the crust: a cluster of short hexagonal prisms. */
function saltCrystalGeometry(rng: Rng) {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const h = 0.15 + rng() * 0.45;
    const prism = new THREE.CylinderGeometry(0.06 + rng() * 0.08, 0.1 + rng() * 0.08, h, 6)
      .rotateX((rng() - 0.5) * 0.6)
      .rotateZ((rng() - 0.5) * 0.6)
      .translate((rng() - 0.5) * 0.6, h / 2, (rng() - 0.5) * 0.6);
    parts.push(paint(prism, 0xf4f6f8));
  }
  parts.push(paint(new THREE.CylinderGeometry(0.5, 0.7, 0.12, 9).translate(0, 0.04, 0), 0xe6e4df));
  const geo = merge(parts);
  geo.computeVertexNormals();
  return geo;
}

/** Tumbleweed: a loose ball of twigs (thin crossed strips). */
function tumbleweedGeometry(rng: Rng) {
  const pos: number[] = [];
  const v = new THREE.Vector3();
  const u = new THREE.Vector3();
  for (let i = 0; i < 70; i++) {
    v.set(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize().multiplyScalar(0.55);
    u.set(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize().multiplyScalar(0.55);
    const w = 0.025;
    pos.push(v.x, v.y, v.z, u.x, u.y, u.z, v.x + w, v.y + w, v.z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return paint(geo, 0x9c7c4e);
}

// ---------- the scatter layers ----------

interface Kind {
  zone: number;
  geometry: THREE.BufferGeometry;
  count: number;
  /** Distance from the road edge, metres. */
  near: number;
  far: number;
  scale: [number, number];
  /** Wind bend at the top, metres, over `height`. */
  sway?: number;
  height?: number;
  /** Rolls across the plain (tumbleweed) at this speed, m/s. */
  roll?: number;
  doubleSide?: boolean;
}

const SCATTER_VERTEX_HEAD = /* glsl */ `
  attribute vec4 aSpot; // x, z at scroll 0, yaw, scale
  attribute float aTint;
  uniform float uScroll;
  uniform float uTime;
  uniform vec4 uZoneMask;
  uniform float uSway;
  uniform float uHeight;
  uniform float uRoll;
  ${ZONE_FIELD_GLSL}
  vec3 scatterSpin(vec3 v, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
  }
  vec3 scatterRoll(vec3 v, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec3(c * v.x - s * v.y, s * v.x + c * v.y, v.z);
  }
`;

const SCATTER_BEGIN = /* glsl */ `
  float scatterZ = mod(aSpot.y + uScroll - (${FAR.toFixed(1)}), ${LEN.toFixed(1)}) + (${FAR.toFixed(1)});
  float scatterX = aSpot.x;
  float rollAngle = 0.0;
  if (uRoll > 0.0) {
    // Tumbleweeds bounce across the road from one side to the other and wrap round.
    float travel = mod(aSpot.x + 90.0 + uTime * uRoll, 180.0) - 90.0;
    scatterX = travel;
    rollAngle = -travel / 0.55;
  }
  // Grow in where this kind's zone begins and shrink away where it ends.
  float grow = smoothstep(0.0, 1.0, dot(zoneAtZ(scatterZ), uZoneMask));
  vec3 transformed = position;
  if (uSway > 0.0) {
    float bend = clamp(position.y / uHeight, 0.0, 1.0);
    float gust = sin(uTime * 1.6 + scatterX * 0.11 + scatterZ * 0.09) * 0.65 + sin(uTime * 3.3 + aSpot.y * 0.7) * 0.35;
    transformed.x += gust * uSway * bend * bend;
  }
  if (uRoll > 0.0) transformed = scatterRoll(transformed, rollAngle) + vec3(0.0, 0.55 + abs(sin(uTime * 3.0 + aSpot.y)) * 0.6, 0.0);
  transformed = scatterSpin(transformed, aSpot.z) * aSpot.w * grow + vec3(scatterX, 0.0, scatterZ);
`;

/**
 * Ground cover along the roadside: cacti, shrubs and dry grass in the desert, salt crystals and
 * tumbleweeds on the flats, grass, wildflowers, saplings and logs in the forest. Each kind is one
 * instanced draw; the GPU scrolls every instance with the road, bends it in the wind and grows it in
 * and out at zone boundaries, so the CPU never touches them after setup.
 */
export class Scatter {
  private readonly scroll = { value: 0 };
  private readonly time = { value: 0 };
  private readonly layers: { zone: number; mesh: THREE.Mesh }[] = [];
  private readonly weights = [0, 0, 0, 0];
  private readonly present = [false, false, false, false];
  private offset = 0;

  constructor(scene: THREE.Scene, field: ZoneField) {
    const rng = mulberry32(77);
    const density = IS_TOUCH ? 0.5 : 1;
    const kinds: Kind[] = [
      // Sunset desert.
      { zone: 0, geometry: saguaroGeometry(rng), count: 26, near: 7, far: 70, scale: [0.85, 1.25] },
      { zone: 0, geometry: saguaroGeometry(rng), count: 26, near: 9, far: 90, scale: [0.7, 1.1] },
      { zone: 0, geometry: clumpGeometry(rng, 6, 0.55, 0x6e7a45, 0), count: 260, near: 2, far: 90, scale: [0.6, 1.5], sway: 0.05, height: 1 },
      { zone: 0, geometry: tuftGeometry(rng, 12, 0.7, 0x8a6a3c, 0xe0c084), count: 900, near: 1, far: 45, scale: [0.7, 1.4], sway: 0.18, height: 0.8, doubleSide: true },
      { zone: 0, geometry: rockGeometry(rng, 0x9a5a3c), count: 160, near: 2, far: 80, scale: [0.5, 2.2] },
      // Salt flats.
      { zone: 1, geometry: saltCrystalGeometry(rng), count: 260, near: 3, far: 90, scale: [0.7, 1.8] },
      { zone: 1, geometry: rockGeometry(rng, 0x6f6a66), count: 90, near: 6, far: 90, scale: [0.6, 2.5] },
      { zone: 1, geometry: tumbleweedGeometry(rng), count: 16, near: 0, far: 0, scale: [0.8, 1.3], roll: 5, doubleSide: true },
      // Pine ridge.
      { zone: 2, geometry: tuftGeometry(rng, 14, 0.55, 0x2c4a1c, 0x6f9a3a), count: 1500, near: 0.6, far: 50, scale: [0.7, 1.5], sway: 0.16, height: 0.65, doubleSide: true },
      { zone: 2, geometry: flowerGeometry(rng, 0xf2d23a), count: 280, near: 1, far: 35, scale: [0.8, 1.3], sway: 0.1, height: 0.6, doubleSide: true },
      { zone: 2, geometry: flowerGeometry(rng, 0xb05ad0), count: 280, near: 1, far: 35, scale: [0.8, 1.3], sway: 0.1, height: 0.6, doubleSide: true },
      { zone: 2, geometry: clumpGeometry(rng, 7, 0.7, 0x2f5a2a), count: 200, near: 2, far: 70, scale: [0.7, 1.6], sway: 0.06, height: 1.2 },
      { zone: 2, geometry: saplingGeometry(rng), count: 110, near: 4, far: 60, scale: [0.8, 1.4], sway: 0.12, height: 2.5 },
      { zone: 2, geometry: logGeometry(rng), count: 24, near: 4, far: 50, scale: [0.9, 1.2] },
      { zone: 2, geometry: rockGeometry(rng, 0x7d7f78), count: 90, near: 3, far: 70, scale: [0.6, 2.2] },
    ];
    for (const kind of kinds) {
      const mesh = this.build(kind, Math.max(1, Math.round(kind.count * density)), rng, field);
      this.layers.push({ zone: kind.zone, mesh });
      scene.add(mesh);
    }
  }

  update(delta: number, distance: number) {
    this.offset += delta;
    this.scroll.value = this.offset % LEN;
    this.time.value = performance.now() / 1000;
    // Skip drawing layers whose zone is nowhere along the visible strip (they would all be shrunk to nothing).
    this.present.fill(false);
    for (let z = NEAR; z >= FAR; z -= 40) {
      zoneWeights(Math.max(0, distance - z), this.weights);
      for (let k = 0; k < ZONES.length; k++) if (this.weights[k] > 0) this.present[k] = true;
    }
    for (const layer of this.layers) layer.mesh.visible = this.present[layer.zone];
  }

  private build(kind: Kind, count: number, rng: Rng, field: ZoneField) {
    const base = kind.geometry;
    const geo = new THREE.InstancedBufferGeometry();
    for (const name of ['position', 'normal', 'color'] as const) geo.setAttribute(name, base.attributes[name]);
    if (base.index) geo.setIndex(base.index);
    const spots = new Float32Array(count * 4);
    const tints = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const side = rng() < 0.5 ? -1 : 1;
      // Bias towards the road so the verges are dense and the distance thins out.
      const out = kind.near + (kind.far - kind.near) * rng() ** 1.6;
      spots[i * 4] = kind.roll ? (rng() - 0.5) * 180 : side * (ROAD_HALF + 1 + out);
      spots[i * 4 + 1] = FAR + rng() * LEN;
      spots[i * 4 + 2] = kind.roll ? 0 : rng() * Math.PI * 2; // rollers keep their roll axis along the road
      spots[i * 4 + 3] = kind.scale[0] + (kind.scale[1] - kind.scale[0]) * rng();
      tints[i] = 0.8 + rng() * 0.35;
    }
    geo.setAttribute('aSpot', new THREE.InstancedBufferAttribute(spots, 4));
    geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints, 1));
    geo.instanceCount = count;

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      side: kind.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    });
    const mask = new THREE.Vector4();
    mask.setComponent(kind.zone, 1);
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        uScroll: this.scroll,
        uTime: this.time,
        uZoneField: { value: field.texture },
        uZoneMask: { value: mask },
        uSway: { value: kind.sway ?? 0 },
        uHeight: { value: kind.height ?? 1 },
        uRoll: { value: kind.roll ?? 0 },
      });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${SCATTER_VERTEX_HEAD}`)
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = scatterSpin(objectNormal, aSpot.z);')
        .replace('#include <begin_vertex>', SCATTER_BEGIN)
        .replace('#include <color_vertex>', '#include <color_vertex>\nvColor.rgb *= aTint;');
    };
    mat.customProgramCacheKey = () => 'scatter';
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    return mesh;
  }
}
