import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LANES, LANE_WIDTH, PALETTE, ROAD_HALF, SHOULDER } from '../config';
import { mulberry32, type Rng } from '../util/rng';
import { smoothstep } from '../util/shape';
import { NOISE_GLSL } from './glsl';
import { PropKit } from './props';
import { ZONES, zoneAt, type Palette, type PropKind } from './zones';

const ROAD_TILE = 24; // metres of road one texture repeat covers
const ROAD_FAR = -400;
const ROAD_NEAR = 30;
const ROAD_LEN = ROAD_NEAR - ROAD_FAR;
const POST_SPACING = 4;
const LAMP_SPACING = 50;
const PROP_COUNT = 56;
const LANDMARK_COUNT = 9;
const VERGE_WIDTH = 8;
const GANTRY_SPACING = 650;
const STUD_SPACING = 12; // raised pavement markers sit in every gap between lane dashes
/** Lengthwise subdivisions for long road strips, so the world bend can curve them smoothly. */
const ROAD_SEGMENTS = 160;

// ---------- textures ----------

/** Asphalt colour and roughness for one tile: worn wheel tracks, sealed cracks, patches, rumble strips, paint. */
function roadTextures(renderer: THREE.WebGLRenderer) {
  const w = 1024;
  const h = 1024;
  const make = () => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    return { canvas, ctx: canvas.getContext('2d')! };
  };
  const col = make();
  const rough = make();
  const c = col.ctx;
  const r = rough.ctx;
  const px = (m: number) => (m / (ROAD_HALF * 2)) * w;
  const py = (m: number) => (m / ROAD_TILE) * h;
  const rng = mulberry32(3);
  // Draws `fn` three times, shifted a tile up and down, so features crossing the edge tile seamlessly.
  const wrapped = (fn: (dy: number) => void) => [-h, 0, h].forEach(fn);

  c.fillStyle = '#3d3e43';
  c.fillRect(0, 0, w, h);
  r.fillStyle = '#d9d9d9';
  r.fillRect(0, 0, w, h);
  c.fillStyle = 'rgba(255, 250, 240, 0.035)';
  c.fillRect(0, 0, px(SHOULDER), h);
  c.fillRect(w - px(SHOULDER), 0, px(SHOULDER), h);

  for (let i = 0; i < 170; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const rad = 20 + rng() * 110;
    const tone = rng() < 0.55 ? '0, 0, 0' : '255, 250, 240';
    const a = 0.03 + rng() * 0.05;
    wrapped((dy) => {
      const g = c.createRadialGradient(x, y + dy, 0, x, y + dy, rad);
      g.addColorStop(0, `rgba(${tone}, ${a})`);
      g.addColorStop(1, `rgba(${tone}, 0)`);
      c.fillStyle = g;
      c.fillRect(x - rad, y + dy - rad, rad * 2, rad * 2);
    });
  }

  // Wheel tracks: darker, slightly polished bands either side of each lane centre.
  for (let lane = 0; lane < LANES; lane++) {
    const centre = SHOULDER + (lane + 0.5) * LANE_WIDTH;
    for (const [offset, width, alpha] of [[-0.9, 0.75, 0.16], [0.9, 0.75, 0.16], [0, 0.5, 0.07]] as const) {
      const x0 = px(centre + offset - width / 2);
      const x1 = px(centre + offset + width / 2);
      const g = c.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0, 'rgba(0, 0, 0, 0)');
      g.addColorStop(0.5, `rgba(10, 10, 12, ${alpha})`);
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      c.fillStyle = g;
      c.fillRect(x0, 0, x1 - x0, h);
      const gr = r.createLinearGradient(x0, 0, x1, 0);
      gr.addColorStop(0, 'rgba(0, 0, 0, 0)');
      gr.addColorStop(0.5, `rgba(0, 0, 0, ${alpha * 1.4})`);
      gr.addColorStop(1, 'rgba(0, 0, 0, 0)');
      r.fillStyle = gr;
      r.fillRect(x0, 0, x1 - x0, h);
    }
  }

  // Patches of newer asphalt.
  for (let i = 0; i < 4; i++) {
    const lane = Math.floor(rng() * LANES);
    const x = px(SHOULDER + lane * LANE_WIDTH + 0.4 + rng() * 1.2);
    const pw = px(1.2 + rng() * 1.4);
    const y = rng() * h;
    const ph = py(1.5 + rng() * 3);
    wrapped((dy) => {
      c.fillStyle = 'rgba(20, 20, 24, 0.28)';
      c.fillRect(x, y + dy, pw, ph);
      c.strokeStyle = 'rgba(10, 10, 12, 0.5)';
      c.lineWidth = 2;
      c.strokeRect(x, y + dy, pw, ph);
      r.fillStyle = 'rgba(0, 0, 0, 0.12)';
      r.fillRect(x, y + dy, pw, ph);
    });
  }

  // Aggregate grain.
  for (let i = 0; i < 70000; i++) {
    const v = 25 + Math.floor(rng() * 95);
    c.fillStyle = `rgba(${v}, ${v}, ${v + 3}, ${0.25 + rng() * 0.4})`;
    c.fillRect(rng() * w, rng() * h, 1 + rng(), 1 + rng());
  }
  for (let i = 0; i < 9000; i++) {
    const v = Math.floor(rng() * 255);
    r.fillStyle = `rgba(${v}, ${v}, ${v}, 0.18)`;
    r.fillRect(rng() * w, rng() * h, 2, 2);
  }

  // Sealed cracks: dark, glossy, mostly running with the road.
  for (let i = 0; i < 16; i++) {
    let x = rng() * w;
    let y = rng() * h;
    const pts: [number, number][] = [[x, y]];
    const steps = 6 + Math.floor(rng() * 14);
    for (let s = 0; s < steps; s++) {
      x += (rng() - 0.5) * 22;
      y += 8 + rng() * 26;
      pts.push([x, y]);
    }
    const width = 1 + rng() * 1.8;
    wrapped((dy) => {
      for (const [ctx, style] of [[c, 'rgba(14, 14, 17, 0.6)'], [r, 'rgba(0, 0, 0, 0.45)']] as const) {
        ctx.strokeStyle = style;
        ctx.lineWidth = width;
        ctx.beginPath();
        pts.forEach(([a, b], k) => (k ? ctx.lineTo(a, b + dy) : ctx.moveTo(a, b + dy)));
        ctx.stroke();
      }
    });
  }

  // Rumble strips milled into the shoulders.
  for (const x of [px(SHOULDER - 0.6), w - px(SHOULDER - 0.2)]) {
    for (let y = 0; y < ROAD_TILE; y += 0.3) {
      c.fillStyle = 'rgba(0, 0, 0, 0.3)';
      c.fillRect(x, py(y), px(0.4), py(0.12));
    }
  }

  // Paint: solid edge lines and 3 m dashes every 12 m, with a little wear.
  const line = px(0.15);
  const paint = (x: number, y: number, pw: number, ph: number) => {
    c.fillStyle = '#e6e2d6';
    c.fillRect(x, y, pw, ph);
    r.fillStyle = '#8c8c8c';
    r.fillRect(x, y, pw, ph);
  };
  paint(px(SHOULDER) - line / 2, 0, line, h);
  paint(w - px(SHOULDER) - line / 2, 0, line, h);
  for (let lane = 1; lane < LANES; lane++) {
    const x = px(SHOULDER + lane * LANE_WIDTH) - line / 2;
    for (const y of [1.5, 13.5]) paint(x, py(y), line, py(3));
  }
  for (let i = 0; i < 2600; i++) {
    c.fillStyle = `rgba(60, 60, 64, ${0.2 + rng() * 0.4})`;
    c.fillRect(rng() * w, rng() * h, 1.5, 1.5);
  }

  // Surface relief: stones in the aggregate stand proud, cracks and rumble grooves sink, paint sits on
  // top. Height comes from the finished colour (lighter = higher), then becomes a tangent-space normal map.
  const normal = make();
  {
    const src = c.getImageData(0, 0, w, h).data;
    const height = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) height[i] = (src[i * 4] * 0.3 + src[i * 4 + 1] * 0.59 + src[i * 4 + 2] * 0.11) / 255;
    const out = normal.ctx.createImageData(w, h);
    const strength = 5;
    for (let y = 0; y < h; y++) {
      const up = ((y - 1 + h) % h) * w;
      const down = ((y + 1) % h) * w;
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const left = Math.max(0, x - 1);
        const right = Math.min(w - 1, x + 1);
        const dx = (height[row + right] - height[row + left]) * strength;
        const dy = (height[down + x] - height[up + x]) * strength;
        const len = Math.hypot(dx, dy, 1);
        const o = (row + x) * 4;
        out.data[o] = (-dx / len) * 127.5 + 127.5;
        out.data[o + 1] = (dy / len) * 127.5 + 127.5;
        out.data[o + 2] = (1 / len) * 127.5 + 127.5;
        out.data[o + 3] = 255;
      }
    }
    normal.ctx.putImageData(out, 0, 0);
  }

  const toTexture = (canvas: HTMLCanvasElement, srgb: boolean) => {
    const tex = new THREE.CanvasTexture(canvas);
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.repeat.set(1, ROAD_LEN / ROAD_TILE);
    return tex;
  };
  return { map: toTexture(col.canvas, true), roughness: toTexture(rough.canvas, false), normal: toTexture(normal.canvas, false) };
}

