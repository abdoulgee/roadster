import * as THREE from 'three';
import type { PowerKind } from '../config';
import type { Player, ThrustKind } from '../entities/player';
import { clamp } from '../util/math';
import { ParticleSystem, puffTexture } from './particles';

const DUST = 0xd8c6ae;
const JET_GLOW = 0xdff4ff;
const EMBER = 0xff8a3d;
const SPARK = 0xffc66b;
const FIREBALL = 0xffa048;
/** Light, warm grey: crash smoke is dust and vented gas lit by the fire, not soot. */
const WRECK_SMOKE = 0xbdb4ab;

const SPEED_LINE_COUNT = 70;

/** A cotton puff: opaque white, slowly growing, hanging in the air while the road carries it away. */
interface Puff {
  size: number;
  sizeEnd: number;
  life: number;
  speed?: number;
  spread?: number;
  alpha?: number;
  drag?: number;
  /** Drawn by the vortex system, whose puffs may fill the lens as the camera flies through them. */
  engulf?: boolean;
}

const POWER_TRAIL: Record<PowerKind, number[]> = {
  starman: [0xffe066, 0xff7ad9, 0x7fe6ff, 0xa6ff7a],
  rocket: [0xff8a3d, 0xffc66b],
  ludicrous: [0xff3fa8, 0xb07bff],
};

/** Streaks rushing past the camera at high speed or while boosting. */
class SpeedLines {
  readonly mesh: THREE.LineSegments;
  private readonly pos: Float32Array;
  private readonly z = new Float32Array(SPEED_LINE_COUNT);
  private readonly material: THREE.LineBasicMaterial;

  constructor() {
    this.pos = new Float32Array(SPEED_LINE_COUNT * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.mesh = new THREE.LineSegments(geo, this.material);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < SPEED_LINE_COUNT; i++) this.respawn(i, -10 - Math.random() * 90);
  }

  update(dt: number, speed: number, intensity: number) {
    this.material.opacity = intensity * 0.35;
    this.mesh.visible = intensity > 0.01;
    if (!this.mesh.visible) return;
    const len = 2 + speed * 0.12;
    for (let i = 0; i < SPEED_LINE_COUNT; i++) {
      this.z[i] += speed * 1.6 * dt;
      if (this.z[i] > 10) this.respawn(i, -70 - Math.random() * 40);
      const o = i * 6;
      this.pos[o + 2] = this.z[i];
      this.pos[o + 5] = this.z[i] - len;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }

  private respawn(i: number, z: number) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = side * (2.5 + Math.random() * 9);
    const y = 0.4 + Math.random() * 6;
    const o = i * 6;
    this.pos[o] = this.pos[o + 3] = x;
    this.pos[o + 1] = this.pos[o + 4] = y;
    this.z[i] = z;
  }
}

/** Emits particles from the player's state each frame, plus one-off bursts for game events. */
export class Effects {
  /** Colour of the thruster gas puffs: white by day, matching the smoke columns' tint at night. */
  private readonly puff = new THREE.Color(0xffffff);
  private readonly smoke: ParticleSystem;
  /** Gas wound into a corkscrew by a barrel roll; big and allowed right up to the lens. */
  private readonly vortex: ParticleSystem;
  private readonly glow = new ParticleSystem(700, THREE.AdditiveBlending);
  private readonly lines = new SpeedLines();
  private dustAcc = 0;
  /** Current road speed; gas leaves the car moving with it and drag lets it fall behind. */
  private speed = 0;
  private jetAcc = 0;
  private groundAcc = 0;
  private plumeAcc = 0;
  private readonly nozzle = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();
  private emberAcc = 0;
  private trailAcc = 0;
  private wreckT = 0;
  private readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private ringT = 1;

