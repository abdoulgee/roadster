import * as THREE from 'three';
import { SUN_DIR } from '../config';
import { IS_TOUCH } from '../systems/input';
import { mulberry32 } from '../util/rng';
import { smoothstep } from '../util/shape';
import { NOISE_GLSL } from './glsl';
import { ZONE_FIELD_GLSL, type ZoneField } from './zoneField';
import { ZONES, type Palette } from './zones';

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Gradient sky with a sun, a drifting cloud deck and stars that come out when the zone says so.
const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 top;
  uniform vec3 mid;
  uniform vec3 horizon;
  uniform vec3 sunColor;
  uniform vec3 sunDir;
  uniform float clouds;
  uniform float stars;
  uniform float aurora;
  uniform float time;
  varying vec3 vDir;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p = p * 2.07 + 13.1;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    vec3 col = mix(horizon, mid, smoothstep(-0.02, 0.22, d.y));
    col = mix(col, top, smoothstep(0.22, 0.75, d.y));
    float s = max(dot(d, sunDir), 0.0);

    if (stars > 0.0 && d.y > 0.0) {
      vec3 q = floor(d * 380.0);
      float h = hash(q.xy + q.z * vec2(7.13, 3.71));
      float twinkle = 0.65 + 0.35 * sin(time * 3.0 + h * 60.0);
      col += vec3(0.9, 0.92, 1.0) * step(0.9972, h) * twinkle * stars * smoothstep(0.04, 0.35, d.y);

      // A shooting star every few seconds: a short streak sliding down across the sky.
      float slot = floor(time / 3.5);
      float age = fract(time / 3.5) * 3.5;
      if (age < 0.7) {
        vec2 start = vec2(hash(vec2(slot, 1.3)) * 1.6 - 0.8, 0.35 + hash(vec2(slot, 7.1)) * 0.3);
        vec2 heading = normalize(vec2(hash(vec2(slot, 3.7)) > 0.5 ? 1.0 : -1.0, -0.45));
        vec2 head = start + heading * age * 0.55;
        vec2 sky = vec2(atan(d.x, -d.z), asin(d.y));
        vec2 rel = sky - head;
        float along = dot(rel, -heading);
        float across = abs(rel.x * heading.y - rel.y * heading.x);
        float trail = step(0.0, along) * (1.0 - smoothstep(0.0, 0.16, along)) * (1.0 - smoothstep(0.0, 0.0025, across));
        col += vec3(0.85, 0.9, 1.0) * trail * stars * 2.5 * (1.0 - age / 0.7);
      }
    }

    if (aurora > 0.001 && d.y > 0.12) {
      vec2 sky = vec2(atan(d.x, -d.z), asin(d.y));
      float drift = sky.x * 2.8 + fbm(vec2(sky.x * 2.0, time * 0.045)) * 1.8 + time * 0.08;
      float folds = 0.5 + 0.5 * sin(drift * 3.0 + sky.x * 4.0);
      float band = smoothstep(0.18, 0.42, sky.y + sin(sky.x * 3.2 + time * 0.06) * 0.11)
                 * (1.0 - smoothstep(0.72, 1.0, sky.y));
      float veil = smoothstep(0.38, 0.78, fbm(vec2(sky.x * 3.4 + time * 0.035, sky.y * 5.0 + drift)));
      float light = band * veil * (0.25 + 0.75 * pow(folds, 3.0)) * aurora;
      vec3 curtain = mix(vec3(0.04, 0.9, 0.62), vec3(0.28, 0.3, 1.0), smoothstep(0.35, 0.88, folds));
      col += curtain * light * 0.72;
    }

    float cover = 0.0;
    if (clouds > 0.0 && d.y > 0.0) {
      // Clouds live on a flat deck overhead, so they bunch up naturally towards the horizon.
      vec2 p = d.xz / (d.y + 0.06) * 1.3 + vec2(time * 0.012, time * 0.004);
      float n = fbm(p) * 0.7 + fbm(p * 2.3 + 4.0) * 0.3;
      float threshold = 0.72 - clouds * 0.3;
      cover = smoothstep(threshold - 0.05, threshold + 0.18, n) * smoothstep(0.0, 0.1, d.y);
      vec3 lit = mix(mid * 1.15, sunColor, 0.25 + 0.6 * pow(s, 3.0));
      vec3 shade = mix(horizon, top, 0.35) * 0.85;
      vec3 cloud = mix(shade, lit, smoothstep(threshold, threshold + 0.25, n));
      col = mix(col, cloud, cover * 0.9);
    }

    col += sunColor * (pow(s, 2400.0) * 9.0 + pow(s, 60.0) * 0.32 + pow(s, 6.0) * 0.14) * (1.0 - cover * 0.75);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const GROUND_TILE = 24;