/**
 * Asphalt that can be wet: when it rains the whole road darkens and turns glossy, puddles collect in
 * the wheel ruts and low spots (mirror-smooth, picking up the sky and neon), and raindrops ring them.
 */
function roadMaterial(textures: ReturnType<typeof roadTextures>, wet: { value: number }, rain: { value: number }, scroll: { value: number }, time: { value: number }) {
  const mat = new THREE.MeshStandardMaterial({
    map: textures.map,
    roughnessMap: textures.roughness,
    normalMap: textures.normal,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 1,
    metalness: 0,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uWet: wet, uRain: rain, uScroll: scroll, uTime: time });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRoad;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vRoad;
        uniform float uWet;
        uniform float uRain;
        uniform float uScroll;
        uniform float uTime;
        ${NOISE_GLSL}
        float puddle = 0.0;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec2 rp = vec2(vRoad.x, vRoad.y - uScroll);
        // Water gathers in the wheel ruts first, then in broad low patches.
        float rut = 0.0;
        for (int lane = 0; lane < ${LANES}; lane++) {
          float centre = ${(-ROAD_HALF + SHOULDER).toFixed(2)} + (float(lane) + 0.5) * ${LANE_WIDTH.toFixed(2)};
          rut = max(rut, 1.0 - smoothstep(0.15, 0.55, abs(abs(vRoad.x - centre) - 0.9)));
        }
        float low = wFbm(rp * vec2(0.22, 0.09));
        puddle = smoothstep(0.55, 0.62, low + rut * 0.18) * uWet;
        diffuseColor.rgb *= mix(1.0, 0.55, uWet) * mix(1.0, 0.7, puddle);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.32, uWet * 0.85);
        roughnessFactor = mix(roughnessFactor, 0.07, puddle);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        // Puddles are flat water, except where raindrops land and ring outwards.
        normal = normalize(mix(normal, nonPerturbedNormal, puddle));
        if (uRain > 0.0 && puddle > 0.01) {
          vec2 cell = floor(rp * 2.5);
          vec2 local = fract(rp * 2.5) - 0.5;
          float phase = fract(uTime * 1.3 + wHash(cell));
          float ring = sin((length(local) - phase * 0.45) * 60.0) * (1.0 - phase) * smoothstep(0.5, 0.2, length(local));
          normal = normalize(normal + vec3(local.x, 0.0, local.y) * ring * 0.6 * uRain * puddle);
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'wet-road';
  return mat;
}

