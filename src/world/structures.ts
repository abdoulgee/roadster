import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ROAD_HALF } from '../config';
import { mulberry32 } from '../util/rng';
import { smoothstep } from '../util/shape';
import { zoneAt, type Palette } from './zones';

const SPACING = 1150; // metres between set pieces
const FIRST = -520;
const ROAD_NEAR = 30;
const TUNNEL_LEN = 150;
const TUNNEL_R = 10.8;
const DECK_Y = 11;

type Kind = 'tunnel' | 'desertBridge' | 'cityBridge' | null;

/** Which set piece each zone gets: open salt flats have none. */
const ZONE_KIND: Kind[] = ['desertBridge', null, 'tunnel', 'cityBridge'];

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, srgb = true) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Cast concrete: soft mottling, formwork panel seams and rain streaks. */
function concreteTexture() {
  const rng = mulberry32(51);
  return canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = '#b8b2a8';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2500; i++) {
      const v = 150 + Math.floor(rng() * 70);
      ctx.fillStyle = `rgba(${v},${v - 4},${v - 10},0.25)`;
      ctx.fillRect(rng() * 256, rng() * 256, 2 + rng() * 6, 2 + rng() * 6);
    }
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = 'rgba(70,64,58,0.08)';
      ctx.fillRect(rng() * 256, rng() * 80, 2 + rng() * 3, 60 + rng() * 180);
    }
    ctx.strokeStyle = 'rgba(60,56,52,0.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 254, 254);
  });
}

/** Tunnel lining: pale tiles up to shoulder height, dark sprayed concrete above, a cable tray. */
function liningTexture() {
  const rng = mulberry32(52);
  return canvasTexture(512, 256, (ctx) => {
    ctx.fillStyle = '#2b2a2c';
    ctx.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 3000; i++) {
      const v = 30 + Math.floor(rng() * 30);
      ctx.fillStyle = `rgba(${v},${v},${v + 2},0.5)`;
      ctx.fillRect(rng() * 512, rng() * 256, 2, 2);
    }
    // u runs around the arch: both walls get tiles near their foot (u near 0 and 1).
    for (const [x0, x1] of [[0, 120], [392, 512]]) {
      for (let x = x0; x < x1; x += 16) {
        for (let y = 0; y < 256; y += 16) {
          const v = 200 + Math.floor(rng() * 30);
          ctx.fillStyle = `rgb(${v},${v - 6},${v - 18})`;
          ctx.fillRect(x + 1, y + 1, 14, 14);
        }
      }
    }
    ctx.fillStyle = '#ffb13f';
    ctx.fillRect(118, 0, 4, 256);
    ctx.fillRect(390, 0, 4, 256);
  });
}

/** Weathered rock for the mountain the tunnel bores through. */
function rockMass(rng: () => number, w: number, h: number, d: number) {
  const geo = new THREE.IcosahedronGeometry(1, 4);
  const p = geo.attributes.position;
  const waves = Array.from({ length: 6 }, () => ({
    d: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(),
    f: 2 + rng() * 6,
    a: 0.04 + rng() * 0.08,
    ph: rng() * 6,
  }));
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    let r = 1;
    for (const wv of waves) r += wv.a * Math.sin(v.dot(wv.d) * wv.f + wv.ph);
    v.multiplyScalar(r);
    p.setXYZ(i, v.x * w, Math.max(v.y, -0.2) * h, v.z * d);
  }
  geo.computeVertexNormals();
  return geo;
}

/** A plane with an arch-shaped hole the size of the tunnel bore. */
function portalGeometry(width: number, height: number) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, height);
  shape.lineTo(-width / 2, height);
  shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(TUNNEL_R, 0);
  hole.absarc(0, 0, TUNNEL_R, 0, Math.PI, false);
  hole.closePath();
  shape.holes.push(hole);
  return new THREE.ExtrudeGeometry(shape, { depth: 1.2, bevelEnabled: false, curveSegments: 24 });
}

interface Mover {
  mesh: THREE.Object3D;
  speed: number;
  span: number;
}

