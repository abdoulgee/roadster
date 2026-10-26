import * as THREE from 'three';
import { IS_TOUCH } from '../systems/input';
import { mulberry32 } from '../util/rng';
import type { Palette } from '../world/zones';

// The box of air around the camera that rain and motes live in (relative to the camera).
const BOX = new THREE.Vector3(70, 26, 90);
const BOX_Z0 = -80; // from 80 m ahead to 10 m behind

const RAIN_VERTEX = /* glsl */ `
  attribute vec3 aBase;
  attribute float aEnd;
  uniform float uTime;
  uniform float uScroll;
  uniform float uSpeed;
  uniform vec3 uCamera;
  uniform vec3 uBox;
  varying float vFade;
  void main() {
    // Each drop falls and is carried towards the camera with the road, wrapping inside the box.
    vec3 p = aBase;
    p.y = mod(aBase.y - uTime * 26.0, uBox.y);
    p.z = mod(aBase.z + uScroll, uBox.z) + ${BOX_Z0.toFixed(1)};
    // The streak leans with the car's speed (rain hits the windscreen at an angle).
    p += aEnd * vec3(0.0, 1.4, -0.03 * uSpeed);
    vec3 world = vec3(uCamera.x + p.x, p.y, uCamera.z + p.z);
    vec4 mv = modelViewMatrix * vec4(world, 1.0);
    vFade = (1.0 - smoothstep(30.0, 80.0, -mv.z)) * smoothstep(0.5, 3.0, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const RAIN_FRAGMENT = /* glsl */ `
  uniform float uAmount;
  varying float vFade;
  void main() {
    gl_FragColor = vec4(vec3(0.72, 0.76, 0.9), 0.32 * vFade * uAmount);
  }
`;

const MOTE_VERTEX = /* glsl */ `
  attribute vec3 aBase;
  uniform float uTime;
  uniform float uScroll;
  uniform vec3 uCamera;
  uniform vec3 uBox;
  uniform float uScale;
  varying float vTwinkle;
  void main() {
    vec3 p = aBase;
    p.x += sin(uTime * 0.3 + aBase.z) * 1.5;
    p.y = mod(aBase.y + sin(uTime * 0.5 + aBase.x) * 0.8, 9.0) + 0.3;
    p.z = mod(aBase.z + uScroll, uBox.z) + ${BOX_Z0.toFixed(1)};
    vec3 world = vec3(uCamera.x + p.x * 0.5, p.y, uCamera.z + p.z);
    vec4 mv = modelViewMatrix * vec4(world, 1.0);
    vTwinkle = 0.6 + 0.4 * sin(uTime * 2.0 + aBase.x * 3.0);
    gl_PointSize = uScale * 0.06 / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const MOTE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAmount;
  varying float vTwinkle;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.0, d) * uAmount * vTwinkle;
    gl_FragColor = vec4(uColor * a * 1.5, a);
  }
`;

/** Rain in the city and dust or pollen drifting in the sunlight elsewhere, around the camera. */
export class Weather {
  private readonly rain: THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly motes: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private scroll = 0;
  private time = 0;

  constructor(scene: THREE.Scene) {
    const rng = mulberry32(13);
    const drops = IS_TOUCH ? 900 : 2200;
    const base = new Float32Array(drops * 6);
    const end = new Float32Array(drops * 2);
    for (let i = 0; i < drops; i++) {
      const x = (rng() - 0.5) * BOX.x;
      const y = rng() * BOX.y;
      const z = rng() * BOX.z;
      base.set([x, y, z, x, y, z], i * 6);
      end.set([0, 1], i * 2);
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(drops * 6), 3));
    rainGeo.setAttribute('aBase', new THREE.BufferAttribute(base, 3));
    rainGeo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    const shared = {
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uCamera: { value: new THREE.Vector3() },
      uBox: { value: BOX },
    };
    this.rain = new THREE.LineSegments(
      rainGeo,
      new THREE.ShaderMaterial({
        vertexShader: RAIN_VERTEX,
        fragmentShader: RAIN_FRAGMENT,
        uniforms: { ...shared, uSpeed: { value: 0 }, uAmount: { value: 0 } },
        transparent: true,
        depthWrite: false,
      }),
    );
    this.rain.frustumCulled = false;

    const count = IS_TOUCH ? 200 : 450;
    const moteBase = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) moteBase.set([(rng() - 0.5) * BOX.x, rng() * 9, rng() * BOX.z], i * 3);
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    moteGeo.setAttribute('aBase', new THREE.BufferAttribute(moteBase, 3));
    this.motes = new THREE.Points(
      moteGeo,
      new THREE.ShaderMaterial({
        vertexShader: MOTE_VERTEX,
        fragmentShader: MOTE_FRAGMENT,
        uniforms: { ...shared, uScale: { value: 600 }, uColor: { value: new THREE.Color() }, uAmount: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.motes.frustumCulled = false;
    scene.add(this.rain, this.motes);
  }

  update(dt: number, scrollDelta: number, speed: number, camera: THREE.PerspectiveCamera, viewportHeight: number, p: Palette) {
    this.time += dt;
    this.scroll = (this.scroll + scrollDelta) % BOX.z;
    for (const mat of [this.rain.material, this.motes.material]) {
      mat.uniforms.uTime.value = this.time;
      mat.uniforms.uScroll.value = this.scroll;
      mat.uniforms.uCamera.value.copy(camera.position);
    }
    const r = this.rain.material.uniforms;
    r.uSpeed.value = speed;
    r.uAmount.value = p.rain;
    this.rain.visible = p.rain > 0.01;
    const m = this.motes.material.uniforms;
    m.uAmount.value = p.motes * 0.5;
    m.uColor.value.copy(p.sun);
    m.uScale.value = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    this.motes.visible = p.motes > 0.01;
  }
}
