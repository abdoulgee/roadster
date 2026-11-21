import * as THREE from 'three';

// Soft ambient-occlusion blobs that sit on the road under a vehicle. The sun's shadow map only gives a
// hard, offset shadow (and none at all under a low sun or in the tunnel), so without these the cars
// look like they hover a few centimetres off the tarmac.

let texture: THREE.Texture | null = null;

/** A rounded-rectangle footprint, dark in the middle and blurred out to nothing at the edges. */
function shadowTexture() {
  if (texture) return texture;
  const w = 128;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  // Several nested rounded rects, each fainter and larger: a cheap, filter-free blur.
  const layers = 18;
  for (let i = 0; i < layers; i++) {
    const k = i / (layers - 1); // 0 outer .. 1 inner
    const inset = 6 + k * 34;
    const r = 40 - k * 22;
    ctx.fillStyle = `rgba(0, 0, 0, ${0.035 + 0.075 * k * k})`;
    ctx.beginPath();
    ctx.roundRect(inset, inset * 1.25, w - inset * 2, h - inset * 2.5, r);
    ctx.fill();
  }
  // Darker pads where the tyres meet the road.
  for (const [x, y] of [[0.24, 0.2], [0.76, 0.2], [0.24, 0.8], [0.76, 0.8]]) {
    const g = ctx.createRadialGradient(x * w, y * h, 0, x * w, y * h, 22);
    g.addColorStop(0, 'rgba(0,0,0,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
let shared: THREE.MeshBasicMaterial | null = null;

function material(opacity: number) {
  const m = new THREE.MeshBasicMaterial({
    color: 0x000000,
    alphaMap: shadowTexture(),
    transparent: true,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    fog: true,
  });
  return m;
}

/**
 * A contact shadow for a vehicle `length` × `width` metres, as a flat mesh to add at ground level.
 * Traffic shares one material; pass `own` to get a private one whose opacity can be animated.
 */
export function contactShadow(length: number, width: number, own = false) {
  const mat = own ? material(0.9) : (shared ??= material(0.85));
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.scale.set(width * 1.18, 1, length * 1.1);
  mesh.position.y = 0.012;
  mesh.renderOrder = -0.5;
  mesh.name = 'contact-shadow';
  mesh.raycast = () => {};
  return mesh;
}
