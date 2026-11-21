import * as THREE from 'three';
import { AIR, LANES, PHYS, START_LANE, laneX } from '../config';
import { clamp, damp, easeInOut, lerp } from '../util/math';
import type { CarId, CarModel } from './carModel';
import { DEFAULT_CAR, getCar } from './cars';
import { contactShadow } from '../fx/contactShadow';
import type { PaintFinish, WheelFinish } from './finishes';

export type TrickKind = 'flip' | 'roll';
/**
 * Which cold-gas thrusters fire: jump/flip blast down, slam blasts up, steer fires one side, and
 * sputter is an empty tank coughing out a few puffs.
 */
export type ThrustKind = 'jump' | 'flip' | 'slam' | 'steer' | 'sputter';

export type PlayerEvent =
  | { type: 'jump' }
  | { type: 'land'; impact: number }
  | { type: 'trick'; kind: TrickKind }
  | { type: 'stunt'; count: number }
  | { type: 'sloppy' }
  | { type: 'thrust'; kind: ThrustKind; dir: number };

interface Trick {
  kind: TrickKind;
  dir: number;
  t: number; // 0..1 progress
  dur: number;
  fast: boolean; // a slam finishes the rotation quickly
  credited: boolean;
}

/** Seconds of airtime before a touch player's automatic flip, so a held jump can turn into flying first. */
const AUTO_FLIP_DELAY = 0.2;

// Heat shield: an energy shell of hexagonal cells. Clear in the middle, bright at the rim (fresnel), with
// cell edges that glow, cells that flicker, and pulses of energy running from nose to tail.
const SHIELD_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vPos;
  varying vec2 vUv;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    vPos = position;
    vUv = uv;
    gl_Position = projectionMatrix * mv;
  }
`;

const SHIELD_FRAGMENT = /* glsl */ `
  uniform vec3 color;
  uniform float strength;
  uniform float time;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vPos;
  varying vec2 vUv;

  float hexDist(vec2 p) {
    p = abs(p);
    return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);
  }
  // Offset to the nearest hexagon centre (xy) and that hexagon's id (zw).
  vec4 hexCell(vec2 uv) {
    const vec2 r = vec2(1.0, 1.7320508);
    vec2 h = r * 0.5;
    vec2 a = mod(uv, r) - h;
    vec2 b = mod(uv - h, r) - h;
    vec2 g = dot(a, a) < dot(b, b) ? a : b;
    return vec4(g, uv - g);
  }
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    float facing = abs(dot(normalize(vNormal), vView));
    float rim = pow(1.0 - facing, 2.4);
    vec4 cell = hexCell(vUv * vec2(30.0, 13.0));
    float edge = smoothstep(0.07, 0.0, 0.5 - hexDist(cell.xy));
    float flicker = pow(0.5 + 0.5 * sin(time * 3.0 + hash(cell.zw) * 40.0), 6.0);
    // Two pulses sweep from nose to tail.
    float wave = exp(-pow((vPos.z - (mod(time * 1.3, 3.0) - 1.5)) * 5.0, 2.0))
               + 0.6 * exp(-pow((vPos.z - (mod(time * 1.3 + 1.5, 3.0) - 1.5)) * 5.0, 2.0));
    float glow = rim * 0.75 + edge * (0.035 + rim * 0.55 + wave * 0.45) + flicker * 0.02 + wave * 0.04;
    vec3 hot = mix(color, vec3(1.0, 0.95, 0.85), clamp(edge * rim + wave * 0.35, 0.0, 1.0));
    // The far side shows through, dimmer.
    float side = gl_FrontFacing ? 1.0 : 0.3;
    gl_FragColor = vec4(hot * glow * strength * side, 1.0);
  }