/**
 * The road's big set pieces, one in view at a time: a tunnel bored through a mountain in Pine Ridge
 * (lit by strip lights, and dark inside), a concrete overpass with traffic crossing it in the desert,
 * and an elevated railway bridge in the city with a train rushing over.
 */
export class Structures {
  private readonly pieces: Record<Exclude<Kind, null>, THREE.Group>;
  private readonly movers: Record<Exclude<Kind, null>, Mover[]> = { tunnel: [], desertBridge: [], cityBridge: [] };
  private readonly tunnelLights: THREE.MeshStandardMaterial;
  private readonly cityNeon: THREE.MeshStandardMaterial;
  private readonly windows: THREE.MeshStandardMaterial;
  private active: Kind = null;
  private z = FIRST;
  private time = 0;
  /** 0–1: how far inside the tunnel the camera is, for dimming daylight. */
  shade = 0;

  constructor(scene: THREE.Scene) {
    const rng = mulberry32(61);
    const concrete = new THREE.MeshStandardMaterial({ map: concreteTexture(), color: 0xd8d2c8, roughness: 0.92 });
    concrete.map!.repeat.set(4, 1);

    // --- Tunnel ---
    const tunnel = new THREE.Group();
    const lining = liningTexture();
    lining.repeat.set(1, TUNNEL_LEN / 12);
    // Half a cylinder over the road, its axis along z, open at both ends; seen from inside.
    const shell = new THREE.Mesh(
      new THREE.CylinderGeometry(TUNNEL_R, TUNNEL_R, TUNNEL_LEN, 32, 60, true, Math.PI / 2, Math.PI)
        .rotateX(Math.PI / 2)
        .translate(0, 0, -TUNNEL_LEN / 2),
      new THREE.MeshStandardMaterial({ map: lining, roughness: 0.7, side: THREE.DoubleSide }),
    );
    shell.castShadow = true;
    shell.receiveShadow = true;
    this.tunnelLights = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffe2b0, emissiveIntensity: 3 });
    const fittings: THREE.BufferGeometry[] = [];
    for (let z = -4; z > -TUNNEL_LEN; z -= 7) {
      for (const x of [-3.4, 3.4]) {
        const y = Math.sqrt(TUNNEL_R * TUNNEL_R - x * x) - 0.25;
        fittings.push(new THREE.BoxGeometry(0.35, 0.12, 2.6).translate(x, y, z));
      }
    }
    const lights = new THREE.Mesh(mergeGeometries(fittings), this.tunnelLights);
    // Darken the road under the bore so it reads as a tunnel from outside too, with pools of light
    // under each pair of lamps (the alpha map is lighter there).
    const pools = canvasTexture(64, 64, (ctx) => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 64, 64);
      for (const x of [16, 48]) {
        const g = ctx.createRadialGradient(x, 32, 0, x, 32, 26);
        g.addColorStop(0, '#464646');
        g.addColorStop(1, '#ffffff');
        ctx.fillStyle = g;
        ctx.fillRect(x - 26, 6, 52, 52);
      }
    }, false);
    pools.repeat.set(1, (TUNNEL_LEN - 6) / 7);
    const gloom = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_HALF * 2 + 2, TUNNEL_LEN - 6, 1, 40).rotateX(-Math.PI / 2).translate(0, 0.035, -TUNNEL_LEN / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6, depthWrite: false, alphaMap: pools }),
    );
    const rock = new THREE.MeshStandardMaterial({ color: 0x6e6a62, roughness: 1, flatShading: true });
    const snowcap = new THREE.MeshStandardMaterial({ color: 0xe9edf2, roughness: 0.9, flatShading: true });
    const portalGeo = portalGeometry(34, 15);
    const portalIn = new THREE.Mesh(portalGeo, concrete);
    const portalOut = new THREE.Mesh(portalGeo, concrete);
    portalOut.position.z = -TUNNEL_LEN - 1.2;
    tunnel.add(shell, lights, gloom, portalIn, portalOut);
    // The mountain itself, built from rock masses either side and over the bore.
    // Each mass is an ellipsoid; they are placed so none pokes into the bore (|x| < radius under the arch).
    for (const [x, y, w, h, d] of [
      [-42, 0, 30, 34, 0.55], [42, 0, 30, 30, 0.55], [0, 17.5, 26, 26, 0.5], [-28, 4, 16, 24, 0.5], [28, 4, 16, 22, 0.5],
    ] as const) {
      const mass = new THREE.Mesh(rockMass(rng, w, h, TUNNEL_LEN * d), rock);
      mass.position.set(x, y, -TUNNEL_LEN / 2);
      mass.castShadow = true;
      mass.receiveShadow = true;
      tunnel.add(mass);
      if (h > 25) {
        const cap = new THREE.Mesh(rockMass(rng, w * 0.45, h * 0.25, TUNNEL_LEN * d * 0.4), snowcap);
        cap.position.set(x, y + h * 0.82, -TUNNEL_LEN / 2);
        tunnel.add(cap);
      }
    }

    // --- Bridges ---
    const deckSpan = 130;
    const bridge = (city: boolean) => {
      const g = new THREE.Group();
      const deckMat = city ? new THREE.MeshStandardMaterial({ color: 0x2a2833, roughness: 0.7, metalness: 0.3 }) : concrete;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(deckSpan, 1.5, 13, 20, 1, 1), deckMat);
      deck.position.y = DECK_Y + 0.75;
      deck.castShadow = true;
      deck.receiveShadow = true;
      g.add(deck);
      // Girders under the deck, parapets on top.
      for (const z of [-4.5, 0, 4.5]) {
        const girder = new THREE.Mesh(new THREE.BoxGeometry(deckSpan, 1, 0.6), deckMat);
        girder.position.set(0, DECK_Y - 0.4, z);
        g.add(girder);
      }
      for (const z of [-6.3, 6.3]) {
        const parapet = new THREE.Mesh(new THREE.BoxGeometry(deckSpan, 1.1, 0.35), deckMat);
        parapet.position.set(0, DECK_Y + 2, z);
        g.add(parapet);
      }
      // Piers clear of the carriageway.
      for (const x of [-(ROAD_HALF + 3.5), ROAD_HALF + 3.5, -38, 38]) {
        const pier = new THREE.Mesh(new THREE.BoxGeometry(1.8, DECK_Y, 8), deckMat);
        pier.position.set(x, DECK_Y / 2 - 0.5, 0);
        pier.castShadow = true;
        g.add(pier);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1, 11), deckMat);
        cap.position.set(x, DECK_Y - 0.5, 0);
        g.add(cap);
      }
      // Earth ramps the deck runs onto at each end, sloping down into the ground.
      const rampLen = 70;
      const profile = new THREE.Shape([
        new THREE.Vector2(0, -0.5),
        new THREE.Vector2(rampLen, -0.5),
        new THREE.Vector2(0, DECK_Y + 1.5),
      ]);
      const rampGeo = new THREE.ExtrudeGeometry(profile, { depth: 15, bevelEnabled: false }).translate(0, 0, -7.5);
      const rampMat = city ? deckMat : new THREE.MeshStandardMaterial({ color: 0xa8714f, roughness: 1, flatShading: true });
      for (const side of [-1, 1]) {
        const ramp = new THREE.Mesh(rampGeo, rampMat);
        ramp.position.x = side * (deckSpan / 2 - 1);
        if (side < 0) ramp.rotation.y = Math.PI; // turn rather than mirror, which would flip the faces
        ramp.receiveShadow = true;
        g.add(ramp);
      }
      return g;
    };

    const desert = bridge(false);
    const carColors = [0xd23a3a, 0x3a6ad2, 0xf0f0ea, 0x2a2a2e, 0xe8b33a];
    for (let i = 0; i < 4; i++) {
      const car = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.1, 1.8), new THREE.MeshStandardMaterial({ color: carColors[i], roughness: 0.35, metalness: 0.5 }));
      body.position.y = 0.75;
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 1.6), new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.2, metalness: 0.6 }));
      cabin.position.set(-0.2, 1.6, 0);
      car.add(body, cabin);
      const dir = i % 2 ? 1 : -1;
      car.position.set((i / 4) * deckSpan - deckSpan / 2, DECK_Y + 1.5, dir * 3);
      car.rotation.y = dir > 0 ? Math.PI : 0;
      desert.add(car);
      this.movers.desertBridge.push({ mesh: car, speed: dir * -(18 + i * 3), span: deckSpan + 40 });
    }

    const city = bridge(true);
    this.cityNeon = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x3fe0ff, emissiveIntensity: 3 });
    this.windows = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffe6b8, emissiveIntensity: 2.2 });
    // Neon along both edges of the deck and the parapets, and lamps under the span.
    for (const z of [-6.55, 6.55]) {
      for (const y of [DECK_Y + 0.05, DECK_Y + 2.55]) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(deckSpan, 0.18, 0.12), this.cityNeon);
        strip.position.set(0, y, z);
        city.add(strip);
      }
    }
    const underLamps: THREE.BufferGeometry[] = [];
    for (let x = -ROAD_HALF; x <= ROAD_HALF; x += 4) underLamps.push(new THREE.BoxGeometry(1.2, 0.08, 0.5).translate(x, DECK_Y - 0.92, 0));
    city.add(new THREE.Mesh(mergeGeometries(underLamps), this.windows));
    // Elevated train: three lit carriages on rails along the deck.
    const shellMat = new THREE.MeshStandardMaterial({ color: 0xd9dde3, roughness: 0.35, metalness: 0.6 });
    const train = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const carriage = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(17, 3.2, 3.2), shellMat);
      body.position.y = 1.9;
      const band = new THREE.Mesh(new THREE.BoxGeometry(16.4, 0.9, 3.25), this.windows);
      band.position.y = 2.3;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(17.02, 0.2, 3.22), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff3fa8, emissiveIntensity: 2.5 }));
      stripe.position.y = 1.1;
      carriage.add(body, band, stripe);
      carriage.position.x = k * 17.6;
      train.add(carriage);
    }
    train.position.set(-deckSpan, DECK_Y + 1.5, 0);
    city.add(train);
    this.movers.cityBridge.push({ mesh: train, speed: 34, span: deckSpan * 2.2 });

    this.pieces = { tunnel, desertBridge: desert, cityBridge: city };
    for (const piece of Object.values(this.pieces)) {
      piece.visible = false;
      scene.add(piece);
    }
  }

  reset() {
    this.place(FIRST, 0);
  }

  applyPalette(p: Palette) {
    const night = smoothstep(1, 7, p.lampGlow);
    this.windows.emissiveIntensity = 0.4 + night * 2.2;
    this.cityNeon.emissiveIntensity = 0.5 + night * 3;
  }

  update(dt: number, delta: number, distance: number, cameraZ: number) {
    this.time += dt;
    this.z += delta;
    if (this.z - (this.active === 'tunnel' ? TUNNEL_LEN : 20) > ROAD_NEAR + 10) this.place(this.z - SPACING, distance);
    const piece = this.active && this.pieces[this.active];
    if (piece) {
      piece.position.z = this.z;
      for (const m of this.movers[this.active!]) {
        m.mesh.position.x += m.speed * dt;
        if (m.mesh.position.x > m.span / 2) m.mesh.position.x -= m.span;
        if (m.mesh.position.x < -m.span / 2) m.mesh.position.x += m.span;
      }
    }
    // Inside the bore: 0 at the portals, 1 a few metres in.
    if (this.active === 'tunnel') {
      const into = this.z - cameraZ;
      this.shade = smoothstep(-2, 14, into) * (1 - smoothstep(TUNNEL_LEN - 14, TUNNEL_LEN + 2, into));
    } else {
      this.shade = 0;
    }
  }

  /** Sets up the next piece at `z`, chosen for the zone the player will be in when they get there. */
  private place(z: number, distance: number) {
    this.z = z;
    const kind = ZONE_KIND[zoneAt(Math.max(0, distance - z)).index];
    this.active = kind;
    for (const [k, piece] of Object.entries(this.pieces)) {
      piece.visible = k === kind;
      piece.position.z = z; // straight away: on the menu nothing calls update()
    }
  }
}
