import * as THREE from 'three';
import { ZONES, zoneWeights } from './zones';

/** World z range the field covers: from behind the camera out past the far scenery. */
export const FIELD_NEAR = 120;
export const FIELD_FAR = -700;
const SAMPLES = 256;

if (ZONES.length > 5) throw new Error('ZoneField supports up to five zone biomes');

/**
 * How much of each zone shows at each point along the road. The first four use RGBA; a companion
 * texture carries the fifth zone. Ground, scatter and other shaders sample it so their zone-specific looks
 * cross-fade exactly where the palette does, and scenery grows in and out at zone boundaries.
 */
export class ZoneField {
  readonly texture: THREE.DataTexture;
  readonly extraTexture: THREE.DataTexture;
  private readonly data = new Uint8Array(SAMPLES * 4);
  private readonly extraData = new Uint8Array(SAMPLES * 4);
  private readonly weights = Array(ZONES.length).fill(0) as number[];

  constructor() {
    this.texture = new THREE.DataTexture(this.data, SAMPLES, 1, THREE.RGBAFormat);
    this.texture.magFilter = this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.extraTexture = new THREE.DataTexture(this.extraData, SAMPLES, 1, THREE.RGBAFormat);
    this.extraTexture.magFilter = this.extraTexture.minFilter = THREE.LinearFilter;
    this.extraTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.update(0);
  }

  update(distance: number) {
    for (let i = 0; i < SAMPLES; i++) {
      const z = FIELD_FAR + ((i + 0.5) / SAMPLES) * (FIELD_NEAR - FIELD_FAR);
      zoneWeights(Math.max(0, distance - z), this.weights);
      for (let k = 0; k < 4; k++) this.data[i * 4 + k] = Math.round((this.weights[k] ?? 0) * 255);
      this.extraData[i * 4] = Math.round((this.weights[4] ?? 0) * 255);
    }
    this.texture.needsUpdate = true;
    this.extraTexture.needsUpdate = true;
  }
}

/** GLSL helpers for the four-channel zone field and its optional fifth biome channel. */
export const ZONE_FIELD_GLSL = /* glsl */ `
  uniform sampler2D uZoneField;
  uniform sampler2D uZoneFieldExtra;
  vec4 zoneAtZ(float z) {
    return texture2D(uZoneField, vec2((z - (${FIELD_FAR.toFixed(1)})) / ${(FIELD_NEAR - FIELD_FAR).toFixed(1)}, 0.5));
  }
  float zoneFiveAtZ(float z) {
    return texture2D(uZoneFieldExtra, vec2((z - (${FIELD_FAR.toFixed(1)})) / ${(FIELD_NEAR - FIELD_FAR).toFixed(1)}, 0.5)).r;
  }
`;
