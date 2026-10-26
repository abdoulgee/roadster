import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ItemKind } from '../config';

// Procedural 3D models for everything lying on the road: the air coins, the golden star and the item
// capsules. Geometry and materials are built once and shared by every copy.

const canvasTexture = (size: number, draw: (c: CanvasRenderingContext2D, s: number) => void, srgb = true) => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d')!, size);
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
};

/** A soft round glow for additive halos. */
export const glowTexture = canvasTexture(128, (c, s) => {
  const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.14)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, s, s);
});

/** A four-point twinkle for sparkles. */
const sparkleTexture = canvasTexture(64, (c, s) => {
  const m = s / 2;
  const g = c.createRadialGradient(m, m, 0, m, m, m);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(m, 0);
  c.quadraticCurveTo(m, m, s, m);
  c.quadraticCurveTo(m, m, m, s);
  c.quadraticCurveTo(m, m, 0, m);
  c.quadraticCurveTo(m, m, m, 0);
  c.fill();
});

const additive = (map: THREE.Texture, color: THREE.ColorRepresentation, opacity = 1) =>
  new THREE.SpriteMaterial({ map, color, opacity, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });

// ---------- air coin ----------

/** The coin face: brushed radial metal, a groove ring and the air emblem, as colour and as height. */
function drawCoinFace(c: CanvasRenderingContext2D, s: number, height: boolean) {
  const m = s / 2;
  if (height) {
    c.fillStyle = '#808080';
    c.fillRect(0, 0, s, s);
  } else {
    const g = c.createRadialGradient(m * 0.8, m * 0.7, 0, m, m, m);
    g.addColorStop(0, '#f4feff');
    g.addColorStop(0.55, '#9fe4f5');
    g.addColorStop(1, '#4ab3cf');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
    // Fine concentric machining marks.
    c.globalAlpha = 0.07;
    for (let r = 4; r < m; r += 3) {
      c.strokeStyle = r % 2 ? '#ffffff' : '#0d4a5c';
      c.beginPath();
      c.arc(m, m, r, 0, Math.PI * 2);
      c.stroke();
    }
    c.globalAlpha = 1;
  }
  const ink = height ? '#ffffff' : '#e9fdff';
  const groove = height ? '#303030' : '#2b8fac';
  // Groove just inside the rim, then a raised bead.
  c.lineWidth = s * 0.025;
  c.strokeStyle = groove;
  c.beginPath();
  c.arc(m, m, m * 0.84, 0, Math.PI * 2);
  c.stroke();
  c.lineWidth = s * 0.02;
  c.strokeStyle = ink;
  c.beginPath();
  c.arc(m, m, m * 0.77, 0, Math.PI * 2);
  c.stroke();
  // Air emblem: three swept gusts.
  c.lineCap = 'round';
  c.lineWidth = s * 0.055;
  c.strokeStyle = height ? '#ffffff' : '#ffffff';
  if (!height) {
    c.shadowColor = '#1d7f9c';
    c.shadowBlur = s * 0.02;
    c.shadowOffsetY = s * 0.008;
  }
  const gust = (y: number, len: number, curl: number) => {
    c.beginPath();
    c.moveTo(m - s * 0.26, y);
    c.lineTo(m + s * len, y);
    c.arc(m + s * len, y - s * curl, s * curl, Math.PI / 2, -Math.PI * 0.75, true);
    c.stroke();
  };
  gust(m - s * 0.1, 0.12, 0.07);
  gust(m + s * 0.03, 0.2, 0.08);
  c.beginPath();
  c.moveTo(m - s * 0.2, m + s * 0.16);
  c.lineTo(m + s * 0.08, m + s * 0.16);
  c.stroke();
}

const coinFace = canvasTexture(256, (c, s) => drawCoinFace(c, s, false));
const coinBump = canvasTexture(256, (c, s) => drawCoinFace(c, s, true), false);

export const COIN_RADIUS = 0.42;

/** The coin body (faces carry the emblem, mapped by the cylinder caps) and its separate milled rim. */
export const coinGeometry = new THREE.CylinderGeometry(COIN_RADIUS, COIN_RADIUS, 0.07, 48, 1).rotateX(Math.PI / 2);
export const coinRimGeometry = new THREE.TorusGeometry(COIN_RADIUS - 0.012, 0.042, 10, 48);