/** A soft vertical streak: how a lamp reflects in wet tarmac, smeared towards the viewer. */
function streakTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const along = ctx.createLinearGradient(0, 0, 0, 256);
  along.addColorStop(0, 'rgba(255,255,255,0)');
  along.addColorStop(0.12, 'rgba(255,255,255,0.9)');
  along.addColorStop(0.35, 'rgba(255,255,255,0.5)');
  along.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = along;
  ctx.fillRect(0, 0, 32, 256);
  // Narrow it towards the sides.
  ctx.globalCompositeOperation = 'destination-in';
  const across = ctx.createLinearGradient(0, 0, 32, 0);
  across.addColorStop(0, 'rgba(0,0,0,0)');
  across.addColorStop(0.5, 'rgba(0,0,0,1)');
  across.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = across;
  ctx.fillRect(0, 0, 32, 256);
  return new THREE.CanvasTexture(canvas);
}

/** Loose gravel that fades out into the open ground; u runs across the verge, v along the road. */
function vergeTexture(renderer: THREE.WebGLRenderer) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rng = mulberry32(9);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 9000; i++) {
    const v = 120 + Math.floor(rng() * 135);
    ctx.fillStyle = `rgba(${v}, ${v}, ${v}, ${0.3 + rng() * 0.5})`;
    ctx.fillRect(rng() * size, rng() * size, 1 + rng() * 3, 1 + rng() * 3);
  }
  // Fade the outer edge to transparent.
  const img = ctx.getImageData(0, 0, size, size);
  for (let x = 0; x < size; x++) {
    const a = 1 - smoothstep(0.45, 1, x / size);
    for (let y = 0; y < size; y++) img.data[(y * size + x) * 4 + 3] = a * 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.repeat.set(1, ROAD_LEN / VERGE_WIDTH);
  return tex;
}

function radialTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// Fictional destinations for the overhead signs, one pair per zone.
const SIGNS: readonly (readonly [string, string])[][] = [
  [['EXIT 27', 'Palm Coast'], ['WEST', 'ZAINAB  18']],
  [['EXIT 41', 'Salt Basin'], ['NORTH', 'RN.ZAINAB  32']],
  [['EXIT 53', 'Pine Ridge'], ['NORTH', 'Summit Pass  12']],
  [['EXIT 66', 'Downtown'], ['EAST', 'Neon District  4']],
];

function signTexture(pair: readonly [string, string]) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 220;
  drawSign(canvas, pair);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function drawSign(canvas: HTMLCanvasElement, [top, bottom]: readonly [string, string]) {
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0d6a3b';
  ctx.fillRect(0, 0, 512, 220);
  ctx.strokeStyle = '#f2f2ea';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(10, 10, 492, 200, 14);
  ctx.stroke();
  ctx.fillStyle = '#f2f2ea';
  ctx.textAlign = 'center';
  ctx.font = '700 44px "Chakra Petch", system-ui, sans-serif';
  ctx.fillText(top, 256, 78);
  ctx.font = '600 52px "Chakra Petch", system-ui, sans-serif';
  ctx.fillText(bottom, 256, 152);
  ctx.beginPath();
  ctx.moveTo(256, 196);
  ctx.lineTo(236, 172);
  ctx.lineTo(276, 172);
  ctx.fill();
}

// ---------- prop geometry ----------

/** Curved, ringed trunk with drooping folded fronds; draw groups 0 = trunk, 1 = leaves. */
function palmGeometry(seed: number) {
  const rng = mulberry32(seed);
  const height = 7 + rng() * 1.5;
  const lean = 0.6 + rng() * 0.8;
  const trunk = new THREE.CylinderGeometry(0.15, 0.3, height, 8, 18);
  const p = trunk.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) + height / 2) / height;
    const bump = 1 + 0.08 * Math.max(0, Math.sin(t * 46));
    p.setXYZ(i, p.getX(i) * bump + lean * t * t, p.getY(i) + height / 2, p.getZ(i) * bump);
  }
  trunk.computeVertexNormals();
  const top = new THREE.Vector3(lean, height, 0);

  const pos: number[] = [];
  const fronds = 9;
  const segs = 8;
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + rng() * 0.3;
    const len = 3.3 + rng() * 0.9;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const rows: THREE.Vector3[][] = [];
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const centre = top.clone().addScaledVector(dir, len * t).add(new THREE.Vector3(0, len * (0.32 * t - 0.72 * t * t), 0));
      const width = 0.6 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.02)), 0.8);
      rows.push([
        centre.clone().addScaledVector(side, -width).add(new THREE.Vector3(0, -0.08 * width, 0)),
        centre.clone().add(new THREE.Vector3(0, 0.12 * width, 0)),
        centre.clone().addScaledVector(side, width).add(new THREE.Vector3(0, -0.08 * width, 0)),
      ]);
    }
    for (let s = 0; s < segs; s++) {
      for (let k = 0; k < 2; k++) {
        const [a0, a1, b0, b1] = [rows[s][k], rows[s][k + 1], rows[s + 1][k], rows[s + 1][k + 1]];
        pos.push(...a0.toArray(), ...b0.toArray(), ...a1.toArray(), ...a1.toArray(), ...b0.toArray(), ...b1.toArray());
      }
    }
  }
  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  leaves.computeVertexNormals();
  const nuts = [0, 1, 2].map((k) =>
    new THREE.SphereGeometry(0.16, 6, 5).translate(lean + Math.cos(k * 2.1) * 0.22, height - 0.3, Math.sin(k * 2.1) * 0.22),
  );
  const wood = [trunk, ...nuts].map((g) => {
    g.deleteAttribute('uv');
    return g.toNonIndexed();
  });
  return mergeGeometries([mergeGeometries(wood), leaves], true);
}

