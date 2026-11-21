import * as THREE from 'three';
import { clamp } from '../util/math';

export type PropKind = 'palm' | 'rock' | 'pine' | 'tower';

interface PaletteDef {
  skyTop: number;
  skyMid: number;
  horizon: number;
  sun: number;
  sunLight: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  fogNear: number;
  fogFar: number;
  ground: number;
  /** Gravel strip between the road and the open ground. */
  verge: number;
  mountains: number;
  exposure: number;
  /** Strength of the image-based ambient light and reflections. */
  envLight: number;
  lampGlow: number;
  /** 0–1 cloud cover, star visibility, city skyline rise and snow on the peaks. */
  clouds: number;
  stars: number;
  /** Strength of the animated aurora curtains in the sky. */
  aurora: number;
  skyline: number;
  snow: number;
  /** Post: bloom strength, sun shafts, heat shimmer near the horizon and colour saturation. */
  bloom: number;
  rays: number;
  heat: number;
  saturation: number;
  /** How wet the road is (0 dry – 1 rain-soaked), and how hard it rains. */
  wet: number;
  rain: number;
  /** Dust and pollen drifting in the air. */
  motes: number;
  /** How hard the road ahead bends left/right and rises/falls (multiplies the world bend). */
  curve: number;
  hills: number;
}

interface ZoneDef {
  name: string;
  length: number;
  props: PropKind;
  palette: PaletteDef;
}

export const ZONES: readonly ZoneDef[] = [
  {
    name: 'SUNSET HIGHWAY',
    length: 2500,
    props: 'palm',
    palette: {
      skyTop: 0x1d2b5e, skyMid: 0xd0607e, horizon: 0xf5ab7a, sun: 0xfff0c0,
      sunLight: 0xffcf9a, sunIntensity: 2.5, hemiSky: 0xffc6a6, hemiGround: 0x5a3c34, hemiIntensity: 0.9,
      fogNear: 80, fogFar: 420, ground: 0xc08e6a, verge: 0x8a6650, mountains: 0x8c5770, exposure: 1.05,
      envLight: 0.55, lampGlow: 2.5, clouds: 0.55, stars: 0, aurora: 0, skyline: 0, snow: 0,
      bloom: 0.35, rays: 0.8, heat: 0.25, saturation: 1.12, wet: 0, rain: 0, motes: 0.8, curve: 1, hills: 0.6,
    },
  },
  {
    name: 'SALT FLATS',
    length: 2500,
    props: 'rock',
    palette: {
      skyTop: 0x2a66b0, skyMid: 0x8cc0ea, horizon: 0xe8f0f4, sun: 0xffffff,
      sunLight: 0xfff4e2, sunIntensity: 2.9, hemiSky: 0xd8ecff, hemiGround: 0x9a958a, hemiIntensity: 1.0,
      fogNear: 100, fogFar: 460, ground: 0xeeeae2, verge: 0xb9b3a8, mountains: 0x8f9cb3, exposure: 0.92,
      envLight: 0.6, lampGlow: 0.6, clouds: 0.35, stars: 0, aurora: 0, skyline: 0, snow: 0.45,
      bloom: 0.2, rays: 0.25, heat: 1, saturation: 1.0, wet: 0, rain: 0, motes: 0.2, curve: 0.25, hills: 0.1,
    },
  },
  {
    name: 'PINE RIDGE',
    length: 2500,
    props: 'pine',
    palette: {
      skyTop: 0x22406f, skyMid: 0x7fa9d8, horizon: 0xf3d6ae, sun: 0xffe6b0,
      sunLight: 0xffdcae, sunIntensity: 2.6, hemiSky: 0xc4dcff, hemiGround: 0x3b4630, hemiIntensity: 0.95,
      fogNear: 80, fogFar: 400, ground: 0x56693f, verge: 0x5d5547, mountains: 0x566a88, exposure: 1.0,
      envLight: 0.55, lampGlow: 1.0, clouds: 0.6, stars: 0, aurora: 0, skyline: 0, snow: 1,
      bloom: 0.25, rays: 0.7, heat: 0, saturation: 1.1, wet: 0.15, rain: 0, motes: 0.6, curve: 1.3, hills: 1.2,
    },
  },
  {
    name: 'NEON CITY',
    length: 3000,
    props: 'tower',
    palette: {
      skyTop: 0x03030f, skyMid: 0x170c3a, horizon: 0x5e2470, sun: 0xff7ad9,
      sunLight: 0x9c8cff, sunIntensity: 0.8, hemiSky: 0x7a6ad8, hemiGround: 0x201028, hemiIntensity: 0.8,
      fogNear: 40, fogFar: 320, ground: 0x221e2a, verge: 0x2a2533, mountains: 0x150c28, exposure: 1.15,
      envLight: 0.2, lampGlow: 7, clouds: 0.25, stars: 1, aurora: 0, skyline: 1, snow: 0,
      bloom: 0.8, rays: 0, heat: 0, saturation: 1.15, wet: 1, rain: 1, motes: 0, curve: 0.7, hills: 0.3,
    },
  },
  {
    name: 'AURORA COAST',
    length: 3000,
    props: 'rock',
    palette: {
      skyTop: 0x07172f, skyMid: 0x123a59, horizon: 0x79b8c7, sun: 0xc7fff0,
      sunLight: 0x9ce4db, sunIntensity: 0.55, hemiSky: 0x78c8c8, hemiGround: 0x182a3a, hemiIntensity: 0.72,
      fogNear: 55, fogFar: 350, ground: 0x263b4b, verge: 0x405562, mountains: 0x314e68, exposure: 1.0,
      envLight: 0.42, lampGlow: 2.2, clouds: 0.12, stars: 0.8, aurora: 1, skyline: 0, snow: 0.92,
      bloom: 0.58, rays: 0.18, heat: 0, saturation: 1.05, wet: 0.35, rain: 0, motes: 0.35, curve: 0.85, hills: 1.25,
    },
  },
];