`;

/** Suspension: spring stiffness (1/s²) and damping (1/s) for the body bouncing on its wheels. */
const SPRING_K = 190;
const SPRING_C = 15;

let beamTexture: THREE.Texture | null = null;

/**
 * Two headlamp throws on the road (v = 0 at the bumper, 1 at the far end): each fans out and fades
 * with distance, and both ease in from the bumper so the pool has no hard edge.
 */
function headlightBeams() {
  if (beamTexture) return beamTexture;
  const w = 64;
  const h = 128;
  const data = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) {
    const v = j / (h - 1);
    const reach = Math.min(1, v / 0.1) ** 2 * (1 - v) ** 1.6;
    const half = 0.07 + 0.2 * v;
    for (let i = 0; i < w; i++) {
      const u = i / (w - 1);
      let k = 0;
      for (const side of [-1, 1]) {
        const c = 0.5 + side * (0.17 + 0.1 * v);
        k += Math.exp(-(((u - c) / half) ** 2) * 2.2);
      }
      const edge = Math.min(1, Math.min(u, 1 - u) / 0.08);
      const val = Math.min(1, k * reach * edge) * 255;
      data.set([val, val, val, 255], (j * w + i) * 4);
    }
  }
  beamTexture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  beamTexture.magFilter = beamTexture.minFilter = THREE.LinearFilter;
  beamTexture.needsUpdate = true;
  return beamTexture;
}

/** A pool of lamp light flat on the road, added on top of it. */
const lampPool = (color: number) =>
  new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, -0.5),
    new THREE.MeshBasicMaterial({
      color,
      map: headlightBeams(),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    }),
  );

/** Seconds the shield takes to pop up around the car, and to burst when it saves you. */
const SHIELD_DEPLOY = 0.35;
const SHIELD_BURST = 0.45;

export class Player {
  readonly object = new THREE.Group();
  /** Hitbox, from the chosen car (see setCar). */
  width = 1.9;
  length = 4.4;
  readonly events: PlayerEvent[] = [];

  lane = START_LANE;
  x = laneX(START_LANE);
  y = 0;
  vy = 0;
  air = AIR.capacity;
  grounded = true;
  boosting = false;
  hovering = false;
  crashed = false;

  /** Rocket mode: thrusters run constantly and air never drains. */
  rocket = false;
  /** Touch play: one flip fires on its own each time the car is airborne and jump isn't held. */
  autoFlip = false;
  /** Current underside jet power (0–1); the smoke follows it. */
  jetPower = 0;
  /** Length of each underside smoke column as drawn (m, 0 = off), one per `thrusters.under` nozzle. */
  readonly jetLength = [0, 0, 0, 0];
  /** Whether each column has reached the road (or roof) below, where its gas piles up into clouds. */
  readonly jetHits = [false, false, false, false];
  /** Left and right wing jet power (0–1); each fires on a lane change and dies away. */
  readonly sideJets = [0, 0];

  private readonly pivot = new THREE.Group();
  private readonly shadow = contactShadow(4.4, 1.9, true);
  private readonly beams = lampPool(0xfff1d8);
  private readonly tailGlow = lampPool(0xff2030);
  /** 0 by day, 1 at night or in a tunnel: how much the lamps light the road. */
  private night = 0;
  // Sprung body: heave (m) and pitch (rad) with their velocities.
  private heave = 0;
  private heaveV = 0;
  private pitch = 0;
  private pitchV = 0;
  private model: CarModel;
  private readonly shieldMesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly shieldSize = new THREE.Vector3(1, 1, 1);
  private shieldT = 0;
  private shieldBursting = false;
  private laneFrom = this.x;
  private laneT = 1;
  private laneDur = PHYS.laneShiftTime;
  private laneDir = 0;
  private holdT = 0;
  private trick: Trick | null = null;
  private tricksThisAir = 0;
  private airT = 0;
  private autoFlipped = false;
  private readonly spin = new THREE.Vector3();
  private wheelAngle = 0;
  private readonly jetAt = new THREE.Vector3();
  private readonly jetDir = new THREE.Vector3();
  private time = 0;

  constructor() {
    this.model = getCar(DEFAULT_CAR);
    this.object.add(this.pivot);
    this.beams.renderOrder = this.tailGlow.renderOrder = -0.4;
    this.beams.visible = this.tailGlow.visible = false;
    this.tailGlow.rotation.y = Math.PI; // throws backwards
    this.object.add(this.shadow, this.beams, this.tailGlow);

    this.shieldMesh = new THREE.Mesh(
      // Poles at the nose and tail, so the hex cells stay even over the roof and sides.
      new THREE.SphereGeometry(1, 64, 32).rotateX(Math.PI / 2),
      new THREE.ShaderMaterial({
        vertexShader: SHIELD_VERTEX,
        fragmentShader: SHIELD_FRAGMENT,
        uniforms: { color: { value: new THREE.Color(0xff8a2a) }, strength: { value: 1 }, time: { value: 0 } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.shieldMesh.visible = false;
    this.pivot.add(this.shieldMesh);
    this.setCar(DEFAULT_CAR);
  }

  get car() {
    return this.model.spec;
  }

  get thrusters() {
    return this.model.thrusters;
  }

  /**
   * Swaps the car under the player. The hitbox follows the car's real footprint, trimmed a little so
   * the long ones (Model X, Cybertruck) stay fair in a 3.6 m lane.
   */
  setCar(id: CarId) {
    this.pivot.remove(this.model.root);
    this.model = getCar(id);
    const spec = this.model.spec;
    this.width = Math.min(spec.width * 0.95, 1.98);
    this.length = Math.min(spec.length, 5.1);
    // Flips and rolls turn about the centre of mass, not the wheels.
    this.pivot.position.y = spec.pivotY;
    this.model.root.position.y = -spec.pivotY;
    this.pivot.add(this.model.root);
    this.shieldSize.set(spec.width * 0.79, spec.height * 0.88, spec.length * 0.66);
    this.shieldMesh.scale.copy(this.shieldSize);
    // Beams start at the front bumper and throw about 24 m up the road; the tail glow sits behind.
    this.beams.scale.set(spec.width * 2.4, 1, 24);
    this.beams.position.z = -spec.length / 2 + 0.2;
    this.tailGlow.scale.set(spec.width * 1.6, 1, 2.2);
    this.tailGlow.position.z = spec.length / 2 - 0.1;
    this.model.setSuspension(0, 0, 0);
    this.updateGroundFx(0);
    this.model.setPaintGlow(0x000000, 0);
    this.model.setJets(this.jetLength, 0, 0);
    this.model.setSideJets(0, 0);
  }

  /** Moves a point in the car's own frame (nose -z) to world space; `direction` rotates a vector instead. */
  carToWorld(v: THREE.Vector3, direction = false) {
    this.model.root.updateWorldMatrix(true, false);
    return direction ? v.transformDirection(this.model.root.matrixWorld) : this.model.root.localToWorld(v);
  }

  /** Raises the shield with a pop, or, if it is up, bursts it outward and fades it away. */
  setShield(on: boolean) {
    if (on) {
      this.shieldMesh.visible = true;
      this.shieldBursting = false;
      this.shieldT = 0;
    } else if (this.shieldMesh.visible && !this.shieldBursting) {
      this.shieldBursting = true;
      this.shieldT = 0;
    }
  }

  private updateShield(dt: number) {
    const mesh = this.shieldMesh;
    if (!mesh.visible) return;
    this.shieldT += dt;
    const u = mesh.material.uniforms;
    u.time.value = this.time;
    if (this.shieldBursting) {
      const k = this.shieldT / SHIELD_BURST;
      if (k >= 1) {
        mesh.visible = this.shieldBursting = false;
        return;
      }
      mesh.scale.copy(this.shieldSize).multiplyScalar(1 + k * 0.5);
      u.strength.value = 1.8 * (1 - k) ** 2;
      return;
    }
    // Pop up with a little overshoot and a flash, then a steady hum.
    const k = Math.min(1, this.shieldT / SHIELD_DEPLOY);
    const back = 1 + 2.2 * (k - 1) ** 3 + 1.2 * (k - 1) ** 2;
    mesh.scale.copy(this.shieldSize).multiplyScalar(Math.max(0.01, back));
    u.strength.value = 0.6 + Math.sin(this.time * 6) * 0.08 + (1 - k) * 1.4;
  }

  /** Lighting for the thruster smoke columns, from the zone palette. */
  setSmokeLight(tint: THREE.Color, sunColor: THREE.Color, sunDir: THREE.Vector3) {
    this.model.setSmokeLight(tint, sunColor, sunDir);
  }

  /** Paint shop finish for the current car; null restores its factory look. */
  setFinish(paint: PaintFinish | null, wheels: WheelFinish | null) {
    this.model.setFinish(paint, wheels);
  }

  /** How dark it is (0 day … 1 night or tunnel), for the lamps thrown on the road. */
  setNight(k: number) {
    this.night = k;
  }

  /** Paint glow for power modes; intensity 0 turns it off. */
  setGlow(color: THREE.ColorRepresentation, intensity: number) {
    this.model.setPaintGlow(color, intensity);
  }

  addAir(amount: number) {
    this.air = Math.min(AIR.capacity, this.air + amount);
  }

  reset() {
    this.lane = START_LANE;
    this.x = this.laneFrom = laneX(START_LANE);
    this.y = this.vy = 0;
    this.air = AIR.capacity;
    this.grounded = true;
    this.boosting = this.hovering = this.crashed = this.rocket = false;
    this.shieldMesh.visible = this.shieldBursting = false;
    this.setGlow(0x000000, 0);
    this.laneT = 1;
    this.laneDir = 0;
    this.holdT = 0;
    this.trick = null;
    this.tricksThisAir = 0;
    this.events.length = 0;
    this.pivot.rotation.set(0, 0, 0);
    this.heave = this.heaveV = this.pitch = this.pitchV = 0;
    this.model.setSuspension(0, 0, 0);
    this.jetPower = this.sideJets[0] = this.sideJets[1] = 0;
    this.jetLength.fill(0);
    this.jetHits.fill(false);
    this.model.setJets(this.jetLength, 0, 0);
    this.model.setSideJets(0, 0);
    this.syncObject();
  }

  get shifting() {
    return this.laneT < 1;
  }

  /** Mid-air barrel roll: the underside jets fire through it and corkscrew their gas. */
  get rolling() {
    return !this.grounded && this.trick?.kind === 'roll';
  }

  steer(dir: -1 | 1) {
    if (this.crashed) return;
    const target = this.lane + dir;
    if (target < 0 || target >= LANES) return;
    this.laneFrom = this.x;
    this.lane = target;
    this.laneT = 0;
    this.laneDir = dir;
    this.events.push({ type: 'thrust', kind: 'steer', dir });
    // The wing jet on the far side fires, pushing the car across (moving left fires the right wing).
    this.sideJets[dir < 0 ? 1 : 0] = 1;
    if (this.grounded) {
      this.laneDur = this.air > 0 ? PHYS.laneShiftTime : PHYS.laneShiftTimeNoAir;
      this.spend(AIR.laneShift);
    } else {
      // Steering in the air is a barrel roll.
      this.laneDur = PHYS.airLaneShiftTime;
      this.spend(AIR.airLaneShift);
      if (!this.trick) this.startTrick('roll', dir, PHYS.trickTime);
    }
  }

  pressJump() {
    if (this.crashed) return;
    if (this.grounded) {
      this.vy = Math.sqrt(2 * PHYS.gravity * PHYS.jumpHeight);
      this.grounded = false;
      this.tricksThisAir = 0;
      const kind = this.air >= AIR.jump ? 'jump' : 'sputter';
      this.spend(AIR.jump);
      this.events.push({ type: 'jump' }, { type: 'thrust', kind, dir: 0 });
    } else if (!this.trick && this.air < AIR.flipMin) {
      this.events.push({ type: 'thrust', kind: 'sputter', dir: 0 });
    } else if (!this.trick) {
      this.spend(AIR.flip);
      this.events.push({ type: 'thrust', kind: 'flip', dir: 0 });
      this.vy = Math.max(this.vy, Math.sqrt(2 * PHYS.gravity * PHYS.flipMinLift));
      this.startTrick('flip', 1, PHYS.flipTime);
    }
  }

  slam() {
    if (this.crashed || this.grounded) return;
    this.vy = PHYS.slamSpeed;
    // A slam is a dive: no automatic flip afterwards to throw the car back up.
    this.autoFlipped = true;
    this.spend(AIR.slam);
    this.events.push({ type: 'thrust', kind: 'slam', dir: 0 });
    if (this.trick) {
      this.creditTrick();
      this.trick.fast = true;
    }
  }

  crash() {
    this.crashed = true;
    this.grounded = false;
    this.hovering = this.boosting = this.rocket = false;
    this.setShield(false);
    this.trick = null;
    this.vy = Math.max(this.vy, 6);
    this.spin.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 7, (Math.random() - 0.5) * 10);
    this.jetPower = this.sideJets[0] = this.sideJets[1] = 0;
    this.jetLength.fill(0);
    this.jetHits.fill(false);
    this.model.setJets(this.jetLength, 0, 0);
    this.model.setSideJets(0, 0);
  }

  /** `ground` is the height of whatever is under the car: road, or a vehicle roof. */
  update(dt: number, ground: number, speed: number, jumpHeld: boolean, boostHeld: boolean) {
    this.time += dt;
    this.wheelAngle -= (speed * dt) / this.model.spec.wheelRadius;
    for (const w of this.model.wheels) w.rotation.x = this.wheelAngle;

    if (this.crashed) {
      this.updateCrash(dt);
      this.updateGroundFx(0);
      this.updateShield(dt);
      return;
    }

    if (this.rocket) this.air = AIR.capacity;
    this.boosting = boostHeld && this.air > 0;
    if (this.boosting) this.spend(AIR.boostPerSec * dt);

    this.holdT = jumpHeld ? this.holdT + dt : 0;

    if (this.grounded) {
      if (ground < this.y - 0.05) {
        // Drove off the end of a roof.
        this.grounded = false;
        this.vy = 0;
        this.tricksThisAir = 0;
      } else {
        this.y = ground;
      }
    }

    this.hovering =
      !this.grounded && jumpHeld && this.holdT > PHYS.holdDelay && this.air > 0 && this.trick?.kind !== 'flip';

    if (!this.grounded) {
      if (this.hovering) {
        const targetVy = clamp((PHYS.maxHeight - this.y) * 2.5, -4, 6);
        this.vy = damp(this.vy, targetVy, 5, dt);
        this.spend(AIR.hoverPerSec * dt);
      } else {
        this.vy -= PHYS.gravity * (this.trick?.kind === 'flip' ? PHYS.flipGravity : 1) * dt;
      }
      this.y += this.vy * dt;
      if (this.y <= ground && this.vy <= 0) {
        this.y = ground;
        this.land();
      }
    }

    if (this.laneT < 1) {
      this.laneT = Math.min(1, this.laneT + dt / this.laneDur);
      this.x = lerp(this.laneFrom, laneX(this.lane), easeInOut(this.laneT));
    }

    if (this.trick) {
      this.trick.t += (dt / this.trick.dur) * (this.trick.fast ? 4 : 1);
      if (this.trick.t >= 1) {
        this.creditTrick();
        this.trick = null;
      }
    }

    if (this.grounded) {
      this.airT = 0;
      this.autoFlipped = false;
    } else {
      this.airT += dt;
      // Just after take-off, or as soon as a hold-to-fly ends. Each flip relaunches the car, so only one
      // comes for free per jump; tapping jump in the air still adds more.
      if (this.autoFlip && !this.autoFlipped && !jumpHeld && !this.trick && this.airT > AUTO_FLIP_DELAY && this.air >= AIR.flipMin) {
        this.autoFlipped = true;
        this.pressJump();
      }
    }

    if (this.grounded && !this.boosting) {
      this.air = Math.min(AIR.capacity, this.air + AIR.groundRefillPerSec * dt);
    }

    this.updatePose();
    this.updateSuspension(dt, speed);
    this.syncObject();
    this.updateGroundFx(ground);
    // An empty tank fires nothing: no jets, just a sputter on the press.
    const fuelled = this.air > 0;
    this.jetPower =
      this.hovering || (this.rolling && fuelled) ? 1 : this.rocket ? 0.55 : !this.grounded && this.vy > 4 && fuelled ? 0.6 : 0;
    this.updateJets(dt, ground);
    const boostJets = this.rocket ? 1.4 : this.boosting ? 1 : 0;
    this.model.setJets(this.jetLength, boostJets, this.time);
    for (let i = 0; i < 2; i++) this.sideJets[i] = Math.max(0, this.sideJets[i] - dt * 3.5);
    this.model.setSideJets(this.sideJets[0], this.sideJets[1]);
    this.updateShield(dt);
  }

  /**
   * Each smoke column runs from its nozzle until it hits whatever is below (pointing sideways mid-roll,
   * it runs its full length). It shoots out over a moment rather than appearing whole, and dies away
   * when the jet cuts.
   */
  private updateJets(dt: number, ground: number) {
    for (let i = 0; i < 4; i++) {
      const thrusters = this.model.thrusters;
      let reach = thrusters.maxJetLength;
      let target = 0;
      if (this.jetPower > 0) {
        const [x, y, z] = thrusters.under[i];
        const at = this.carToWorld(this.jetAt.set(x, y, z));
        const dir = this.carToWorld(this.jetDir.set(...thrusters.underDir(i)), true);
        if (dir.y < -0.2) reach = Math.min(reach, Math.max(0.3, (at.y - ground) / -dir.y));
        target = Math.min(reach, thrusters.maxJetLength * this.jetPower);
      }
      let len = Math.min(this.jetLength[i], reach);
      len = target > len ? Math.min(target, len + dt * 30) : damp(len, target, 12, dt);
      this.jetLength[i] = len;
      this.jetHits[i] = target > 0 && target >= reach - 0.01 && len >= reach - 0.3;
    }
  }

  private startTrick(kind: TrickKind, dir: number, dur: number) {
    this.trick = { kind, dir, t: 0, dur, fast: false, credited: false };
  }

  private creditTrick() {
    const trick = this.trick;
    if (!trick || trick.credited) return;
    trick.credited = true;
    this.tricksThisAir++;
    this.air = Math.min(AIR.capacity, this.air + (trick.kind === 'flip' ? AIR.flipReward : AIR.rollReward));
    this.events.push({ type: 'trick', kind: trick.kind });
  }

  private land() {
    this.events.push({ type: 'land', impact: -this.vy });
    // The body slams down on its springs and rebounds, rocking a little fore and aft.
    this.heaveV -= clamp(-this.vy * 0.045, 0, 1.4);
    this.pitchV += clamp(-this.vy * 0.01, 0, 0.35) * (Math.random() < 0.5 ? -1 : 1);
    this.grounded = true;
    this.vy = 0;
    if (this.trick) {
      if (this.trick.t >= PHYS.trickLandGrace) this.creditTrick();
      else if (!this.trick.credited) this.events.push({ type: 'sloppy' });
      this.trick = null;
    }
    if (this.tricksThisAir > 0) this.events.push({ type: 'stunt', count: this.tricksThisAir });
    this.tricksThisAir = 0;
  }

  private spend(amount: number) {
    this.air = Math.max(0, this.air - amount);
  }

  private updatePose() {
    let pitch = this.grounded ? 0 : clamp(this.vy * 0.02, -0.3, 0.3);
    let roll = 0;
    const yaw = this.grounded ? -this.laneDir * Math.sin(Math.PI * this.laneT) * 0.18 : 0;
    if (this.trick) {
      const turn = Math.PI * 2 * easeInOut(Math.min(1, this.trick.t));
      if (this.trick.kind === 'flip') pitch -= turn;
      else roll = -this.trick.dir * turn;
    } else if (this.grounded) {
      roll = this.laneDir * Math.sin(Math.PI * this.laneT) * 0.06;
    }
    this.pivot.rotation.set(pitch, yaw, roll);
  }

  private updateCrash(dt: number) {
    this.vy -= PHYS.gravity * dt;
    this.y += this.vy * dt;
    if (this.y <= 0) {
      this.y = 0;
      this.vy = this.vy < -2 ? -this.vy * 0.35 : 0;
      this.spin.multiplyScalar(0.55);
    }
    this.pivot.rotation.x += this.spin.x * dt;
    this.pivot.rotation.y += this.spin.y * dt;
    this.pivot.rotation.z += this.spin.z * dt;
    this.syncObject();
  }

  /**
   * The body rides on springs over the wheels: it squats under boost, droops the wheels in the air,
   * compresses on landing, leans into lane changes and shivers faintly over the road at speed.
   */
  private updateSuspension(dt: number, speed: number) {
    const fast = clamp((speed - 20) / 80, 0, 1);
    const heaveTarget = this.grounded ? -0.006 * fast : 0.035;
    const pitchTarget = this.grounded && (this.boosting || this.rocket) ? 0.022 : 0;
    // Semi-implicit Euler on a damped spring; dt is capped at 1/20 s, well inside its stable range.
    this.heaveV += ((heaveTarget - this.heave) * SPRING_K - this.heaveV * SPRING_C) * dt;
    this.pitchV += ((pitchTarget - this.pitch) * SPRING_K - this.pitchV * SPRING_C) * dt;
    this.heave = clamp(this.heave + this.heaveV * dt, -0.09, 0.06);
    this.pitch = clamp(this.pitch + this.pitchV * dt, -0.05, 0.05);
    const t = this.time;
    const buzz = this.grounded ? fast * (Math.sin(t * 37) * 0.6 + Math.sin(t * 61 + 1.3) * 0.4) : 0;
    const roll = this.grounded && this.laneT < 1 ? -this.laneDir * Math.sin(Math.PI * this.laneT) * 0.025 : 0;
    this.model.setSuspension(this.heave + buzz * 0.0025, this.pitch + buzz * 0.0012, roll);
  }

  /** Contact shadow on whatever is below, and the lamps' pools of light on the road at night. */
  private updateGroundFx(ground: number) {
    const above = Math.max(0, this.y - ground);
    const shadow = this.shadow;
    shadow.position.y = ground - this.y + 0.012;
    // Spreads and fades as the car climbs; gone by about 7 m up.
    const spread = 1 + above * 0.12;
    const spec = this.model.spec;
    shadow.scale.set(spec.width * 1.12 * spread, 1, spec.length * 1.08 * spread);
    (shadow.material as THREE.MeshBasicMaterial).opacity = 0.9 * Math.exp(-above * 0.5);
    shadow.visible = above < 7;

    const lamps = this.crashed ? 0 : this.night * Math.exp(-above * 0.35);
    for (const m of [this.beams, this.tailGlow]) {
      m.visible = lamps > 0.01;
      m.position.y = ground - this.y + 0.02;
    }
    this.beams.material.opacity = lamps * 0.5;
    this.tailGlow.material.opacity = lamps * 0.14;
  }

  private syncObject() {
    this.object.position.set(this.x, this.y, 0);
  }
}
