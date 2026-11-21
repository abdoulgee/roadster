import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../util/rng';

/** Landmark props that animate or glow; Road drives them through `PropKit.update`. */
export class PropKit {
  private readonly rotors: THREE.Object3D[] = [];
  private readonly neon: { mat: THREE.MeshStandardMaterial; base: number; phase: number; colors: THREE.Color[] }[] = [];
  private readonly nightLights: { mat: THREE.MeshStandardMaterial; day: number; night: number }[] = [];
  private readonly boardTextures: THREE.Texture[];
  private readonly signTextures: THREE.Texture[];
  private readonly wood = new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.9 });
  private readonly steel = new THREE.MeshStandardMaterial({ color: 0x8b9098, metalness: 0.7, roughness: 0.45 });
  private readonly rust = new THREE.MeshStandardMaterial({ color: 0x8a5a3c, metalness: 0.4, roughness: 0.75 });
  private readonly dark = new THREE.MeshStandardMaterial({ color: 0x1e1d24, metalness: 0.4, roughness: 0.6 });

  constructor() {
    this.boardTextures = BOARDS.map(boardTexture);
    this.signTextures = SIGN_WORDS.map(neonWordTexture);
  }

  /** Roadside billboard on twin posts, with lamps that come on at dusk. */
  billboard(variant: number) {
    const g = new THREE.Group();
    for (const x of [-3.5, 3.5]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 7, 0.35).translate(0, 3.5, 0), this.wood);
      post.position.x = x;
      post.castShadow = true;
      g.add(post);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(11.6, 5.2, 0.25), this.wood);
    back.position.set(0, 8.2, -0.1);
    back.castShadow = true;
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(11.2, 4.8),
      this.night(new THREE.MeshStandardMaterial({ map: this.boardTextures[variant % this.boardTextures.length], roughness: 0.8, emissive: 0xffffff, emissiveMap: this.boardTextures[variant % this.boardTextures.length] }), 0, 0.55),
    );
    face.position.set(0, 8.2, 0.04);
    const catwalk = new THREE.Mesh(new THREE.BoxGeometry(11.6, 0.1, 0.8), this.steel);
    catwalk.position.set(0, 5.5, 0.4);
    const lampMat = this.night(new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xfff0d0 }), 0, 4);
    for (const x of [-4, 0, 4]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 1.2), this.steel);
      arm.position.set(x, 10.9, 0.55);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.3), lampMat);
      lamp.position.set(x, 10.85, 1.1);
      g.add(arm, lamp);
    }
    g.add(back, face, catwalk);
    return g;
  }

  /** American farm windmill: lattice tower, a wheel of blades that spins, and a tail vane. */
  windmill() {
    const g = new THREE.Group();
    const h = 11;
    const legs: THREE.BufferGeometry[] = [];
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const at = (k: number, y: number) => {
      const w = 1.6 + (0.35 - 1.6) * (y / h);
      return new THREE.Vector3(corners[k][0] * w, y, corners[k][1] * w);
    };
    for (let k = 0; k < 4; k++) legs.push(rod(at(k, 0), at(k, h), 0.07));
    for (let ring = 1; ring < 6; ring++) {
      const y = (ring / 6) * h;
      for (let k = 0; k < 4; k++) legs.push(rod(at(k, y), at((k + 1) % 4, y), 0.03));
    }
    const tower = new THREE.Mesh(mergeGeometries(legs), this.rust);
    tower.castShadow = true;
    const head = new THREE.Group();
    head.position.y = h + 0.3;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.6, 8).rotateX(Math.PI / 2), this.steel);
    const rotor = new THREE.Group();
    rotor.position.z = 0.45;
    const blades: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 18; i++) {
      const blade = new THREE.BoxGeometry(0.32, 1.9, 0.02).translate(0, 1.4, 0).rotateY(0.35).rotateZ((i / 18) * Math.PI * 2);
      blades.push(blade);
    }
    blades.push(new THREE.TorusGeometry(2.25, 0.035, 4, 36), new THREE.TorusGeometry(1.0, 0.03, 4, 24));
    const wheel = new THREE.Mesh(mergeGeometries(blades.map((x) => x.toNonIndexed())), this.steel);
    wheel.castShadow = true;
    rotor.add(wheel);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.2, 2.2).translate(0, 0.2, -2.6), this.steel);
    const boom = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 2.6).translate(0, 0, -1.3), this.steel);
    head.add(hub, rotor, tail, boom);
    // Face the wheel towards the road at an angle so the spin reads from the car.
    head.rotation.y = 0.9;
    g.add(tower, head);
    this.rotors.push(rotor);
    return g;
  }

  /** Water tower: a riveted tank on four legs. */
  waterTower() {
    const g = new THREE.Group();
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 4.2, 20).translate(0, 14, 0), this.steel);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.2, 1.6, 20).translate(0, 16.9, 0), this.steel);
    tank.castShadow = true;
    g.add(tank, roof);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 12, 6).translate(0, 6, 0), this.rust);
      leg.position.set(sx * 2.1, 0, sz * 2.1);
      leg.castShadow = true;
      g.add(leg);
    }
    const band = new THREE.Mesh(new THREE.CylinderGeometry(3.05, 3.05, 0.5, 20).translate(0, 13.2, 0), this.dark);
    g.add(band);
    return g;
  }

  /** Log cabin with a stone chimney and a warm lit window at night. */
  cabin() {
    const g = new THREE.Group();
    const logs = new THREE.MeshStandardMaterial({ map: logTexture(), roughness: 0.9 });
    const walls = new THREE.Mesh(new THREE.BoxGeometry(7, 3.2, 5).translate(0, 1.6, 0), logs);
    walls.castShadow = true;
    walls.receiveShadow = true;
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x3a2e2a, roughness: 0.85 });
    for (const side of [-1, 1]) {
      const slope = new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.2, 3.4), roofMat);
      slope.position.set(0, 4.1, side * 1.3);
      slope.rotation.x = side * 0.62;
      slope.castShadow = true;
      g.add(slope);
    }
    const gable = new THREE.Shape([new THREE.Vector2(-2.5, 0), new THREE.Vector2(2.5, 0), new THREE.Vector2(0, 1.9)]);
    for (const x of [-3.5, 3.5]) {
      const end = new THREE.Mesh(new THREE.ShapeGeometry(gable).rotateY(Math.PI / 2), logs);
      end.position.set(x, 3.2, 0);
      end.material.side = THREE.DoubleSide;
      g.add(end);
    }
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.9, 3.6, 0.9).translate(2.4, 3.6, -1), new THREE.MeshStandardMaterial({ color: 0x7a7570, roughness: 1 }));
    chimney.castShadow = true;
    const glow = this.night(new THREE.MeshStandardMaterial({ color: 0x2a1a10, emissive: 0xffb060 }), 0.15, 2.5);
    for (const x of [-1.8, 1.4]) {
      const window = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.9), glow);
      window.position.set(x, 1.8, 2.51);
      g.add(window);
    }
    const door = new THREE.Mesh(new THREE.PlaneGeometry(1, 2), new THREE.MeshStandardMaterial({ color: 0x3b2618, roughness: 0.9 }));
    door.position.set(-0.2, 1, 2.51);
    const porch = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.25, 1.6).translate(0, 0.12, 3.2), this.wood);
    g.add(walls, chimney, door, porch);
    return g;
  }

  /** Tall city sign: a blade with a neon word that buzzes and cycles colour. */
  neonSign(variant: number) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.32, 14, 8).translate(0, 7, 0), this.dark);
    pole.castShadow = true;
    const tex = this.signTextures[variant % this.signTextures.length];
    const mat = new THREE.MeshStandardMaterial({ color: 0x0a0a10, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 3 });
    // Faces 4 and 5 (±z) carry the word, so it reads to traffic coming up the road.
    const blade = new THREE.Mesh(new THREE.BoxGeometry(2.6, 9, 0.6), [this.dark, this.dark, this.dark, this.dark, mat, mat]);
    blade.position.set(0, 13, 0);
    const rng = mulberry32(variant * 13 + 5);
    const palette = [0xff3fa8, 0x3fe0ff, 0xb07bff, 0xffb13f, 0x7dff8a].map((c) => new THREE.Color(c));
    const start = Math.floor(rng() * palette.length);
    this.neon.push({ mat, base: 3, phase: rng() * 10, colors: [palette[start], palette[(start + 2) % palette.length]] });
    mat.emissive.copy(palette[start]);
    g.add(pole, blade);
    return g;
  }

  update(time: number, night: number) {
    for (const r of this.rotors) r.rotation.z = time * 2.4;
    for (const n of this.neon) {
      // Mostly steady, with the odd stutter, and a slow fade between two colours.
      const t = time + n.phase;
      const stutter = Math.sin(t * 37) > 0.97 || (Math.sin(t * 0.7) > 0.96 && Math.sin(t * 60) > 0) ? 0.25 : 1;
      n.mat.emissive.copy(n.colors[0]).lerp(n.colors[1], Math.sin(t * 0.4) * 0.5 + 0.5);
      n.mat.emissiveIntensity = n.base * stutter * (0.4 + night * 0.6);
    }
    for (const l of this.nightLights) l.mat.emissiveIntensity = l.day + (l.night - l.day) * night;
  }

  private night(mat: THREE.MeshStandardMaterial, day: number, night: number) {
    this.nightLights.push({ mat, day, night });
    mat.emissiveIntensity = day;
    return mat;
  }
}