const CYCLE = ZONES.reduce((sum, z) => sum + z.length, 0);
const BLEND = 400; // metres over which one zone fades into the next

/** Which zone a given distance falls in, and how far into it. */
export function zoneAt(distance: number) {
  let d = ((distance % CYCLE) + CYCLE) % CYCLE;
  for (let i = 0; i < ZONES.length; i++) {
    if (d < ZONES[i].length) return { index: i, zone: ZONES[i], into: d };
    d -= ZONES[i].length;
  }
  return { index: 0, zone: ZONES[0], into: 0 };
}

export class Palette {
  readonly skyTop = new THREE.Color();
  readonly skyMid = new THREE.Color();
  readonly horizon = new THREE.Color();
  readonly sun = new THREE.Color();
  readonly sunLight = new THREE.Color();
  readonly hemiSky = new THREE.Color();
  readonly hemiGround = new THREE.Color();
  readonly ground = new THREE.Color();
  readonly verge = new THREE.Color();
  readonly mountains = new THREE.Color();
  sunIntensity = 0;
  hemiIntensity = 0;
  fogNear = 0;
  fogFar = 0;
  exposure = 1;
  envLight = 0.55;
  lampGlow = 0;
  clouds = 0;
  stars = 0;
  aurora = 0;
  skyline = 0;
  snow = 0;
  bloom = 0;
  rays = 0;
  heat = 0;
  saturation = 1;
  wet = 0;
  rain = 0;
  motes = 0;
  curve = 0;
  hills = 0;
}

const COLOR_KEYS = ['skyTop', 'skyMid', 'horizon', 'sun', 'sunLight', 'hemiSky', 'hemiGround', 'ground', 'verge', 'mountains'] as const;
const NUMBER_KEYS = [
  'sunIntensity', 'hemiIntensity', 'fogNear', 'fogFar', 'exposure', 'envLight', 'lampGlow', 'clouds', 'stars', 'aurora', 'skyline', 'snow',
  'bloom', 'rays', 'heat', 'saturation', 'wet', 'rain', 'motes', 'curve', 'hills',
] as const;
const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

/**
 * How much of each zone shows at `distance` (weights sum to 1), with the same cross-fade as the
 * palette. Scenery uses this to grow and shrink zone-specific detail in and out.
 */
export function zoneWeights(distance: number, out: number[]) {
  const { index, zone, into } = zoneAt(distance);
  const t = THREE.MathUtils.smoothstep(clamp((into - (zone.length - BLEND)) / BLEND, 0, 1), 0, 1);
  out.fill(0);
  out[index] = 1 - t;
  out[(index + 1) % ZONES.length] += t;
  return out;
}

/** Fills `out` with the palette at `distance`, cross-fading during the last BLEND metres of a zone. */
export function paletteAt(distance: number, out: Palette) {
  const { index, zone, into } = zoneAt(distance);
  const a = zone.palette;
  const b = ZONES[(index + 1) % ZONES.length].palette;
  const t = THREE.MathUtils.smoothstep(clamp((into - (zone.length - BLEND)) / BLEND, 0, 1), 0, 1);
  for (const k of COLOR_KEYS) out[k].copy(tmpA.setHex(a[k])).lerp(tmpB.setHex(b[k]), t);
  for (const k of NUMBER_KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}
