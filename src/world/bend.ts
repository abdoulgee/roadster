import * as THREE from 'three';

/**
 * World bending: everything ahead of the camera is pushed sideways and up/down by an amount that
 * grows with the square of its distance, so the straight highway reads as sweeping curves and hills
 * while gameplay stays on a straight line (the bend is ~0 where the car and nearby traffic are).
 *
 * The bend is applied in view space inside three's shared `project_vertex` chunk, so every built-in
 * material picks it up. `BEND` is shared by reference with every compiled program: three copies
 * uniform objects per material but keeps typed arrays as references, so writing to it moves the world.
 */
export const BEND = new Float32Array(2); // x: sideways, y: vertical, both per metre² of distance

// Appended to three's `common` chunk, so a custom ShaderMaterial that should bend with the world
// includes <common>, merges in bendUniforms() and applies `worldBend(mvPosition.z)` itself.
const BEND_GLSL = /* glsl */ `
  uniform vec2 uBend;
  vec2 worldBend(float z) {
    // Quadratic out to 260 m, then linear with the same slope, so the far scenery swings by a fixed
    // angle instead of flying off sideways.
    float d = max(-z, 0.0);
    const float knee = 260.0;
    float q = d < knee ? d * d : knee * (2.0 * d - knee);
    return uBend * q;
  }
`;

let installed = false;

/** Patches three's shader library; must run before any material compiles. */
export function installWorldBend() {
  if (installed) return;
  installed = true;
  THREE.ShaderChunk.common += BEND_GLSL;
  // Shadow depth passes (DEPTH_PACKING) see the world from the sun, so they stay unbent.
  const bent = /* glsl */ `
    #ifndef DEPTH_PACKING
      mvPosition.xy += worldBend(mvPosition.z);
    #endif
    gl_Position = projectionMatrix * mvPosition;`;
  THREE.ShaderChunk.project_vertex = THREE.ShaderChunk.project_vertex.replace('gl_Position = projectionMatrix * mvPosition;', bent);
  const sprite = THREE.ShaderLib.sprite;
  sprite.vertexShader = sprite.vertexShader.replace('gl_Position = projectionMatrix * mvPosition;', bent);
  for (const lib of Object.values(THREE.ShaderLib)) lib.uniforms.uBend = { value: BEND };
}

/** Uniforms to merge into a custom ShaderMaterial that bends with the world. */
export const bendUniforms = () => ({ uBend: { value: BEND } });