// Neutral mottled ground; the material colour tints it per zone.
function groundTexture(renderer: THREE.WebGLRenderer) {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  const rng = mulberry32(7);
  // Broad patches, drawn three times offset so they tile seamlessly.
  for (let i = 0; i < 70; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 30 + rng() * 90;
    const shade = rng() < 0.5 ? '0,0,0' : '255,255,255';
    for (const [ox, oy] of [[0, 0], [-size, 0], [size, 0], [0, -size], [0, size]]) {
      const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, `rgba(${shade}, ${0.05 + rng() * 0.05})`);
      g.addColorStop(1, `rgba(${shade}, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
  for (let i = 0; i < 9000; i++) {
    const shade = 150 + Math.floor(rng() * 90);
    ctx.fillStyle = `rgba(${shade}, ${shade}, ${shade}, ${0.18 + rng() * 0.3})`;
    ctx.fillRect(rng() * size, rng() * size, 1 + rng() * 2.5, 1 + rng() * 1.5);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

/** Coloured blocks of light for the city's reflection band: shop fronts, signs and windows. */
function neonBandTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const rng = mulberry32(17);
  const colors = ['#ff3fa8', '#3fe0ff', '#b07bff', '#ffb13f', '#ffffff'];
  for (let i = 0; i < 140; i++) {
    ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
    ctx.globalAlpha = 0.4 + rng() * 0.6;
    ctx.fillRect(rng() * 1024, 8 + rng() * 40, 4 + rng() * 26, 2 + rng() * 14);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/**
 * A ring of mountains facing the road: ridged random-phase waves make a natural skyline. The ring
 * is static; the player never travels in z, so it reads as a distant backdrop.
 */
function ridgeGeometry(radius: number, height: number, seed: number) {
  const rng = mulberry32(seed);
  // Whole-number frequencies so the ring closes without a step.
  const waves = Array.from({ length: 7 }, (_, i) => ({
    f: Math.round(3 + i * 4.3 + rng() * 3),
    a: 1 / (i + 1) ** 0.85,
    p: rng() * Math.PI * 2,
  }));
  const norm = waves.reduce((s, w) => s + w.a, 0);
  const crest = (a: number) => {
    let v = 0;
    for (const w of waves) v += w.a * (1 - Math.abs(Math.sin(w.f * a * 0.5 + w.p)));
    return Math.pow(v / norm, 1.6);
  };
  const segs = 280;
  const rows = [
    [0, 1.0],
    [0.35, 0.985],
    [0.75, 0.965],
    [1, 0.95],
  ] as const;
  const pos: number[] = [];
  const index: number[] = [];
  const jitter = rng() * 10;
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2 + Math.PI; // the wrap point sits behind the camera
    const peak = height * (0.25 + 0.75 * crest(a));
    for (const [k, r] of rows) {
      const y = -8 + (peak + 8) * k * (k < 1 ? 1 + 0.08 * Math.sin(a * 23 + jitter + k * 5) : 1);
      pos.push(Math.sin(a) * radius * r, y, -Math.cos(a) * radius * r);
    }
  }
  const n = rows.length;
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < n - 1; j++) {
      const a = i * n + j;
      const b = (i + 1) * n + j;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Ground that looks different in every zone, drawn in the shader from world position: wind-rippled
 * sand with scrub, a cracked salt crust, a meadow with flowers and dirt, and paved city lots. The zone
 * field cross-fades them along the road exactly as the palette does.
 */
function groundMaterial(map: THREE.Texture, field: ZoneField, scroll: { value: number }) {
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 1 });
  const base = ZONES.map((z) => new THREE.Color(z.palette.ground));
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uZoneField = { value: field.texture };
    shader.uniforms.uZoneFieldExtra = { value: field.extraTexture };
    shader.uniforms.uScroll = scroll;
    shader.uniforms.uBase = { value: base };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGround;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vGround;
        uniform float uScroll;
        uniform vec3 uBase[5];
        ${NOISE_GLSL}
        ${ZONE_FIELD_GLSL}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec4 zw = zoneAtZ(vGround.z);
        vec2 gp = vec2(vGround.x, vGround.z - uScroll); // ground coordinates that travel with the road
        float broad = wFbm(gp * 0.02);
        vec3 ground = vec3(0.0);
        float rough = 1.0;
        if (zw.r > 0.004) {
          // Desert: wind ripples bending around broad dunes, darker scrub and pebbles.
          float warp = wFbm(gp * 0.05) * 7.0;
          float ripple = sin(gp.x * 1.1 + gp.y * 0.45 + warp) * 0.5 + 0.5;
          vec3 sand = uBase[0] * (0.82 + 0.22 * ripple + 0.35 * (broad - 0.5));
          float scrub = smoothstep(0.58, 0.72, wFbm(gp * 0.12 + 3.0));
          sand = mix(sand, uBase[0] * vec3(0.55, 0.5, 0.42), scrub * 0.7);
          ground += zw.r * sand;
        }
        if (zw.g > 0.004) {
          // Salt flats: polygonal crust plates with raised white ridges along the cracks.
          vec2 cells = wCells(gp * 0.28);
          float ridge = 1.0 - smoothstep(0.0, 0.07, cells.y - cells.x);
          vec3 salt = uBase[1] * (0.86 + 0.12 * wNoise(gp * 0.9) + 0.1 * (broad - 0.5));
          salt = mix(salt, vec3(1.0), ridge * 0.55);
          salt *= 1.0 - 0.12 * smoothstep(0.3, 0.0, cells.x) * (1.0 - ridge); // plates dish slightly
          ground += zw.g * salt;
          rough -= zw.g * 0.2;
        }
        if (zw.b > 0.004) {
          // Meadow: patchy greens, bare earth and flecks of wildflowers.
          float tuft = wFbm(gp * 0.08);
          vec3 grass = uBase[2] * mix(vec3(0.8, 0.85, 0.7), vec3(1.25, 1.2, 1.0), tuft);
          float dirt = smoothstep(0.62, 0.75, wFbm(gp * 0.06 + 9.0));
          grass = mix(grass, vec3(0.16, 0.11, 0.07), dirt * 0.8);
          vec2 fc = floor(gp * 2.2);
          float flower = step(0.985, wHash(fc)) * step(length(fract(gp * 2.2) - 0.5), 0.22);
          vec3 petal = wHash(fc + 7.0) > 0.5 ? vec3(0.95, 0.85, 0.2) : vec3(0.85, 0.35, 0.6);
          grass = mix(grass, petal, flower * (1.0 - dirt));
          ground += zw.b * grass;
        }
        if (zw.a > 0.004) {
          // City: paving slabs and dark tarmac lots, glossy when wet.
          vec2 slab = fract(gp / vec2(2.4, 2.4));
          float joint = 1.0 - step(0.04, slab.x) * step(0.04, slab.y);
          float lot = step(0.5, wNoise(gp * 0.015));
          vec3 city = mix(vec3(0.11, 0.105, 0.12), vec3(0.05, 0.05, 0.06), lot) * (0.85 + 0.3 * wNoise(gp * 0.7));
          city *= 1.0 - joint * 0.45 * (1.0 - lot);
          ground += zw.a * city;
          rough -= zw.a * 0.55;
        }
        float arctic = zoneFiveAtZ(vGround.z);
        if (arctic > 0.004) {
          vec2 facets = wCells(gp * 0.17);
          float seam = 1.0 - smoothstep(0.0, 0.055, facets.y - facets.x);
          float frost = wFbm(gp * 0.11 + vec2(4.0, 8.0));
          vec3 ice = uBase[4] * (0.76 + 0.18 * frost + 0.12 * broad);
          ice = mix(ice, vec3(0.28, 0.68, 0.76), seam * 0.62);
          ground += arctic * ice;
          rough -= arctic * 0.22;
        }
        diffuseColor.rgb *= ground;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor *= rough;`,
      );
  };
  mat.customProgramCacheKey = () => 'zone-ground';
  return mat;
}