export const coinMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  map: coinFace,
  bumpMap: coinBump,
  bumpScale: 2.2,
  metalness: 0.9,
  roughness: 0.24,
  clearcoat: 0.6,
  clearcoatRoughness: 0.15,
  // A little self-light so the coins still read on the night roads.
  emissive: 0x2ab6dc,
  emissiveMap: coinFace,
  emissiveIntensity: 0.32,
});

export const coinRimMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xc9f3ff,
  metalness: 1,
  roughness: 0.18,
  clearcoat: 1,
  emissive: 0x3fc8ee,
  emissiveIntensity: 0.4,
});

/** Additive halo drawn behind every coin (as one Points cloud). */
export const coinGlowMaterial = new THREE.PointsMaterial({
  map: glowTexture,
  color: 0x5fdcff,
  size: 1.5,
  sizeAttenuation: true,
  transparent: true,
  opacity: 0.32,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});

// ---------- golden star ----------

/** A five-point star with a ridge down every point: faceted like cut metal, peaked front and back. */
function starGeometry() {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 1 : 0.46;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
  }
  const front = new THREE.Vector3(0, 0, 0.36);
  const back = new THREE.Vector3(0, 0, -0.36);
  const pos: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let i = 0; i < 10; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 10];
    tri(a, b, front);
    tri(b, a, back);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

const starGeo = starGeometry();
const starMat = new THREE.MeshPhysicalMaterial({
  color: 0xffc21f,
  metalness: 1,
  roughness: 0.16,
  clearcoat: 1,
  clearcoatRoughness: 0.05,
  emissive: 0xff8a00,
  emissiveIntensity: 0.55,
  flatShading: true,
});
const starHalo = additive(glowTexture, 0xffc23a, 0.85);
const starSparkle = additive(sparkleTexture, 0xfff3c0);

export function buildStar() {
  const group = new THREE.Group();
  const spin = new THREE.Group();
  spin.name = 'spin';
  const star = new THREE.Mesh(starGeo, starMat);
  star.scale.setScalar(0.95);
  spin.add(star);
  const halo = new THREE.Sprite(starHalo);
  halo.scale.setScalar(4.2);
  const sparkles = new THREE.Group();
  sparkles.name = 'sparkles';
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Sprite(starSparkle);
    const a = (i / 6) * Math.PI * 2;
    s.position.set(Math.cos(a) * 1.35, Math.sin(a * 2) * 0.35, Math.sin(a) * 1.35);
    s.scale.setScalar(0.32 + (i % 3) * 0.12);
    sparkles.add(s);
  }
  group.add(halo, spin, sparkles);
  return group;
}

// ---------- item capsules ----------

/** A glass bubble: clear in the middle, glowing at the rim, with a slow scan band rolling over it. */
const BUBBLE_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vY;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    vY = position.y;
    gl_Position = projectionMatrix * mv;
  }
`;

const BUBBLE_FRAGMENT = /* glsl */ `
  uniform vec3 color;
  uniform float time;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vY;
  void main() {
    float facing = abs(dot(normalize(vNormal), vView));
    float rim = pow(1.0 - facing, 3.4);
    float scan = smoothstep(0.05, 0.0, abs(fract(vY * 0.9 - time * 0.45) - 0.5)) * 0.18;
    // A hard specular glint from a light up and to the left, like a glass ball.
    vec3 h = normalize(vView + normalize(vec3(-0.5, 0.8, 0.4)));
    float glint = pow(max(dot(normalize(vNormal), h), 0.0), 90.0);
    vec3 c = color * (rim * 1.5 + scan + 0.015) + vec3(glint * 1.2);
    gl_FragColor = vec4(c, 1.0);
  }
