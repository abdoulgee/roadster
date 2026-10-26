import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SUN_DIR } from '../config';
import { IS_TOUCH } from '../systems/input';
import type { Palette } from '../world/zones';

/** Brightest value (linear HDR) that may feed bloom and shafts; anything hotter is a glint, not a light. */
const FIREFLY_CAP = 6;

// One full-screen pass over the HDR image before tone mapping: sun shafts, heat shimmer, speed
// aberration, saturation and vignette.
const GRADE_FRAGMENT = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 sunPos;
  uniform float sunVisible;
  uniform float rays;
  uniform vec3 rayColor;
  uniform float heat;
  uniform float horizonY;
  uniform float saturation;
  uniform float vignette;
  uniform float aberration;
  uniform float time;
  uniform float aspect;
  uniform float sweep;
  uniform vec3 sweepColor;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  void main() {
    vec2 uv = vUv;
    // Heat haze: the air just above the horizon wobbles over hot ground.
    if (heat > 0.0) {
      float band = 1.0 - smoothstep(0.0, 0.045, abs(uv.y - horizonY - 0.012));
      uv.x += sin(uv.y * 420.0 + time * 11.0) * 0.0011 * heat * band;
      uv.y += sin(uv.x * 260.0 + time * 8.0) * 0.0006 * heat * band;
    }

    // Speed: red and blue split towards the edges of the screen.
    vec2 fromCentre = uv - 0.5;
    float split = aberration * dot(fromCentre, fromCentre);
    vec3 col = vec3(
      texture2D(tDiffuse, uv + fromCentre * split).r,
      texture2D(tDiffuse, uv).g,
      texture2D(tDiffuse, uv - fromCentre * split).b
    );

    // Sun shafts: march towards the sun and gather only the brightest pixels (the sun and its halo), so
    // anything standing in front of it - palms, mountains, trucks - cuts dark streaks into the light.
    if (rays * sunVisible > 0.001) {
      vec2 step = (uv - sunPos) / float(RAY_SAMPLES) * 0.85;
      vec2 p = uv - step * hash(uv * 731.0 + fract(time));
      float decay = 1.0;
      vec3 shafts = vec3(0.0);
      for (int i = 0; i < RAY_SAMPLES; i++) {
        p -= step;
        vec3 s = min(texture2D(tDiffuse, clamp(p, 0.001, 0.999)).rgb, vec3(${FIREFLY_CAP.toFixed(1)}));
        float lum = dot(s, vec3(0.2126, 0.7152, 0.0722));
        // Only the sky lights the shafts (the sunlit car or a white truck below the horizon must not).
        float sky = smoothstep(horizonY - 0.02, horizonY + 0.06, p.y);
        shafts += s * smoothstep(1.0, 3.0, lum) * sky * decay;
        decay *= 0.955;
      }
      shafts /= float(RAY_SAMPLES);
      float reach = 1.0 - smoothstep(0.05, 1.0, length((uv - sunPos) * vec2(aspect, 1.0)));
      col += shafts * rayColor * rays * sunVisible * reach * 3.0;
    }

    if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);

    // Zone change: a band of the new zone's light washes down the screen.
    if (sweep > 0.0) {
      float front = 1.25 - (1.0 - sweep) * 1.5;
      float band = exp(-pow((uv.y - front) * 7.0, 2.0));
      col += sweepColor * band * sweep * 0.9;
      col *= 1.0 + 0.25 * sweep * smoothstep(front, front + 0.4, uv.y);
    }
    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = max(mix(vec3(luma), col, saturation), 0.0);

    float edge = length(fromCentre * vec2(mix(1.0, aspect, 0.5), 1.0));
    col *= 1.0 - vignette * smoothstep(0.35, 0.95, edge);
    // A whisper of grain, enough to break up banding in the smooth sky gradients at any brightness.
    col *= 1.0 + (hash(vUv * 1931.0 + fract(time * 7.0)) - 0.5) * 0.035;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const GRADE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** The render pipeline: MSAA HDR scene render, bloom, grade, then tone mapping to the screen. */
export class Post {
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly grade: ShaderPass;
  private readonly sunWorld = new THREE.Vector3(...SUN_DIR).normalize();
  private readonly tmp = new THREE.Vector3();
  private time = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: IS_TOUCH ? 2 : 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.6, 2.4);
    // The bloom blur smears whatever feeds it over a wide area, so its bright-pass drops non-finite
    // pixels (a degenerate normal, say) and caps fireflies: a sun glint in a mirror-smooth puddle can be
    // thousands of times brighter than anything else and would otherwise bloom into a huge blob.
    const bright = this.bloom.materialHighPassFilter;
    bright.fragmentShader = bright.fragmentShader.replace(
      'vec4 texel = texture2D( tDiffuse, vUv );',
      `vec4 texel = texture2D( tDiffuse, vUv );
      if ( any( isnan( texel ) ) || any( isinf( texel ) ) ) texel = vec4( 0.0 );
      texel.rgb *= min( 1.0, ${FIREFLY_CAP.toFixed(1)} / max( max( texel.r, max( texel.g, texel.b ) ), 1e-4 ) );`,
    );
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        sunPos: { value: new THREE.Vector2(0.5, 0.5) },
        sunVisible: { value: 0 },
        rays: { value: 0 },
        rayColor: { value: new THREE.Color() },
        heat: { value: 0 },
        horizonY: { value: 0.5 },
        saturation: { value: 1 },
        vignette: { value: 0.38 },
        aberration: { value: 0 },
        time: { value: 0 },
        aspect: { value: 1 },
        sweep: { value: 0 },
        sweepColor: { value: new THREE.Color() },
      },
      defines: { RAY_SAMPLES: IS_TOUCH ? 16 : 36 },
      vertexShader: GRADE_VERTEX,
      fragmentShader: GRADE_FRAGMENT,
    });
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  /** Plays the zone-change light sweep in `color`. */
  zoneSweep(color: THREE.Color) {
    this.grade.uniforms.sweep.value = 1;
    this.grade.uniforms.sweepColor.value.copy(color);
  }

  setSize(width: number, height: number) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(width, height);
    this.grade.uniforms.aspect.value = width / height;
  }

  /** `speedK` 0–1 with road speed; `rush` 0–1 while boosting or in a power mode. */
  update(dt: number, p: Palette, speedK: number, rush: number) {
    this.time += dt;
    const u = this.grade.uniforms;
    u.time.value = this.time;
    u.sweep.value = Math.max(0, u.sweep.value - dt / 1.4);
    u.rays.value = p.rays;
    u.rayColor.value.copy(p.sun);
    u.heat.value = p.heat;
    u.saturation.value = p.saturation;
    u.aberration.value = speedK * 0.006 + rush * 0.02;
    this.bloom.strength = p.bloom;

    // Where the sun and the horizon sit on screen.
    const cam = this.camera;
    const sun = this.tmp.copy(this.sunWorld).multiplyScalar(800).add(cam.position).project(cam);
    u.sunPos.value.set(sun.x * 0.5 + 0.5, sun.y * 0.5 + 0.5);
    const onScreen = Math.max(Math.abs(sun.x), Math.abs(sun.y));
    u.sunVisible.value = sun.z < 1 ? 1 - THREE.MathUtils.smoothstep(onScreen, 1.0, 1.6) : 0;
    const horizon = this.tmp.set(cam.position.x, 0, cam.position.z - 900).project(cam);
    u.horizonY.value = horizon.y * 0.5 + 0.5;
  }

  render() {
    this.composer.render();
  }
}