export class Environment {
  private readonly scene: THREE.Scene;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly fog: THREE.Fog;
  private readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly groundTex: THREE.Texture;
  private readonly groundMat: THREE.MeshStandardMaterial;
  private readonly groundScroll = { value: 0 };
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly envScene = new THREE.Scene();
  private readonly neonRing: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private carEnvTarget: THREE.WebGLRenderTarget | null = null;
  /** Soft light strips seen only in the car's reflections, like a photo studio's softboxes. */
  private readonly studio = new THREE.Group();
  private readonly studioTop = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, fog: false });
  private readonly studioSide = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, fog: false });
  private readonly envKey = new Float32Array(14);
  private envAge = 99;
  private readonly farRidge: THREE.MeshStandardMaterial;
  private readonly nearRidge: THREE.MeshStandardMaterial;
  private readonly snow = { value: 0 };
  private readonly skyline: THREE.InstancedMesh;
  private readonly skylineGlow = { value: 0 };
  private readonly sunOffset = new THREE.Vector3(...SUN_DIR).normalize().multiplyScalar(90);
  private readonly tmp = new THREE.Color();
  private scroll = 0;
  /** 0–1: how much daylight is shut out (inside a tunnel). */
  shade = 0;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer, field: ZoneField) {
    this.scene = scene;
    this.renderer = renderer;
    scene.background = new THREE.Color();
    this.fog = new THREE.Fog(0xffffff, 70, 380);
    scene.fog = this.fog;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    scene.environmentIntensity = 0.55;

    this.hemi = new THREE.HemisphereLight();
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight();
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.setScalar(IS_TOUCH ? 1024 : 2048);
    Object.assign(this.sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 220 });
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun, this.sun.target);

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          top: { value: new THREE.Color() },
          mid: { value: new THREE.Color() },
          horizon: { value: new THREE.Color() },
          sunColor: { value: new THREE.Color() },
          sunDir: { value: new THREE.Vector3(...SUN_DIR).normalize() },
          clouds: { value: 0 },
          stars: { value: 0 },
          aurora: { value: 0 },
          time: { value: 0 },
        },
      }),
    );
    this.sky.renderOrder = -1;
    scene.add(this.sky);

    // Reflections come from the zone's own sky (re-rendered as the palette changes), plus a band of
    // neon at the horizon in the city for the wet streets and the paint to pick up.
    this.envScene.add(new THREE.Mesh(this.sky.geometry, this.sky.material));
    this.neonRing = new THREE.Mesh(
      new THREE.CylinderGeometry(400, 400, 60, 48, 1, true).translate(0, 18, 0),
      new THREE.MeshBasicMaterial({ map: neonBandTexture(), side: THREE.BackSide, transparent: true, depthWrite: false }),
    );
    this.envScene.add(this.neonRing);
    this.buildStudio();

    this.groundTex = groundTexture(renderer);
    this.groundTex.repeat.set(1200 / GROUND_TILE, 1200 / GROUND_TILE);
    this.groundMat = groundMaterial(this.groundTex, field, this.groundScroll);
    // Finely divided along z so the world bend can curve it.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200, 16, 160), this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.03;
    ground.receiveShadow = true;
    scene.add(ground);

    // Two mountain ranges; they skip fog and get an aerial-perspective tint per zone instead.
    this.farRidge = this.ridgeMaterial(42);
    this.nearRidge = this.ridgeMaterial(22);
    scene.add(new THREE.Mesh(ridgeGeometry(540, 105, 11), this.farRidge), new THREE.Mesh(ridgeGeometry(370, 46, 23), this.nearRidge));

    this.skyline = this.buildSkyline();
    scene.add(this.skyline);
  }

  /** Applies a zone palette: sky, fog, lights, ground, mountains, skyline and exposure. */
  applyPalette(p: Palette) {
    const u = this.sky.material.uniforms;
    u.top.value.copy(p.skyTop);
    u.mid.value.copy(p.skyMid);
    u.horizon.value.copy(p.horizon);
    u.sunColor.value.copy(p.sun);
    u.clouds.value = p.clouds;
    u.stars.value = p.stars;
    u.aurora.value = p.aurora;
    (this.scene.background as THREE.Color).copy(p.horizon);
    this.fog.color.copy(p.horizon);
    this.fog.near = p.fogNear;
    this.fog.far = p.fogFar;
    this.hemi.color.copy(p.hemiSky);
    this.hemi.groundColor.copy(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity * (1 - this.shade * 0.65);
    this.sun.color.copy(p.sunLight);
    this.sun.intensity = p.sunIntensity * (1 - this.shade * 0.9);
    this.neonRing.material.opacity = p.skyline;
    this.refreshReflections(p);
    this.farRidge.color.copy(p.mountains).lerp(this.tmp.copy(p.horizon), 0.55);
    this.nearRidge.color.copy(p.mountains).lerp(this.tmp.copy(p.horizon), 0.22);
    this.snow.value = p.snow;
    const rise = smoothstep(0, 1, p.skyline);
    this.skyline.visible = rise > 0.01;
    this.skyline.position.y = -(1 - rise) * 150; // the city rises out of the horizon as the zone begins
    this.skylineGlow.value = rise;
    this.scene.environmentIntensity = p.envLight * (1 - this.shade * 0.7);
    this.renderer.toneMappingExposure = p.exposure;
  }

  update(dt: number, scrollDelta: number, focusX: number, camera: THREE.Camera) {
    this.scroll += scrollDelta;
    this.envAge += dt;
    this.groundScroll.value = this.scroll % 10000;
    this.groundTex.offset.y = (this.scroll / GROUND_TILE) % 1;
    this.sky.position.copy(camera.position);
    this.sky.material.uniforms.time.value = performance.now() / 1000;
    this.sun.target.position.set(focusX, 0, -12);
    this.sun.position.copy(this.sun.target.position).add(this.sunOffset);
  }

  /**
   * Re-renders the sky into the reflection map when its colours have moved on noticeably, at most a
   * few times a second, so paint and wet roads always reflect the sky they are under.
   */
  private refreshReflections(p: Palette) {
    const key = [p.skyTop, p.skyMid, p.horizon, p.sun].flatMap((c) => [c.r, c.g, c.b]);
    key.push(p.skyline, p.aurora);
    let change = 0;
    for (let i = 0; i < key.length; i++) change += Math.abs(key[i] - this.envKey[i]);
    if (this.envTarget && (change < 0.03 || this.envAge < (IS_TOUCH ? 1 : 0.3))) return;
    this.envKey.set(key);
    this.envAge = 0;
    this.studio.visible = false;
    const next = this.pmrem.fromScene(this.envScene, 0, 1, 2000);
    this.scene.environment = next.texture;
    this.envTarget?.dispose();
    this.envTarget = next;

    // The car's own map: the same sky with the studio strips lit in the zone's light, so its paint
    // carries long clean highlights down the doors and along the roof whatever the sky is doing.
    this.tintStudio(p);
    this.studio.visible = true;
    const car = this.pmrem.fromScene(this.envScene, 0, 1, 2000);
    this.studio.visible = false;
    this.scene.userData.carEnvironment = car.texture;
    this.carEnvTarget?.dispose();
    this.carEnvTarget = car;
  }

  /**
   * One long softbox overhead running nose to tail and a strip low down either side for a crisp line
   * along the flanks. (A panel behind the car only ever showed as a blotch on the hood from the front.)
   */
  private buildStudio() {
    const top = new THREE.Mesh(new THREE.PlaneGeometry(70, 520), this.studioTop);
    top.rotation.x = Math.PI / 2;
    top.position.y = 260;
    this.studio.add(top);
    for (const side of [-1, 1]) {
      // Thin and only a few degrees above the horizon: the doors catch it as a clean line, while the hood,
      // which only sees it at a grazing angle, would smear a taller strip into a blotch.
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(520, 9), this.studioSide);
      strip.rotation.y = Math.PI / 2;
      strip.position.set(side * 240, 30, 0);
      this.studio.add(strip);
    }
    this.studio.visible = false;
    this.envScene.add(this.studio);
  }

  private tintStudio(p: Palette) {
    // Warm-white daylight softboxes that fade toward neon (cyan overhead, magenta at the sides) at night.
    const day = 1 - p.stars;
    const base = this.tmp.setRGB(1, 0.97, 0.92).lerp(p.sun, 0.25);
    this.studioTop.color.copy(base).multiplyScalar(2.4 * day).add(new THREE.Color(0.2, 0.9, 1.4).multiplyScalar(p.skyline));
    this.studioSide.color.copy(base).multiplyScalar(2.4 * day).add(new THREE.Color(1.6, 0.25, 1.1).multiplyScalar(p.skyline));
  }

  /** Mountain material with snow above `snowLine` metres, scaled by the zone's snow amount. */
  private ridgeMaterial(snowLine: number) {
    const mat = new THREE.MeshStandardMaterial({ roughness: 1, fog: false });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uSnow = this.snow;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vRidge;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRidge = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uSnow;\nvarying vec3 vRidge;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float line = ${snowLine.toFixed(1)} + sin(vRidge.x * 0.05) * 7.0 + sin(vRidge.z * 0.11) * 4.0;
          float snow = smoothstep(line, line + 9.0, vRidge.y) * uSnow;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.97), snow);`,
        );
    };
    mat.customProgramCacheKey = () => `ridge-${snowLine}`;
    return mat;
  }

  /** Distant towers whose windows are drawn in the shader from world position, so no texture stretches. */
  private buildSkyline() {
    const rng = mulberry32(31);
    const count = 150;
    const mat = new THREE.MeshStandardMaterial({ color: 0x0b0a13, roughness: 0.85, fog: false });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uGlow = this.skylineGlow;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCity;\nvarying float vFlat;')
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\nvCity = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\nvFlat = abs(normal.y);',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uGlow;
          varying vec3 vCity;
          varying float vFlat;
          float cityHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.743); }`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          vec2 cell = vec2((vCity.x + vCity.z) / 3.4, vCity.y / 3.8);
          vec2 f = fract(cell);
          float pane = step(0.22, f.x) * step(f.x, 0.78) * step(0.28, f.y) * step(f.y, 0.72);
          float h = cityHash(floor(cell));
          vec3 tint = mix(vec3(1.0, 0.78, 0.45), vec3(0.45, 0.85, 1.0), step(0.75, h));
          totalEmissiveRadiance += tint * pane * step(0.58, h) * (1.0 - vFlat) * uGlow * 1.6;`,
        );
    };
    mat.customProgramCacheKey = () => 'skyline';
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), mat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + rng() * 0.03;
      const dist = 240 + rng() * 90;
      const h = 20 + rng() ** 2 * 120;
      q.setFromAxisAngle(up, -angle);
      m.compose(
        new THREE.Vector3(Math.sin(angle) * dist, 0, -Math.cos(angle) * dist),
        q,
        new THREE.Vector3(10 + rng() * 26, h, 10 + rng() * 22),
      );
      mesh.setMatrixAt(i, m);
    }
    mesh.visible = false;
    return mesh;
  }
}