`;

const bubbleGeo = new THREE.SphereGeometry(0.88, 40, 24);
const ringGeo = new THREE.TorusGeometry(1.0, 0.022, 8, 64);

interface ItemLook {
  bubble: THREE.ShaderMaterial;
  ring: THREE.MeshStandardMaterial;
  halo: THREE.SpriteMaterial;
  model: () => THREE.Object3D;
}

const looks = new Map<ItemKind, ItemLook>();

const physical = (p: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial({ clearcoat: 1, clearcoatRoughness: 0.06, ...p });

/** A pressure-vessel silhouette (radius, height) turned on a lathe: domed shoulders and a neck. */
function vesselGeometry(r: number, h: number, neck: number) {
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, -h / 2)];
  for (let k = 0; k <= 8; k++) {
    const a = (k / 8) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r * Math.sin(a), -h / 2 + r * 0.35 * (1 - Math.cos(a))));
  }
  for (let k = 0; k <= 12; k++) {
    const a = (k / 12) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(neck, r * Math.cos(a)), h / 2 - r * 0.85 + r * 0.85 * Math.sin(a)));
  }
  pts.push(new THREE.Vector2(neck, h / 2 + 0.06), new THREE.Vector2(0, h / 2 + 0.06));
  return new THREE.LatheGeometry(pts, 40);
}

const band = (r: number, h: number, y: number) => new THREE.CylinderGeometry(r, r, h, 40, 1, true).translate(0, y, 0);

function airCanModel(big: boolean) {
  const g = new THREE.Group();
  const r = big ? 0.27 : 0.21;
  const h = big ? 0.86 : 0.74;
  const body = new THREE.Mesh(
    vesselGeometry(r, h, 0.06),
    big
      ? physical({ color: 0x1b1f25, metalness: 0.4, roughness: 0.35 }) // carbon-wrapped tank
      : physical({ color: 0xeef3f6, metalness: 0.75, roughness: 0.22 }), // polished aluminium can
  );
  const stripe = new THREE.Mesh(
    mergeGeometries(big ? [band(r + 0.004, 0.05, 0.12), band(r + 0.004, 0.05, -0.16)] : [band(r + 0.004, 0.11, 0.0)]),
    new THREE.MeshStandardMaterial({ color: 0x0a2830, emissive: big ? 0xd8f6ff : 0x5fe3ff, emissiveIntensity: 2.2, side: THREE.DoubleSide }),
  );
  const chrome = physical({ color: 0xd5dadf, metalness: 1, roughness: 0.12 });
  const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 20).translate(0, h / 2 + 0.11, 0), chrome);
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.035, 20).translate(0, h / 2 + 0.17, 0), chrome);
  g.add(body, stripe, valve, knob);
  if (big) {
    // Pressure gauge on the shoulder.
    const gauge = new THREE.Group();
    gauge.position.set(0, h / 2 - 0.06, r * 0.72);
    gauge.rotation.x = -0.6;
    gauge.add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.04, 24).rotateX(Math.PI / 2), chrome));
    const dial = new THREE.Mesh(new THREE.CircleGeometry(0.075, 24).translate(0, 0, 0.021), new THREE.MeshStandardMaterial({ color: 0xf2f2ee, emissive: 0xffffff, emissiveIntensity: 0.4 }));
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.06, 0.004).translate(0, 0.028, 0.024), new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
    needle.rotation.z = -1.1; // pinned past the red line
    gauge.add(dial, needle);
    g.add(gauge);
  }
  g.rotation.z = 0.25;
  return g;
}

function shieldShape(scale: number) {
  const s = new THREE.Shape();
  s.moveTo(0, 0.5 * scale);
  s.bezierCurveTo(0.18 * scale, 0.42 * scale, 0.3 * scale, 0.4 * scale, 0.4 * scale, 0.4 * scale);
  s.bezierCurveTo(0.4 * scale, 0.0, 0.28 * scale, -0.3 * scale, 0, -0.52 * scale);
  s.bezierCurveTo(-0.28 * scale, -0.3 * scale, -0.4 * scale, 0.0, -0.4 * scale, 0.4 * scale);
  s.bezierCurveTo(-0.3 * scale, 0.4 * scale, -0.18 * scale, 0.42 * scale, 0, 0.5 * scale);
  return s;
}

function heatShieldModel() {
  const g = new THREE.Group();
  const extrude = (scale: number, depth: number, bevel: number) =>
    new THREE.ExtrudeGeometry(shieldShape(scale), { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 4, curveSegments: 24 }).center();
  // Ceramic plate with a raised, glowing core tile.
  g.add(new THREE.Mesh(extrude(1.25, 0.08, 0.05), physical({ color: 0xff7a1f, metalness: 0.35, roughness: 0.3 })));
  const core = new THREE.Mesh(
    extrude(0.78, 0.06, 0.03),
    physical({ color: 0x2a0f05, metalness: 0.2, roughness: 0.25, emissive: 0xff6a00, emissiveIntensity: 1.2 }),
  );
  core.position.z = 0.08;
  g.add(core);
  const rim = new THREE.Mesh(extrude(1.25, 0.02, 0.012), physical({ color: 0xf4f0ea, metalness: 1, roughness: 0.15 }));
  rim.position.z = -0.075;
  g.add(rim);
  return g;
}

function shockwaveModel() {
  const g = new THREE.Group();
  g.add(
    new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.3, 0),
      physical({ color: 0x6b3bd6, metalness: 0.2, roughness: 0.1, emissive: 0x9a5cff, emissiveIntensity: 1.6, flatShading: true }),
    ),
  );
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x1a0d33, emissive: 0xc9a2ff, emissiveIntensity: 2.6 });
  const rings = new THREE.Group();
  rings.name = 'gyro';
  [0, Math.PI / 2, Math.PI / 4].forEach((a, i) => {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.45 + i * 0.07, 0.016, 8, 48), ringMat);
    r.rotation.set(a, i * 0.9, 0);
    rings.add(r);
  });
  g.add(rings);
  return g;
}

function ludicrousModel() {
  const bolt = new THREE.Shape();
  [[0.12, 0.6], [-0.3, -0.04], [-0.02, -0.04], [-0.14, -0.6], [0.3, 0.08], [0.02, 0.08]].forEach(([x, y], i) =>
    i ? bolt.lineTo(x, y) : bolt.moveTo(x, y),
  );
  bolt.closePath();
  const geo = new THREE.ExtrudeGeometry(bolt, { depth: 0.1, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 3 }).center();
  return new THREE.Mesh(geo, physical({ color: 0xff4fb3, metalness: 0.9, roughness: 0.18, emissive: 0xff1f8f, emissiveIntensity: 0.9 }));
}

const MODELS: Record<ItemKind, () => THREE.Object3D> = {
  airCan: () => airCanModel(false),
  overpressure: () => airCanModel(true),
  shield: heatShieldModel,
  shockwave: shockwaveModel,
  ludicrous: ludicrousModel,
};

function lookFor(kind: ItemKind, color: number) {
  let look = looks.get(kind);
  if (!look) {
    look = {
      bubble: new THREE.ShaderMaterial({
        vertexShader: BUBBLE_VERTEX,
        fragmentShader: BUBBLE_FRAGMENT,
        uniforms: { color: { value: new THREE.Color(color) }, time: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      ring: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: 2.4 }),
      halo: additive(glowTexture, color, 0.5),
      model: MODELS[kind],
    };
    looks.set(kind, look);
  }
  return look;
}

/** An item capsule: the item's 3D model turning inside a glass bubble, ringed and haloed in its colour. */
export function buildItemCapsule(kind: ItemKind, color: number) {
  const look = lookFor(kind, color);
  const group = new THREE.Group();
  const halo = new THREE.Sprite(look.halo);
  halo.scale.setScalar(3.4);
  const spin = new THREE.Group();
  spin.name = 'spin';
  spin.add(look.model());
  const ring = new THREE.Mesh(ringGeo, look.ring);
  ring.name = 'ring';
  ring.rotation.x = Math.PI / 2 - 0.35;
  const bubble = new THREE.Mesh(bubbleGeo, look.bubble);
  bubble.renderOrder = 2;
  group.add(halo, spin, ring, bubble);
  return group;
}

/** Advances the shared bubble shimmer; call once a frame. */
export function tickItemLooks(time: number) {
  for (const look of looks.values()) look.bubble.uniforms.time.value = time;
}