  constructor(scene: THREE.Scene) {
    const puff = puffTexture();
    this.smoke = new ParticleSystem(4000, THREE.NormalBlending, { puff });
    this.vortex = new ParticleSystem(1600, THREE.NormalBlending, { puff, nearFade: [0.3, 2.2], maxScreen: 1.2 });
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xc9a6ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    this.ring.visible = false;
    scene.add(this.smoke.points, this.vortex.points, this.glow.points, this.lines.mesh, this.ring);
  }

  /** Tints the gas puffs the same as the smoke columns on the car, so the two always match. */
  setSmokeTint(tint: THREE.Color) {
    this.puff.copy(tint);
  }

  reset() {
    this.smoke.clear();
    this.vortex.clear();
    this.glow.clear();
    this.wreckT = 0;
    this.ringT = 1;
    this.ring.visible = false;
  }

  update(
    dt: number,
    player: Player,
    speed: number,
    power: PowerKind | null,
    camera: THREE.PerspectiveCamera,
    viewportHeight: number,
  ) {
    const scroll = speed * dt;
    this.speed = speed;
    const { x, y } = player;

    if (power && !player.crashed) {
      const colors = POWER_TRAIL[power];
      this.trailAcc += dt * 90;
      while (this.trailAcc >= 1) {
        this.trailAcc--;
        this.glow.emit({
          x: x + (Math.random() - 0.5) * 1.8, y: y + 0.3 + Math.random() * 0.9, z: 1.8 + Math.random() * 1.5,
          vz: 4, spread: 1.2,
          size: 0.35, sizeEnd: 0.05, life: 0.4, color: colors[Math.floor(Math.random() * colors.length)], alpha: 1,
        });
      }
    }

    if (this.ringT < 1) {
      this.ringT = Math.min(1, this.ringT + dt / 0.7);
      const r = 2 + this.ringT * 70;
      this.ring.scale.set(r, 1, r);
      this.ring.material.opacity = (1 - this.ringT) * 0.9;
      this.ring.visible = this.ringT < 1;
    }

    if (!player.crashed) {
      // Tyre dust: always a little, more when boosting or swerving.
      if (player.grounded && speed > 1) {
        this.dustAcc += dt * (6 + speed * 0.35 + (player.boosting ? 40 : 0) + (player.shifting ? 30 : 0));
        while (this.dustAcc >= 1) {
          this.dustAcc--;
          const side = Math.random() < 0.5 ? -1 : 1;
          this.smoke.emit({
            x: x + side * 0.85, y: y + 0.15, z: 1.5,
            vx: side * 0.8, vy: 0.6, vz: 1, spread: 0.6,
            size: 0.5, sizeEnd: 2.4, life: 0.8, color: DUST, alpha: 0.28, drag: 1.5,
          });
        }
      }

      // Underside jets: the columns themselves are drawn on the car. Here the gas they leave behind: a
      // trail shed from their lower ends, and clouds billowing up where they hit the road.
      const power = player.jetPower;
      if (power > 0 && !player.grounded) {
        const rolling = player.rolling;
        this.jetAcc += dt * (rolling ? 420 : 60) * power;
        while (this.jetAcc >= 1) {
          this.jetAcc--;
          const i = Math.floor(Math.random() * 4);
          const len = player.jetLength[i];
          if (len < 0.3) continue;
          const [nx, ny, nz] = player.thrusters.under[i];
          const [dx, dy, dz] = player.thrusters.underDir(i);
          if (rolling) {
            // Flung out along the column as the car turns over, so the gas winds into a corkscrew that
            // hangs over the road and swallows the camera as it drives through.
            const along = len * (0.25 + Math.random() * 0.75);
            this.puffAt(player, nx + dx * along, ny + dy * along, nz + dz * along, dx, dy, dz, {
              size: 1.6, sizeEnd: 6 + Math.random() * 2.5, life: 1.3, speed: 7, spread: 2.2, alpha: 0.5, drag: 1.3, engulf: true,
            });
          } else {
            const along = len * (0.55 + Math.random() * 0.4);
            this.puffAt(player, nx + dx * along, ny + dy * along, nz + dz * along, dx, dy, dz, {
              size: 0.9, sizeEnd: 2.4, life: 0.9, speed: 4, spread: 0.8, alpha: 0.42,
            });
          }
        }
        const hits = player.jetHits.reduce((n, hit) => n + (hit ? 1 : 0), 0);
        this.groundAcc += dt * 24 * hits;
        while (this.groundAcc >= 1) {
          this.groundAcc--;
          let i = Math.floor(Math.random() * 4);
          while (!player.jetHits[i]) i = (i + 1) % 4;
          const [nx, ny, nz] = player.thrusters.under[i];
          const [dx, dy, dz] = player.thrusters.underDir(i);
          const len = player.jetLength[i];
          this.jetSplash(player.carToWorld(this.nozzle.set(nx + dx * len, ny + dy * len, nz + dz * len)));
        }
      }

      if (player.boosting) {
        // Cold-gas plume streaming back from the rear thrusters.
        this.plumeAcc += dt * 34;
        while (this.plumeAcc >= 1) {
          this.plumeAcc--;
          const [nx, ny, nz] = player.thrusters.rear[Math.floor(Math.random() * 2)];
          this.puffAt(player, nx, ny, nz + 0.3, 0, 0.1, 1, {
            size: 0.32, sizeEnd: 1.35, life: 0.72, speed: 8, spread: 0.48, alpha: 0.68, drag: 2.1,
          });
        }
        this.emberAcc += dt * 70;
        while (this.emberAcc >= 1) {
          this.emberAcc--;
          this.glow.emit({
            x: x + (Math.random() - 0.5) * 0.9, y: y + 0.42, z: 2.4,
            vz: 6, spread: 1.5,
            size: 0.22, sizeEnd: 0.04, life: 0.22, color: EMBER, alpha: 1, drag: 2,
          });
        }
      }
    } else {
      // The wreck keeps smoking.
      this.wreckT += dt;
      if (this.wreckT < 3 && Math.random() < dt * 25) {
        this.smoke.emit({
          x, y: y + 0.6, z: 0, vy: 2.2, vz: -this.speed * 0.9, spread: 0.6,
          size: 1, sizeEnd: 4.5, life: 1.8, color: WRECK_SMOKE, alpha: 0.5, drag: 0.8, spin: 0.4,
        });
      }
    }

    const intensity = player.crashed ? 0 : player.boosting || power ? 1 : clamp((speed - 42) / 40, 0, 0.7);
    this.lines.update(dt, speed, intensity);
    this.smoke.update(dt, scroll, camera, viewportHeight);
    this.vortex.update(dt, scroll, camera, viewportHeight);
    this.glow.update(dt, scroll, camera, viewportHeight);
  }