/** A weathered boulder: a displaced icosphere with a flattened base. */
function rockGeometry(seed: number) {
  const rng = mulberry32(seed);
  const waves = Array.from({ length: 5 }, () => ({
    d: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(),
    f: 1.5 + rng() * 4,
    a: 0.06 + rng() * 0.12,
    p: rng() * 6,
  }));
  const geo = mergeVertices(new THREE.IcosahedronGeometry(1, 3));
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    let r = 1;
    for (const w of waves) r += w.a * Math.sin(v.dot(w.d) * w.f + w.p);
    v.multiplyScalar(r);
    if (v.y < -0.25) v.y = -0.25 + (v.y + 0.25) * 0.15;
    p.setXYZ(i, v.x, v.y + 0.25, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Three firs of different sizes; draw groups 0 = trunks, 1 = needles. */
function pineGeometry(seed: number) {
  const rng = mulberry32(seed);
  const trunks: THREE.BufferGeometry[] = [];
  const crowns: THREE.BufferGeometry[] = [];
  for (let t = 0; t < 3; t++) {
    const s = 0.7 + rng() * 0.7;
    const x = (rng() - 0.5) * 7;
    const z = (rng() - 0.5) * 7;
    trunks.push(new THREE.CylinderGeometry(0.12 * s, 0.22 * s, 2.4 * s, 6).translate(x, 1.2 * s, z).toNonIndexed());
    for (let k = 0; k < 4; k++) {
      const cone = new THREE.ConeGeometry(2.1 * s * (1 - k * 0.2), 2.6 * s, 10, 1);
      const p = cone.attributes.position;
      for (let i = 0; i < p.count; i++) {
        if (p.getY(i) > 0) continue; // jag only the skirt of each tier
        const j = 0.82 + rng() * 0.3;
        p.setXYZ(i, p.getX(i) * j, p.getY(i) - rng() * 0.25 * s, p.getZ(i) * j);
      }
      cone.computeVertexNormals();
      crowns.push(cone.translate(x, (2.0 + k * 1.3) * s, z).toNonIndexed());
    }
  }
  return mergeGeometries([mergeGeometries(trunks), mergeGeometries(crowns)], true);
}

/** Tower with a setback crown, rooftop plant and neon edges; draw groups 0 = facade, 1 = neon, 2 = roof kit. */
function towerGeometry(w: number, h: number, d: number, seed: number) {
  const rng = mulberry32(seed);
  const facade = [new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0)];
  const crownH = h * (0.12 + rng() * 0.2);
  facade.push(new THREE.BoxGeometry(w * 0.72, crownH, d * 0.72).translate(0, h + crownH / 2, 0));
  const neon = [
    new THREE.BoxGeometry(w + 0.3, 0.45, d + 0.3).translate(0, h - 0.6, 0),
    new THREE.BoxGeometry(w * 0.72 + 0.25, 0.3, d * 0.72 + 0.25).translate(0, h + crownH - 0.4, 0),
  ];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) neon.push(new THREE.BoxGeometry(0.22, h * 0.9, 0.22).translate((sx * w) / 2, h * 0.45, (sz * d) / 2));
  const roof = [
    new THREE.BoxGeometry(w * 0.3, 1.6, d * 0.25).translate(w * 0.15, h + crownH + 0.8, 0),
    new THREE.CylinderGeometry(0.12, 0.2, 8 + rng() * 10, 6).translate(-w * 0.2, h + crownH + 5, d * 0.1),
  ];
  const merge = (list: THREE.BufferGeometry[]) => mergeGeometries(list.map((g) => g.toNonIndexed()));
  return mergeGeometries([merge(facade), merge(neon), merge(roof)], true);
}

const NEON = [0xff3fa8, 0x3fe0ff, 0xb07bff, 0xffb13f];

