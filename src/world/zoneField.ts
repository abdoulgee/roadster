import * as THREE from 'three';
import { ZONES, zoneWeights } from './zones';

/** World z range the field covers: from behind the camera out past the far scenery. */
export const FIELD_NEAR = 120;
export const FIELD_FAR = -700;
const SAMPLES = 256;

if (ZONES.length !== 4) throw new Error('ZoneField packs exactly four zones into RGBA');

/**
 * How much of each zone shows at each point along the road, as a 1-pixel-high texture (RGBA = the
 * four zones, u = world z). Ground, scatter and other shaders sample it so their zone-specific looks
 * cross-fade exactly where the palette does, and scenery grows in and out at zone boundaries.
 */
export class ZoneField {
  readonly texture: THREE.DataTexture;
  private readonly data = new Uint8Array(SAMPLES * 4);
  private readonly weights = [0, 0, 0, 0];

  constructor() {
    this.texture = new THREE.DataTexture(this.data, SAMPLES, 1, THREE.RGBAFormat);
    this.texture.magFilter = this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.update(0);
  }

  update(distance: number) {
    for (let i = 0; i < SAMPLES; i++) {
      const z = FIELD_FAR + ((i + 0.5) / SAMPLES) * (FIELD_NEAR - FIELD_FAR);
      zoneWeights(Math.max(0, distance - z), this.weights);
      for (let k = 0; k < 4; k++) this.data[i * 4 + k] = Math.round(this.weights[k] * 255);
    }
    this.texture.needsUpdate = true;
  }
}

/** GLSL: `zoneAtZ(worldZ)` returns the four zone weights there. Needs a `uZoneField` sampler uniform. */
export const ZONE_FIELD_GLSL = /* glsl */ `
  uniform sampler2D uZoneField;
  vec4 zoneAtZ(float z) {
    return texture2D(uZoneField, vec2((z - (${FIELD_FAR.toFixed(1)})) / ${(FIELD_NEAR - FIELD_FAR).toFixed(1)}, 0.5));
  }
`;
