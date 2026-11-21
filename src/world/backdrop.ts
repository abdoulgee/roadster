import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32, type Rng } from '../util/rng';
import { bendUniforms } from './bend';
import { ZONES, zoneWeights, type Palette } from './zones';

/** A point on the backdrop ring: `angle` 0 is straight down the road (-z), positive to the right. */
function ringPos(angle: number, dist: number) {
  return new THREE.Vector3(Math.sin(angle) * dist, 0, -Math.cos(angle) * dist);
}

/** Flat-topped butte with layered strata (vertex colours by height). */
function mesaGeometry(rng: Rng) {
  const h = 35 + rng() * 45;
  const r = 25 + rng() * 40;
  const geo = new THREE.CylinderGeometry(r * (0.62 + rng() * 0.15), r, h, 11, 8);
  const p = geo.attributes.position;
  const colors: number[] = [];
  const bands = [0xb2553a, 0xc9714a, 0x9c4632, 0xd8875a, 0xa24c36].map((c) => new THREE.Color(c));
  const wobble = Array.from({ length: 11 }, () => 0.85 + rng() * 0.3);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const k = wobble[Math.round(((a + Math.PI) / (Math.PI * 2)) * 10) % 11] * (y > h / 2 - 0.01 ? 1 : 1 + (rng() - 0.5) * 0.08);
    p.setXYZ(i, p.getX(i) * k, y + h / 2, p.getZ(i) * k);
    const band = bands[Math.floor(((y + h / 2) / h) * 7 + rng() * 0.3) % bands.length];
    colors.push(band.r, band.g, band.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

/** Turbine tower and nacelle (static part), and its three-bladed rotor (spins). */
function turbineGeometry() {
  const tower = mergeGeometries([
    new THREE.CylinderGeometry(0.9, 1.6, 48, 10).translate(0, 24, 0),
    new THREE.BoxGeometry(2.2, 2.2, 6).translate(0, 49, -1),
  ].map((g) => g.toNonIndexed()));
  const blades: THREE.BufferGeometry[] = [new THREE.SphereGeometry(1.1, 8, 6).toNonIndexed()];
  for (let i = 0; i < 3; i++) {
    blades.push(new THREE.BoxGeometry(1.6, 21, 0.3).translate(0.4, 11.5, 0).rotateZ((i / 3) * Math.PI * 2).toNonIndexed());
  }
  return { tower, rotor: mergeGeometries(blades) };
}

/** A single bird: two wing triangles meeting at the body; the shader flaps them. */
function birdGeometry() {
  const geo = new THREE.BufferGeometry();
  // x = span (wingtips at ±1), the third vertex trails behind the body.
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.3, -1, 0, 0, 0, 0, -0.3, 0, 0, 0.3, 0, 0, -0.3, 1, 0, 0], 3));
  return geo;
}

/**
 * Distant zone landmarks and sky life: mesas on the desert horizon, a wind farm turning on the salt
 * flats, searchlights sweeping the city sky, flocks of birds over the desert and the forest, and an
 * airliner drawing a contrail across clear skies. Each set rises from the horizon as its zone nears.
 */
export class Backdrop {
  private readonly mesas: THREE.Mesh;
  private readonly mesaMat: THREE.MeshStandardMaterial;
  private readonly white = new THREE.Color(0xffffff);
  private readonly farm = new THREE.Group();
  private readonly rotors: THREE.Object3D[] = [];
  private readonly beacon: THREE.MeshStandardMaterial;
  private readonly beams = new THREE.Group();
  private readonly beamMat: THREE.ShaderMaterial;
  private readonly birds: THREE.InstancedMesh;
  private readonly birdTime = { value: 0 };
  private readonly flock = new THREE.Group();
  private readonly plane = new THREE.Group();
  private readonly contrail: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly weights = Array(ZONES.length).fill(0) as number[];
  private time = 0;