/** Facade with lit windows drawn from object-space position, so every tower size gets square windows. */
function facadeMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x14121c, roughness: 0.55, metalness: 0.35 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFacade;\nvarying float vRoof;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacade = position;\nvRoof = abs(normal.y);');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vFacade;
        varying float vRoof;
        float facadeHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        vec2 cell = vec2((vFacade.x + vFacade.z) / 1.9, vFacade.y / 3.0);
        vec2 f = fract(cell);
        float pane = step(0.18, f.x) * step(f.x, 0.82) * step(0.22, f.y) * step(f.y, 0.78);
        float h = facadeHash(floor(cell));
        vec3 tint = h > 0.86 ? vec3(0.5, 0.9, 1.0) : h > 0.8 ? vec3(1.0, 0.55, 0.9) : vec3(1.0, 0.82, 0.55);
        totalEmissiveRadiance += tint * pane * step(0.55, h) * (1.0 - vRoof) * (0.25 + 0.75 * fract(h * 7.0)) * 0.85;`,
      );
  };
  mat.customProgramCacheKey = () => 'facade';
  return mat;
}

interface PropSlot {
  root: THREE.Group;
  kinds: Record<PropKind, THREE.Object3D[]>;
}

type LandmarkKind = 'billboard' | 'windmill' | 'waterTower' | 'cabin' | 'neon';

/** Landmark odds per zone (by zone index); 'none' leaves the slot empty for breathing room. */
const LANDMARKS: readonly (readonly [LandmarkKind | 'none', number])[][] = [
  [['billboard', 3], ['windmill', 1], ['none', 4]],
  [['windmill', 2], ['waterTower', 2], ['billboard', 2], ['none', 4]],
  [['cabin', 3], ['none', 6]],
  [['neon', 6], ['none', 2]],
];

interface LandmarkSlot {
  root: THREE.Group;
  kinds: Record<LandmarkKind, THREE.Object3D[]>;
}

/**
 * Scrolling highway: textured asphalt, gravel verges, guard rails, street lamps that pool light on the
 * road at night, overhead signs and zone-specific roadside props.
 */
export class Road {
  private readonly tex: THREE.Texture;
  private readonly roughTex: THREE.Texture;
  private readonly normalTex: THREE.Texture;
  private readonly wet = { value: 0 };
  private readonly rain = { value: 0 };
  private readonly scroll = { value: 0 };
  private readonly time = { value: 0 };
  private readonly studs: THREE.Group;
  private readonly studMat: THREE.MeshStandardMaterial;
  private readonly streakMat: THREE.MeshBasicMaterial;
  private readonly vergeTex: THREE.Texture;
  private readonly vergeMat: THREE.MeshStandardMaterial;
  private readonly posts: THREE.Group;
  private readonly lamps: THREE.Group;
  private readonly lampMat: THREE.MeshStandardMaterial;
  private readonly glowMat: THREE.PointsMaterial;
  private readonly poolMat: THREE.MeshBasicMaterial;
  private readonly gantry: THREE.Group;
  private readonly signMats: THREE.MeshStandardMaterial[] = [];
  private readonly signTextures = SIGNS.map((pair) => pair.map(signTexture));
  private readonly props: PropSlot[] = [];
  private readonly landmarks: LandmarkSlot[] = [];
  private readonly kit = new PropKit();
  private night = 0;
  private readonly rng: Rng = mulberry32(5);
  private offset = 0;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    const textures = roadTextures(renderer);
    this.tex = textures.map;
    this.roughTex = textures.roughness;
    this.normalTex = textures.normal;
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_HALF * 2, ROAD_LEN, 1, ROAD_SEGMENTS),
      roadMaterial(textures, this.wet, this.rain, this.scroll, this.time),
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, (ROAD_NEAR + ROAD_FAR) / 2);
    road.receiveShadow = true;
    scene.add(road);

    this.vergeTex = vergeTexture(renderer);
    this.vergeMat = new THREE.MeshStandardMaterial({ map: this.vergeTex, roughness: 1, transparent: true });
    for (const side of [-1, 1]) {
      const verge = new THREE.Mesh(new THREE.PlaneGeometry(VERGE_WIDTH, ROAD_LEN, 1, ROAD_SEGMENTS), this.vergeMat);
      verge.rotation.x = -Math.PI / 2;
      verge.scale.x = side; // mirrored so the fade always faces away from the road
      verge.position.set(side * (ROAD_HALF + VERGE_WIDTH / 2), -0.012, (ROAD_NEAR + ROAD_FAR) / 2);
      verge.receiveShadow = true;
      scene.add(verge);
    }

    // W-beam guard rails on posts.
    const steel = new THREE.MeshStandardMaterial({ color: 0xb3b7be, metalness: 0.75, roughness: 0.38 });
    const beam = new THREE.Shape();
    const ridges = 24;
    for (let k = 0; k <= ridges; k++) {
      const t = k / ridges;
      beam[k ? 'lineTo' : 'moveTo'](-0.045 * (0.5 - 0.5 * Math.cos(4 * Math.PI * t)), -0.16 + 0.32 * t);
    }
    for (let k = ridges; k >= 0; k--) {
      const t = k / ridges;
      beam.lineTo(-0.045 * (0.5 - 0.5 * Math.cos(4 * Math.PI * t)) + 0.008, -0.16 + 0.32 * t);
    }
    const railGeo = new THREE.ExtrudeGeometry(beam, { depth: ROAD_LEN, steps: ROAD_SEGMENTS, bevelEnabled: false, curveSegments: 1 });
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(railGeo, steel);
      rail.position.set(side * (ROAD_HALF + 0.4), 0.7, ROAD_FAR);
      rail.scale.x = side;
      rail.castShadow = true;
      scene.add(rail);
    }

    this.posts = new THREE.Group();
    const postZs = [];
    for (let z = ROAD_NEAR; z > ROAD_FAR; z -= POST_SPACING) postZs.push(z);
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.9, 0.16), steel, postZs.length * 2);
    const m = new THREE.Matrix4();
    postZs.forEach((z, i) => {
      posts.setMatrixAt(i * 2, m.makeTranslation(-(ROAD_HALF + 0.48), 0.45, z));
      posts.setMatrixAt(i * 2 + 1, m.makeTranslation(ROAD_HALF + 0.48, 0.45, z));
    });
    posts.castShadow = true;
    this.posts.add(posts);
    scene.add(this.posts);

    // Concrete kerbs edging the tarmac.
    const kerbMat = new THREE.MeshStandardMaterial({ color: 0xb9b4aa, roughness: 0.9 });
    for (const side of [-1, 1]) {
      const kerb = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, ROAD_LEN, 1, 1, ROAD_SEGMENTS), kerbMat);
      kerb.position.set(side * (ROAD_HALF + 0.12), 0.07, (ROAD_NEAR + ROAD_FAR) / 2);
      kerb.receiveShadow = true;
      scene.add(kerb);
    }

    // Raised pavement markers: white between the lanes, amber along the edges. They catch the
    // headlights, so they glow at night.
    this.studMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.3, emissive: 0xffffff, emissiveIntensity: 0.2 });
    const amberMat = this.studMat.clone();
    amberMat.color.set(0xffb13f);
    amberMat.emissive.set(0xffa020);
    this.studMat.userData.amber = amberMat;
    const studGeo = new RoundedBoxGeometry(0.16, 0.05, 0.12, 1, 0.02);
    const studZs: number[] = [];
    for (let z = ROAD_NEAR; z > ROAD_FAR; z -= STUD_SPACING) studZs.push(z);
    const laneStuds = new THREE.InstancedMesh(studGeo, this.studMat, studZs.length * (LANES - 1));
    const edgeStuds = new THREE.InstancedMesh(studGeo, amberMat, studZs.length * 2);
    studZs.forEach((z, i) => {
      for (let lane = 1; lane < LANES; lane++) {
        laneStuds.setMatrixAt(i * (LANES - 1) + lane - 1, m.makeTranslation(-ROAD_HALF + SHOULDER + lane * LANE_WIDTH, 0.025, z - 7.5));
      }
      edgeStuds.setMatrixAt(i * 2, m.makeTranslation(-ROAD_HALF + SHOULDER - 0.25, 0.025, z - 7.5));
      edgeStuds.setMatrixAt(i * 2 + 1, m.makeTranslation(ROAD_HALF - SHOULDER + 0.25, 0.025, z - 7.5));
    });
    this.studs = new THREE.Group();
    this.studs.add(laneStuds, edgeStuds);
    scene.add(this.studs);

    // Street lamps: tapered pole, swept arm, luminaire, a glow halo and a pool of light on the road.
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3c3f46, metalness: 0.6, roughness: 0.45 });
    this.lampMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffd9a0, emissiveIntensity: 2.5 });
    const glow = radialTexture();
    this.glowMat = new THREE.PointsMaterial({
      map: glow,
      color: 0xffd5a0,
      size: 3.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    this.poolMat = new THREE.MeshBasicMaterial({
      map: glow,
      color: 0xffc98a,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const poleGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.08, 0.14, 9, 10).translate(0, 4.5, 0),
      new THREE.CylinderGeometry(0.22, 0.26, 0.5, 10).translate(0, 0.25, 0),
    ]);
    const armGeo = new THREE.TubeGeometry(
      new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 8.7, 0), new THREE.Vector3(0, 9.55, 0), new THREE.Vector3(-2.4, 9.35, 0)),
      14,
      0.055,
      6,
    );
    const headGeo = new RoundedBoxGeometry(1.0, 0.15, 0.42, 2, 0.05).translate(-2.75, 9.32, 0);
    const lensGeo = new THREE.PlaneGeometry(0.82, 0.3).rotateX(Math.PI / 2).translate(-2.75, 9.24, 0);
    const poolGeo = new THREE.PlaneGeometry(15, 17).rotateX(-Math.PI / 2).translate(-3.6, 0.02, 0);
    this.streakMat = new THREE.MeshBasicMaterial({
      map: streakTexture(),
      color: 0xffc98a,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    // Runs from under the lamp towards the camera (+z), as reflections on a wet road do.
    const streakGeo = new THREE.PlaneGeometry(1.1, 22, 1, 8).rotateX(-Math.PI / 2).translate(-2.75, 0.03, 9);
    // Every lamp is the same, so each part is one instanced draw for the whole row. Left-side lamps are
    // turned round rather than mirrored, so the arm still reaches over the road with faces the right way out.
    const lampSpots: THREE.Matrix4[] = [];
    for (let z = ROAD_NEAR; z > ROAD_FAR; z -= LAMP_SPACING) {
      for (const side of [-1, 1]) {
        lampSpots.push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(side * (ROAD_HALF + 1.6), 0, z),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), side > 0 ? 0 : Math.PI),
            new THREE.Vector3(1, 1, 1),
          ),
        );
      }
    }
    const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, shadow = false) => {
      const mesh = new THREE.InstancedMesh(geo, mat, lampSpots.length);
      lampSpots.forEach((spot, i) => mesh.setMatrixAt(i, spot));
      mesh.castShadow = shadow;
      return mesh;
    };
    const body = mergeGeometries([poleGeo, armGeo, headGeo].map((g) => (g.index ? g.toNonIndexed() : g)));
    const halos = new THREE.BufferGeometry().setFromPoints(lampSpots.map((spot) => new THREE.Vector3(-2.75, 9.1, 0).applyMatrix4(spot)));
    this.lamps = new THREE.Group();
    this.lamps.add(
      instanced(body, poleMat, true),
      instanced(lensGeo, this.lampMat),
      instanced(poolGeo, this.poolMat),
      instanced(streakGeo, this.streakMat),
      new THREE.Points(halos, this.glowMat),
    );
    scene.add(this.lamps);

    this.gantry = this.buildGantry();
    scene.add(this.gantry);
    // Signs are first drawn before the UI font loads; redraw them once it has.
    void document.fonts.ready.then(() =>
      this.signTextures.forEach((pair, z) =>
        pair.forEach((tex, i) => {
          drawSign(tex.image as HTMLCanvasElement, SIGNS[z][i]);
          tex.needsUpdate = true;
        }),
      ),
    );

    this.buildProps(scene);
    this.reset();
  }

  /** Re-dresses every roadside slot and the sign gantry for the start of a run. */
  reset() {
    this.props.forEach((slot, i) => this.placeProp(slot, ROAD_NEAR - (i / PROP_COUNT) * ROAD_LEN, 0));
    // Landmarks start a little way up the road so none parks beside the car on the menu.
    this.landmarks.forEach((slot, i) => this.placeLandmark(slot, -40 - (i / LANDMARK_COUNT) * (ROAD_LEN - 70), 0));
    this.placeGantry(-260, 0);
  }

  applyPalette(p: Palette) {
    this.lampMat.emissiveIntensity = p.lampGlow;
    // Halos and pools only show once it is dark enough for street lights to matter.
    this.glowMat.opacity = 0.08 + smoothstep(1, 7, p.lampGlow) * 0.85;
    this.poolMat.opacity = smoothstep(1.5, 7, p.lampGlow) * 0.32;
    this.vergeMat.color.copy(p.verge);
    this.wet.value = p.wet;
    this.rain.value = p.rain;
    const night = smoothstep(1, 7, p.lampGlow);
    this.night = night;
    this.streakMat.opacity = p.wet * (0.1 + night * 0.4);
    this.studMat.emissiveIntensity = 0.1 + night * 0.9;
    (this.studMat.userData.amber as THREE.MeshStandardMaterial).emissiveIntensity = 0.1 + night * 0.9;
    for (const m of this.signMats) m.emissiveIntensity = 0.12 + smoothstep(1, 7, p.lampGlow) * 0.5;
  }

  update(delta: number, distance: number) {
    this.offset += delta;
    const v = (this.offset / ROAD_TILE) % 1;
    this.tex.offset.y = this.roughTex.offset.y = this.normalTex.offset.y = v;
    this.scroll.value = this.offset % 10000;
    this.time.value = performance.now() / 1000;
    this.studs.position.z = this.offset % STUD_SPACING;
    this.vergeTex.offset.y = (this.offset / VERGE_WIDTH) % 1;
    this.posts.position.z = this.offset % POST_SPACING;
    this.lamps.position.z = this.offset % LAMP_SPACING;
    for (const slot of this.props) {
      slot.root.position.z += delta;
      if (slot.root.position.z > ROAD_NEAR) this.placeProp(slot, slot.root.position.z - ROAD_LEN, distance);
    }
    for (const slot of this.landmarks) {
      slot.root.position.z += delta;
      if (slot.root.position.z > ROAD_NEAR + 15) this.placeLandmark(slot, slot.root.position.z - ROAD_LEN, distance);
    }
    this.kit.update(this.time.value, this.night);
    this.gantry.position.z += delta;
    if (this.gantry.position.z > ROAD_NEAR + 10) this.placeGantry(this.gantry.position.z - GANTRY_SPACING, distance);
    this.gantry.visible = this.gantry.position.z > ROAD_FAR;
  }

  private buildGantry() {
    const g = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x8e939b, metalness: 0.7, roughness: 0.45 });
    const span = ROAD_HALF * 2 + 2.4;
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 9.6, 0.35).translate(0, 4.8, 0), steel);
      post.position.x = side * (span / 2);
      post.castShadow = true;
      g.add(post);
    }
    for (const y of [8.25, 9.35]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 0.22, 0.3), steel);
      beam.position.set(0, y, -0.25);
      g.add(beam);
    }
    for (const x of [-3.7, 3.7]) {
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.15 });
      this.signMats.push(mat);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 2.4), mat);
      panel.position.set(x, 8.85, 0);
      const back = new THREE.Mesh(new THREE.BoxGeometry(5.7, 2.5, 0.1), steel);
      back.position.set(x, 8.85, -0.07);
      g.add(panel, back);
    }
    return g;
  }

  /** Moves the gantry to `z`, signed for the zone the player will be in when they pass under it. */
  private placeGantry(z: number, distance: number) {
    this.gantry.position.z = z;
    const { index } = zoneAt(Math.max(0, distance - z));
    this.signMats.forEach((m, i) => {
      m.map = this.signTextures[index % ZONES.length][i];
      m.emissiveMap = m.map;
      m.needsUpdate = true;
    });
  }

  private buildProps(scene: THREE.Scene) {
    const bark = new THREE.MeshStandardMaterial({ color: PALETTE.palmTrunk, roughness: 0.95 });
    const palmMats = [bark, new THREE.MeshStandardMaterial({ color: PALETTE.palmLeaf, roughness: 0.75, side: THREE.DoubleSide })];
    const pineMats = [
      new THREE.MeshStandardMaterial({ color: 0x4a3426, roughness: 1 }),
      new THREE.MeshStandardMaterial({ color: 0x23402c, roughness: 0.9 }),
    ];
    const rockMat = new THREE.MeshStandardMaterial({ color: 0xd2c8b9, roughness: 0.95 });
    const palms = [11, 12].map(palmGeometry);
    const rocks = [21, 22, 23].map(rockGeometry);
    const pines = [31, 32].map(pineGeometry);
    const facade = facadeMaterial();
    const roofKit = new THREE.MeshStandardMaterial({ color: 0x1d1b25, roughness: 0.7, metalness: 0.4 });
    const towers = ([[12, 34, 12], [9, 52, 9], [16, 22, 13], [8, 70, 8], [13, 42, 15]] as const).map(([w, h, d], i) => ({
      geo: towerGeometry(w, h, d, 40 + i),
      mats: [facade, new THREE.MeshStandardMaterial({ color: 0x111111, emissive: NEON[i % NEON.length], emissiveIntensity: 3 }), roofKit],
    }));

    for (let i = 0; i < PROP_COUNT; i++) {
      const root = new THREE.Group();
      const shadowed = (mesh: THREE.Mesh) => {
        mesh.castShadow = true;
        return mesh;
      };
      const kinds: Record<PropKind, THREE.Object3D[]> = {
        palm: palms.map((g) => shadowed(new THREE.Mesh(g, palmMats))),
        rock: rocks.map((g) => shadowed(new THREE.Mesh(g, rockMat))),
        pine: pines.map((g) => shadowed(new THREE.Mesh(g, pineMats))),
        tower: towers.map((t) => new THREE.Mesh(t.geo, t.mats)),
      };
      root.add(...Object.values(kinds).flat());
      scene.add(root);
      this.props.push({ root, kinds });
    }

    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const root = new THREE.Group();
      const kinds: Record<LandmarkKind, THREE.Object3D[]> = {
        billboard: [this.kit.billboard(i), this.kit.billboard(i + 2)],
        windmill: [this.kit.windmill()],
        waterTower: [this.kit.waterTower()],
        cabin: [this.kit.cabin()],
        neon: [this.kit.neonSign(i), this.kit.neonSign(i + 3)],
      };
      root.add(...Object.values(kinds).flat());
      scene.add(root);
      this.landmarks.push({ root, kinds });
    }
  }

  /** Puts a landmark slot at `z`: a billboard, windmill, cabin or neon sign fitting the zone, or nothing. */
  private placeLandmark(slot: LandmarkSlot, z: number, distance: number) {
    const odds = LANDMARKS[zoneAt(Math.max(0, distance - z)).index];
    let roll = this.rng() * odds.reduce((sum, [, w]) => sum + w, 0);
    let kind: LandmarkKind | 'none' = 'none';
    for (const [k, w] of odds) {
      roll -= w;
      if (roll <= 0) {
        kind = k;
        break;
      }
    }
    const options = kind === 'none' ? [] : slot.kinds[kind];
    const chosen = options[Math.floor(this.rng() * options.length)];
    for (const list of Object.values(slot.kinds)) for (const obj of list) obj.visible = obj === chosen;
    const side = this.rng() < 0.5 ? -1 : 1;
    const root = slot.root;
    root.position.z = z;
    root.rotation.set(0, 0, 0);
    const out = { billboard: [9, 18], windmill: [14, 40], waterTower: [22, 45], cabin: [16, 34], neon: [3, 6], none: [0, 0] }[kind];
    root.position.x = side * (ROAD_HALF + out[0] + this.rng() * (out[1] - out[0]));
    // Turn faces towards the oncoming camera (+z) and a little towards the road.
    if (kind === 'billboard') root.rotation.y = -side * 0.35;
    else if (kind === 'cabin') root.rotation.y = -side * (Math.PI / 2 - 0.55);
    else if (kind !== 'neon') root.rotation.y = this.rng() * Math.PI * 2;
  }

  /** Puts a slot at `z`, dressed for the zone the player will be in when they reach it. */
  private placeProp(slot: PropSlot, z: number, distance: number) {
    // Slots behind the camera (z > 0) belong to road already driven, never a negative distance.
    const kind = zoneAt(Math.max(0, distance - z)).zone.props;
    const options = slot.kinds[kind];
    const chosen = options[Math.floor(this.rng() * options.length)];
    for (const list of Object.values(slot.kinds)) for (const obj of list) obj.visible = obj === chosen;

    const side = this.rng() < 0.5 ? -1 : 1;
    const root = slot.root;
    root.rotation.set(0, 0, 0);
    root.scale.setScalar(1);
    if (kind === 'palm') {
      root.position.set(side * (ROAD_HALF + 5 + this.rng() * 26), 0, z);
      root.rotation.y = this.rng() * Math.PI * 2;
      root.scale.setScalar(0.8 + this.rng() * 0.5);
    } else if (kind === 'rock') {
      root.position.set(side * (ROAD_HALF + 6 + this.rng() * 40), 0, z);
      root.rotation.y = this.rng() * Math.PI * 2;
      root.scale.set(1.5 + this.rng() * 3, 0.8 + this.rng() * 1.8, 1.5 + this.rng() * 3);
    } else if (kind === 'pine') {
      root.position.set(side * (ROAD_HALF + 7 + this.rng() * 30), 0, z);
      root.rotation.y = this.rng() * Math.PI * 2;
      root.scale.setScalar(0.9 + this.rng() * 0.5);
    } else {
      root.position.set(side * (ROAD_HALF + 14 + this.rng() * 22), 0, z);
      root.rotation.y = (this.rng() - 0.5) * 0.3;
    }
  }
}