  /** One-off thruster bursts: jump and flip blast down, slam blasts up, steering fires the matching wing. */
  thrust(player: Player, kind: ThrustKind, dir: number) {
    if (player.crashed) return;
    switch (kind) {
      case 'jump':
        for (const [nx, ny, nz] of player.thrusters.under) {
          for (let k = 0; k < 3; k++) {
            this.puffAt(player, nx, ny - 0.4 - k * 0.45, nz, 0, -1, 0, { size: 0.55, sizeEnd: 1.5, life: 1.1, speed: 4, spread: 1 });
          }
        }
        for (let k = 0; k < 16; k++) this.groundCloud(player.x, player.y, 1.2); // from the road or a roof
        break;
      case 'flip':
        for (const [nx, ny, nz] of player.thrusters.under) {
          for (let k = 0; k < 3; k++) {
            this.puffAt(player, nx, ny - 0.5 - k * 0.5, nz, 0, -1, 0, { size: 0.5, sizeEnd: 1.4, life: 1.0, speed: 5, spread: 1 });
          }
        }
        break;
      case 'slam':
        for (const [nx, ny, nz] of player.thrusters.deck) {
          for (let k = 0; k < 4; k++) {
            this.puffAt(player, nx, ny + 0.3 + k * 0.4, nz, 0, 1, 0, { size: 0.5, sizeEnd: 1.4, life: 0.9, speed: 6, spread: 1 });
          }
        }
        break;
      case 'steer': {
        // Puffs strung along the jet of the wing opposite the move, blowing outward away from it.
        const side = -dir;
        const [nx, ny, nz] = player.thrusters.side(side);
        const count = player.grounded ? 5 : 9;
        for (let k = 0; k < count; k++) {
          const along = 0.3 + (k / count) * 1.6;
          this.puffAt(player, nx + side * along, ny + along * 0.12, nz + along * 0.25, side, 0.12, 0.25, {
            size: 0.35 + along * 0.15, sizeEnd: 1.2, life: 0.9, speed: 4 + along * 2, spread: 0.8,
          });
        }
        break;
      }
      case 'sputter':
        this.puffRing(player.x, player.y, 14, 3.5);
        break;
    }
  }