  constructor(scene: THREE.Scene) {
    const rng = mulberry32(91);

    const mesaParts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 12; i++) {
      const angle = (rng() - 0.5) * 2.6;
      const at = ringPos(angle, 380 + rng() * 160);
      const g = mesaGeometry(rng).rotateY(rng() * 6).translate(at.x, -2, at.z);
      mesaParts.push(g);
    }
    // Past the fog, so they get their haze from a tint towards the horizon colour instead.
    this.mesaMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, fog: false });
    this.mesas = new THREE.Mesh(mergeGeometries(mesaParts), this.mesaMat);
    scene.add(this.mesas);

    const turbine = turbineGeometry();
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f3f5, roughness: 0.5 });
    this.beacon = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2020, emissiveIntensity: 0 });
    for (let i = 0; i < 11; i++) {
      const angle = (i / 10 - 0.5) * 2.2 + (rng() - 0.5) * 0.1;
      const t = new THREE.Group();
      t.position.copy(ringPos(angle, 200 + rng() * 160));
      t.rotation.y = -angle + 0.4;
      const tower = new THREE.Mesh(turbine.tower, white);
      const rotor = new THREE.Mesh(turbine.rotor, white);
      rotor.position.set(0, 49, 2.3);
      rotor.rotation.z = rng() * 6;
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 4), this.beacon);
      light.position.set(0, 50.4, -1);
      t.add(tower, rotor, light);
      this.rotors.push(rotor);
      this.farm.add(t);
    }
    scene.add(this.farm);

    // Searchlight beams: long cones fading along their length and at their edges.
    this.beamMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { strength: { value: 0 }, ...bendUniforms() },
      vertexShader: /* glsl */ `
        #include <common>
        varying float vAlong;
        varying vec3 vNormalV;
        varying vec3 vView;
        void main() {
          vAlong = uv.y;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          mv.xy += worldBend(mv.z);
          vView = -mv.xyz;
          vNormalV = normalMatrix * normal;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float strength;
        varying float vAlong;
        varying vec3 vNormalV;
        varying vec3 vView;
        void main() {
          float core = pow(abs(dot(normalize(vNormalV), normalize(vView))), 2.0);
          float a = core * pow(vAlong, 1.5) * strength;
          gl_FragColor = vec4(vec3(0.75, 0.8, 1.0) * a, a);
        }`,
    });
    const beamGeo = new THREE.CylinderGeometry(9, 0.8, 420, 16, 1, true).translate(0, 210, 0);
    for (let i = 0; i < 5; i++) {
      const pivot = new THREE.Group();
      pivot.position.copy(ringPos((i / 4 - 0.5) * 1.8, 280 + rng() * 40));
      pivot.userData.phase = rng() * 6;
      pivot.add(new THREE.Mesh(beamGeo, this.beamMat));
      this.beams.add(pivot);
    }
    scene.add(this.beams);

    // Birds: one instanced flock gliding across the sky, wings beating in the vertex shader.
    const birdMat = new THREE.MeshBasicMaterial({ color: 0x1a1418, side: THREE.DoubleSide, fog: false });
    birdMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.birdTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `vec3 transformed = position;
          float beat = sin(uTime * 9.0 + float(gl_InstanceID) * 1.7);
          transformed.y += abs(transformed.x) * beat * 0.7;`,
        );
    };
    this.birds = new THREE.InstancedMesh(birdGeometry(), birdMat, 16);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 16; i++) {
      // A loose V.
      const row = Math.floor((i + 1) / 2);
      const side = i % 2 ? 1 : -1;
      // Leader at the front (+z is the flight direction), the rest trailing back in two arms.
      m.makeScale(1.6, 1.6, 1.6).setPosition(side * row * 3.2 + (rng() - 0.5), (rng() - 0.5) * 1.5, -row * 3);
      this.birds.setMatrixAt(i, m);
    }
    this.birds.frustumCulled = false;
    this.flock.add(this.birds);
    scene.add(this.flock);

    // Airliner far overhead with a contrail streaming behind.
    const planeMat = new THREE.MeshBasicMaterial({ color: 0xe9eef5, fog: false });
    const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 14, 8).rotateZ(Math.PI / 2), planeMat);
    const wings = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 16), planeMat);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 0.2).translate(-6, 1.5, 0), planeMat);
    const trail = document.createElement('canvas');
    trail.width = 256;
    trail.height = 16;
    const ctx = trail.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 256, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 4, 256, 8);
    this.contrail = new THREE.Mesh(
      new THREE.PlaneGeometry(420, 4).translate(-215, 0, 0),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(trail), transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide }),
    );
    this.plane.add(fuselage, wings, tail, this.contrail);
    this.plane.scale.setScalar(1.4);
    scene.add(this.plane);
  }

  update(dt: number, distance: number, p: Palette) {
    this.time += dt;
    const t = this.time;
    // What lies on the horizon: the zone 250 m ahead, so landmarks are already up as a zone begins.
    const w = zoneWeights(distance + 250, this.weights);
    const rise = (k: number) => THREE.MathUtils.smoothstep(w[k], 0, 1);

    this.mesas.visible = rise(0) > 0.01;
    this.mesas.position.y = -(1 - rise(0)) * 90;
    this.mesaMat.color.copy(this.white).lerp(p.horizon, 0.4);
    this.mesaMat.emissive.copy(p.horizon).multiplyScalar(0.12);

    this.farm.visible = rise(1) > 0.01;
    this.farm.position.y = -(1 - rise(1)) * 75;
    for (const r of this.rotors) r.rotation.z -= dt * 1.1;
    this.beacon.emissiveIntensity = Math.sin(t * 3) > 0.6 ? 4 : 0.2;

    const city = rise(3);
    this.beams.visible = city > 0.01;
    this.beamMat.uniforms.strength.value = city * 0.35;
    this.beams.children.forEach((pivot, i) => {
      const ph = pivot.userData.phase as number;
      pivot.rotation.set(Math.sin(t * 0.35 + ph) * 0.45, 0, Math.sin(t * 0.27 + ph * 1.3) * 0.5 + (i - 2) * 0.12);
    });

    // A flock crosses every ~25 s over the desert or the forest, high and ahead.
    const birdsOn = Math.max(rise(0), rise(2));
    this.birdTime.value = t;
    const cross = (t % 25) / 25;
    this.flock.visible = birdsOn > 0.2 && cross < 0.9;
    this.flock.position.set(-160 + cross * 360, 34 + Math.sin(t * 0.4) * 4, -150);
    this.flock.rotation.y = Math.PI / 2; // local +z (forward) along +x, the way it travels

    // The airliner crosses clear daytime skies every ~40 s.
    const day = Math.max(rise(1), rise(2) * 0.6);
    const fly = (t % 40) / 40;
    this.plane.visible = day > 0.2;
    this.plane.position.set(-500 + fly * 1000, 210, -420);
    this.contrail.material.opacity = 0.7 * day;
  }
}