/** A round bar from `a` to `b` (non-indexed so it merges with anything). */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number) {
  const dir = b.clone().sub(a);
  const geo = new THREE.CylinderGeometry(r, r, dir.length(), 5);
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return geo.toNonIndexed();
}

// Fictional roadside advertising.
const BOARDS: readonly [string, string, string, string][] = [
  ['MIRAGE BAY', 'MOTEL · POOL · NEON', '#e8573a', '#ffe8c2'],
  ['ROCKET COLA', 'ICE COLD · 2 MILES', '#2a3f8f', '#ffd23f'],
  ["DOT'S DINER", 'PIE · COFFEE · 24H', '#f2f0e6', '#c42a2a'],
  ['SALT LAKE', 'SPEED WEEK · AUGUST', '#1b8a8a', '#ffffff'],
];

function boardTexture([title, line, bg, fg]: readonly [string, string, string, string]) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 220;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 220);
  // Sunburst behind the title, a faded paper look and a frame.
  ctx.save();
  ctx.translate(420, 200);
  for (let i = 0; i < 12; i++) {
    ctx.rotate(Math.PI / 12);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, -8, 500, 16);
  }
  ctx.restore();
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.font = '700 70px "Barlow Condensed", system-ui, sans-serif';
  ctx.fillText(title, 256, 112);
  ctx.font = '600 30px "Barlow Condensed", system-ui, sans-serif';
  ctx.fillText(line, 256, 168);
  ctx.strokeStyle = fg;
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, 496, 204);
  const rng = mulberry32(title.length);
  for (let i = 0; i < 1600; i++) {
    ctx.fillStyle = `rgba(0,0,0,${rng() * 0.12})`;
    ctx.fillRect(rng() * 512, rng() * 220, 2, 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const SIGN_WORDS = ['HOTEL', 'ARCADE', 'NOODLE', 'CLUB', 'MOTEL'];

/** A word written as glowing tubes on black, stacked vertically for a blade sign. */
function neonWordTexture(word: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 128, 512);
  ctx.textAlign = 'center';
  ctx.font = '700 76px "Barlow Condensed", system-ui, sans-serif';
  const step = 470 / word.length;
  ctx.shadowColor = '#fff';
  ctx.shadowBlur = 12;
  ctx.fillStyle = '#fff';
  [...word].forEach((ch, i) => ctx.fillText(ch, 64, 70 + i * step));
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 5;
  ctx.strokeRect(8, 8, 112, 496);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Stacked logs: rounded horizontal bands with dark chinking between them. */
function logTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  for (let y = 0; y < 128; y += 16) {
    const g = ctx.createLinearGradient(0, y, 0, y + 16);
    g.addColorStop(0, '#4a3020');
    g.addColorStop(0.3, '#8a6040');
    g.addColorStop(0.7, '#6e4a30');
    g.addColorStop(1, '#2a1a10');
    ctx.fillStyle = g;
    ctx.fillRect(0, y, 128, 16);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1.2);
  return tex;
}