  landing(x: number, y: number, impact: number) {
    const count = Math.round(clamp(impact, 4, 30));
    this.smoke.emit({
      x, y: y + 0.1, z: 0, spread: 3, vy: 1, posJitter: 1.2,
      size: 0.8, sizeEnd: 3.2, life: 0.9, color: DUST, alpha: 0.35, drag: 2.5, count,
    });
    // Hard landings squash a cloud of gas out from under the car.
    const clouds = Math.round(clamp((impact - 6) * 0.8, 0, 16));
    for (let k = 0; k < clouds; k++) this.groundCloud(x, y, 1.1);
    this.puffRing(x, y, Math.round(clamp(impact * 0.7, 6, 16)), 2.5 + impact * 0.12);
  }

  nearMiss(x: number, otherX: number) {
    const side = Math.sign(otherX - x) || 1;
    this.glow.emit({
      x: x + side * 1.1, y: 0.8, z: 0, vx: side * 2, spread: 2.5, posJitter: 0.8,
      size: 0.22, sizeEnd: 0.04, life: 0.35, color: 0xffffff, alpha: 0.9, count: 14,
    });
  }

  pickup(x: number, y: number, color: THREE.ColorRepresentation, count = 10) {
    this.glow.emit({
      x, y, z: -1, spread: 3, posJitter: 0.3,
      size: 0.3, sizeEnd: 0.05, life: 0.45, color, alpha: 1, drag: 2, count,
    });
  }

  smash(x: number, y: number, z: number) {
    this.glow.emit({
      x, y: y + 1, z, spread: 8, vy: 5, size: 0.3, sizeEnd: 0.05,
      life: 0.6, color: SPARK, alpha: 1, gravity: 12, drag: 0.8, count: 30,
    });
    this.smoke.emit({
      x, y: y + 0.8, z, spread: 2.5, vy: 1.5, posJitter: 1,
      size: 1.2, sizeEnd: 4, life: 1, color: DUST, alpha: 0.4, drag: 1.5, count: 12,
    });
  }

  shockwave(x: number) {
    this.ring.position.set(x, 0.3, 0);
    this.ringT = 0;
    this.ring.visible = true;
    this.glow.emit({
      x, y: 1, z: 0, spread: 14, size: 0.4, sizeEnd: 0.05,
      life: 0.6, color: 0xc9a6ff, alpha: 1, drag: 1.2, count: 50,
    });
  }

  /**
   * One cotton puff at a point in the car's frame, moving along (dx, dy, dz) in that frame, so puffs
   * follow the car through flips and rolls. The first frames get a small glow flash.
   */
  private puffAt(player: Player, px: number, py: number, pz: number, dx: number, dy: number, dz: number, p: Puff) {
    const at = player.carToWorld(this.nozzle.set(px, py, pz));
    const d = player.carToWorld(this.aim.set(dx, dy, dz).normalize(), true);
    const speed = p.speed ?? 0;
    (p.engulf ? this.vortex : this.smoke).emit({
      x: at.x, y: at.y, z: at.z,
      vx: d.x * speed, vy: d.y * speed, vz: d.z * speed - this.speed * 0.85, spread: p.spread ?? 0.5, posJitter: 0.12,
      size: p.size, sizeEnd: p.sizeEnd, life: p.life, color: this.puff, alpha: p.alpha ?? 0.75,
      drag: p.drag ?? 1.6, gravity: -0.35, spin: 0.9,
    });
    if (Math.random() < 0.3) {
      this.glow.emit({ x: at.x, y: at.y, z: at.z, spread: 0.3, size: 0.4, sizeEnd: 0.05, life: 0.12, color: JET_GLOW, alpha: 0.6 });
    }
  }

