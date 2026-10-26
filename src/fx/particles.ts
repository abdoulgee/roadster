import * as THREE from 'three';

const VERTEX = /* glsl */ `
  attribute float pSize;
  attribute float pAlpha;
  attribute float pRot;
  attribute vec3 pColor;
  uniform float scale;
  uniform vec2 nearFade;
  uniform float maxScreen;
  varying float vAlpha;
  varying float vRot;
  varying vec3 vColor;
  void main() {
    vColor = pColor;
    vRot = pRot;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // Fade out right in front of the lens so particles streaming past don't fill the screen.
    vAlpha = pAlpha * smoothstep(nearFade.x, nearFade.y, -mv.z);
    gl_PointSize = min(pSize * scale / -mv.z, scale * maxScreen);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  varying float vAlpha;
  varying float vRot;
  varying vec3 vColor;
  #ifdef USE_PUFF
    uniform sampler2D map;
  #endif
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    #ifdef USE_PUFF
      // A rotating cotton puff, lit from above in screen space so the shading stays put as it spins.
      float s = sin(vRot);
      float k = cos(vRot);
      vec4 t = texture2D(map, vec2(k * c.x - s * c.y, s * c.x + k * c.y) + 0.5);
      float a = t.a * vAlpha;
      if (a < 0.004) discard;
      float shade = mix(1.0, 0.78, smoothstep(-0.35, 0.45, c.y)) * mix(0.92, 1.0, t.a);
      // Lifted so white puffs stay white through tone mapping, with a faint lavender in the shadow.
      gl_FragColor = vec4(vColor * shade * mix(vec3(1.0), vec3(0.93, 0.92, 1.0), 1.0 - shade) * 1.35, a);
    #else
      float d = length(c);
      if (d > 0.5) discard;
      gl_FragColor = vec4(vColor, smoothstep(0.5, 0.0, d) * vAlpha);
    #endif
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** A lumpy cotton-ball puff: overlapping near-solid blobs with soft rims (alpha only; shading is in the shader). */
export function puffTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  for (let i = 0; i < 11; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = i === 0 ? 0 : 10 + Math.random() * 14;
    const r = i === 0 ? 34 : 18 + Math.random() * 12;
    const x = size / 2 + Math.cos(a) * d;
    const y = size / 2 + Math.sin(a) * d;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255, 255, 255, 1)');
    g.addColorStop(0.62, 'rgba(255, 255, 255, 0.92)');
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return new THREE.CanvasTexture(canvas);
}

export interface Emit {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  spread?: number; // random velocity added on each axis, ±spread
  posJitter?: number;
  size: number;
  sizeEnd: number;
  life: number;
  color: THREE.ColorRepresentation;
  alpha: number;
  drag?: number;
  /** Negative values make smoke rise. */
  gravity?: number;
  /** Max spin in radians per second (puff particles only). */
  spin?: number;
  count?: number;
}

export interface ParticleOptions {
  /** With a puff texture, particles draw as rotating cloud puffs instead of soft dots. */
  puff?: THREE.Texture;
  /** Camera distances (m) over which particles fade in, so ones streaming past don't blind the lens. */
  nearFade?: [number, number];
  /** Largest sprite as a fraction of the viewport height. */
  maxScreen?: number;
}

/**
 * Pooled point sprites in world space. The world scrolls past a stationary player, so every
 * particle is carried toward +z by the scroll distance to look left behind on the road.
 */
export class ParticleSystem {
  readonly points: THREE.Points;
  private readonly max: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly alpha0: Float32Array;
  private readonly drag: Float32Array;
  private readonly gravity: Float32Array;
  private readonly rot: Float32Array;
  private readonly spinRate: Float32Array;
  private readonly material: THREE.ShaderMaterial;
  private next = 0;
  private live = 0;
  private readonly tmpColor = new THREE.Color();

  constructor(max: number, blending: THREE.Blending, options: ParticleOptions = {}) {
    const { puff, nearFade = [1.5, 5], maxScreen = 0.25 } = options;
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.gravity = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.spinRate = new Float32Array(max);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('pColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('pSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('pAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('pRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        scale: { value: 600 },
        map: { value: puff ?? null },
        nearFade: { value: new THREE.Vector2(...nearFade) },
        maxScreen: { value: maxScreen },
      },
      defines: puff ? { USE_PUFF: '' } : {},
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  emit(e: Emit) {
    const spread = e.spread ?? 0;
    const jitter = e.posJitter ?? 0;
    this.tmpColor.set(e.color);
    for (let n = 0; n < (e.count ?? 1); n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      const i3 = i * 3;
      this.pos[i3] = e.x + (Math.random() - 0.5) * 2 * jitter;
      this.pos[i3 + 1] = e.y + (Math.random() - 0.5) * 2 * jitter;
      this.pos[i3 + 2] = e.z + (Math.random() - 0.5) * 2 * jitter;
      this.vel[i3] = (e.vx ?? 0) + (Math.random() - 0.5) * 2 * spread;
      this.vel[i3 + 1] = (e.vy ?? 0) + (Math.random() - 0.5) * 2 * spread;
      this.vel[i3 + 2] = (e.vz ?? 0) + (Math.random() - 0.5) * 2 * spread;
      this.col[i3] = this.tmpColor.r;
      this.col[i3 + 1] = this.tmpColor.g;
      this.col[i3 + 2] = this.tmpColor.b;
      this.life[i] = this.maxLife[i] = e.life * (0.75 + Math.random() * 0.5);
      this.size0[i] = e.size;
      this.size1[i] = e.sizeEnd;
      this.alpha0[i] = e.alpha;
      this.drag[i] = e.drag ?? 0;
      this.gravity[i] = e.gravity ?? 0;
      this.rot[i] = Math.random() * Math.PI * 2;
      this.spinRate[i] = (Math.random() - 0.5) * 2 * (e.spin ?? 0);
    }
    this.live = this.max;
  }

  /** `scroll` is how far the ground moved toward the camera this frame. */
  update(dt: number, scroll: number, camera: THREE.PerspectiveCamera, viewportHeight: number) {
    this.material.uniforms.scale.value = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    if (this.live === 0) return;
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.size[i] = 0;
        continue;
      }
      alive++;
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      const i3 = i * 3;
      const damping = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= damping;
      this.vel[i3 + 1] = this.vel[i3 + 1] * damping - this.gravity[i] * dt;
      this.vel[i3 + 2] *= damping;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt + scroll;
      if (this.pos[i3 + 1] < 0.05) {
        // Gas hitting the road spreads out across it instead of stopping dead.
        this.pos[i3 + 1] = 0.05;
        if (this.vel[i3 + 1] < 0) {
          const kick = -this.vel[i3 + 1] * 0.6;
          const a = Math.random() * Math.PI * 2;
          this.vel[i3] += Math.cos(a) * kick;
          this.vel[i3 + 2] += Math.sin(a) * kick;
          this.vel[i3 + 1] = 0;
        }
      }
      this.rot[i] += this.spinRate[i] * dt;
      this.size[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * (1 - (1 - t) * (1 - t));
      this.alpha[i] = this.alpha0[i] * (1 - t * t * t) * Math.min(1, t * 12); // hold, then fade at the end
    }
    this.live = alive;
    const attrs = this.points.geometry.attributes;
    attrs.position.needsUpdate = attrs.pColor.needsUpdate = attrs.pSize.needsUpdate = attrs.pAlpha.needsUpdate = true;
    attrs.pRot.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.size.fill(0);
    this.live = 0;
    this.points.geometry.attributes.pSize.needsUpdate = true;
  }
}