  /** Small cotton puffs popping out in a ring on the road around the car, then left behind. */
  private puffRing(x: number, base: number, count: number, out: number) {
    for (let k = 0; k < count; k++) {
      const a = ((k + Math.random() * 0.6) / count) * Math.PI * 2;
      const cx = Math.cos(a);
      const cz = Math.sin(a);
      const r = 1 + Math.random() * 0.6;
      this.smoke.emit({
        x: x + cx * r * 1.1, y: base + 0.3 + Math.random() * 0.3, z: cz * r * 2.2,
        vx: cx * out * (0.7 + Math.random() * 0.6), vy: 0.3, vz: cz * out * 0.8 - this.speed * 0.75,
        size: 0.7, sizeEnd: 1.7, life: 0.6, color: this.puff, alpha: 0.5, drag: 2.5, gravity: -0.3, spin: 0.8,
      });
    }
  }

  /** Where a smoke column hits the road, its gas billows up and rolls outward in a big cloud. */
  private jetSplash(at: THREE.Vector3) {
    const a = Math.random() * Math.PI * 2;
    const out = 1.5 + Math.random() * 3;
    this.smoke.emit({
      x: at.x + Math.cos(a) * 0.4, y: at.y + 0.3, z: at.z + Math.sin(a) * 0.4,
      vx: Math.cos(a) * out, vy: 0.8 + Math.random() * 1.2, vz: Math.sin(a) * out - this.speed * 0.8,
      size: 1.3, sizeEnd: 3.2 + Math.random() * 1.6, life: 1.3, color: this.puff, alpha: 0.38, drag: 1.6, gravity: -0.4, spin: 0.5,
    });
  }

  /** A big cloud rolling out along the ground from under the car. */
  private groundCloud(x: number, base: number, strength: number) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const out = 1.5 + Math.random() * 3;
    this.smoke.emit({
      x: x + side * (0.5 + Math.random() * 1.1), y: base + 0.35, z: -1.4 + Math.random() * 3.6,
      vx: side * out * strength, vy: 0.4 + Math.random() * 0.6, vz: (Math.random() - 0.3) * 2 - this.speed * 0.7,
      size: 1.0, sizeEnd: 2.4 + Math.random() * 0.8, life: 1.2, color: this.puff, alpha: 0.42, drag: 1.8, gravity: -0.2, spin: 0.6,
    });
  }

  crash(x: number, y: number) {
    this.glow.emit({
      x, y: y + 0.6, z: -1.8, spread: 1.5, posJitter: 0.4,
      size: 2.6, sizeEnd: 0.4, life: 0.35, color: FIREBALL, alpha: 1, count: 6,
    });
    this.glow.emit({
      x, y: y + 0.6, z: -1.5, spread: 9, vy: 4, size: 0.3, sizeEnd: 0.05,
      life: 0.7, color: SPARK, alpha: 1, gravity: 14, drag: 0.6, count: 60,
    });
    this.smoke.emit({
      // Launched along with the sliding wreck so the cloud billows around it instead of whipping past.
      x, y: y + 0.5, z: -1, spread: 3, vy: 1.5, vz: -this.speed * 0.9, posJitter: 1,
      size: 1.5, sizeEnd: 5, life: 1.6, color: WRECK_SMOKE, alpha: 0.6, drag: 1.2, count: 34, spin: 0.5,
    });
  }
}
