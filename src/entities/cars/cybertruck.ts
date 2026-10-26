import * as THREE from 'three';
import { linear } from '../../util/shape';
import { V_BELT, type CarDesign } from '../carModel';

const NOSE = -2.78;
const TAIL = 2.91;
const R = 0.445; // 35-inch tyres

/** The single straight ridge line: from the front light bar up to the apex over the B-pillar, down to the tailgate. */
const top = linear([[NOSE, 1.07], [0.05, 1.79], [TAIL, 1.33]]);
const sill = linear([[NOSE, 0.42], [TAIL, 0.45]]);
const crease = (z: number) => Math.min(1.13, top(z) - 0.005);

/** Trapezoid arches: a flat top over the tyre, straight sides down to the sill. */
const ARCH_TOP = 0.52;
const ARCH_FLAT = 0.36;
const ARCH_R = 0.7;

/**
 * Cybertruck: flat stainless-steel panels and hard creases. 5.68 m long, 2.03 m wide, 1.79 m tall on
 * a 3.63 m wheelbase; a full-width light bar across the nose, a triangular profile, a covered bed,
 * angular black wheel-arch flares and a full-width red light bar across the tailgate.
 */
export const CYBERTRUCK: CarDesign = {
  id: 'cybertruck',
  name: 'Cybertruck',
  tagline: 'Stainless-steel pickup',
  paint: { color: 0xb3b7bd, metalness: 1, roughness: 0.3, clearcoat: 0, anisotropy: 0.8 },
  nose: NOSE,
  tail: TAIL,
  axles: [-1.82, 1.815],
  height: 1.79,
  wheels: { radius: R, rim: 0.254, track: [0.86, 0.86], width: [0.29, 0.29], style: 'cyber', rimColor: 0x2b2d31, caliper: 0x2b2d31 },
  archR: ARCH_R,
  arch: (dz) => {
    const d = Math.abs(dz);
    return d <= ARCH_FLAT ? ARCH_TOP : ARCH_TOP + ((d - ARCH_FLAT) / (ARCH_R - ARCH_FLAT)) * (-0.03 - ARCH_TOP);
  },
  noseCap: [0.07, 8],
  tailCap: [0.06, 8],
  tailRound: 0,
  tailRoundY: 0.8,
  // No shear: with caps this short the stations would fold over each other.
  lean: { nose: 0, noseY: [1.0, 0.45], tail: 0, tailY: [1.2, 0.5] },
  faceted: true,
  step: 0.06,
  P: {
    width: linear([[NOSE, 0.99], [TAIL, 0.99]]),
    sill,
    floor: linear([[NOSE, 0.42], [-2.3, 0.34], [2.4, 0.34], [TAIL, 0.45]]),
    tuck: () => 0,
    scallop: () => 0,
    s1y: (z) => Math.min(0.58, top(z) - 0.3),
    s2y: (z) => Math.min(0.85, top(z) - 0.15),
    s3y: (z) => Math.min(1.08, top(z) - 0.03),
    bx: () => 0.95,
    by: crease,
    t1x: () => 0.78,
    t1y: (z) => Math.max(crease(z) + 0.01, top(z) - 0.09),
    t2x: () => 0.45,
    t2y: (z) => top(z) - 0.012,
    cy: top,
  },
  greenhouse: [[-1.05, V_BELT], [0.72, V_BELT], [0.62, 2.0], [0.6, 2.9], [-1.45, 2.9], [-1.3, 2.0]],
  windows: [
    [[-1.4, 1.95], [-0.08, 1.95], [-0.05, 2.9], [-1.44, 2.9]], // windscreen
    [[-0.98, 1.72], [-0.08, 1.72], [-0.1, 1.9], [-0.8, 1.9]], // front door
    [[0.05, 1.72], [0.66, 1.72], [0.52, 1.9], [0.05, 1.9]], // rear door
    [[0.12, 1.96], [0.5, 1.96], [0.52, 2.9], [0.12, 2.9]], // cab back glass
  ],
  canopyColor: 0x050506,
  decals: [
    // Black lower body all round, and the bed's tonneau cover.
    { material: 'trim', ns: 60, quads: [[[NOSE + 0.07, 1.0], [TAIL - 0.06, 1.0], [TAIL - 0.06, 1.14], [NOSE + 0.07, 1.14]]] },
    // The end caps are only centimetres deep, so they get their own finely gridded strips.
    {
      material: 'trim',
      ns: 16,
      quads: [
        [[NOSE, 1.0], [NOSE + 0.075, 1.0], [NOSE + 0.075, 1.14], [NOSE, 1.14]],
        [[TAIL - 0.065, 1.0], [TAIL, 1.0], [TAIL, 1.14], [TAIL - 0.065, 1.14]],
      ],
    },
    { material: 'trim', ns: 30, nt: 8, quads: [[[0.85, 1.93], [TAIL - 0.05, 1.93], [TAIL - 0.05, 2.9], [0.85, 2.9]]] },
    {
      material: 'gap',
      lift: 0.002,
      ns: 2,
      nt: 16,
      quads: [
        [[-1.08, 1.14], [-1.074, 1.14], [-1.06, V_BELT], [-1.066, V_BELT]],
        [[-0.02, 1.14], [-0.014, 1.14], [-0.01, V_BELT], [-0.016, V_BELT]],
        [[0.74, 1.14], [0.746, 1.14], [0.75, V_BELT], [0.744, V_BELT]],
      ],
    },
  ],
  interior: { seatZ: -0.15, seatX: 0.4, seatY: 0.62, dashZ: -0.95, dashY: 1.12, rearSeatZ: 0.55 },
  mirrors: { z: -0.98, housing: 'trim' },
  extras({ add }) {
    // Full-width light bars: white across the top of the nose, red across the top of the tailgate.
    add(new THREE.BoxGeometry(1.92, 0.028, 0.03), 'head', 'light-bar').position.set(0, top(NOSE) - 0.035, NOSE + 0.005);
    add(new THREE.BoxGeometry(1.9, 0.03, 0.03), 'tail', 'tail-bar').position.set(0, 1.08, TAIL + 0.005);
    // Angular black flares round each arch, standing proud of the steel.
    const s = sill(0);
    const peak = R + ARCH_TOP;
    const flare = new THREE.Shape();
    const outline = [[-0.84, s], [-0.42, peak + 0.11], [0.42, peak + 0.11], [0.84, s], [0.7, s], [ARCH_FLAT, peak], [-ARCH_FLAT, peak], [-0.7, s]];
    outline.forEach(([z, y], i) => (i ? flare.lineTo(z, y) : flare.moveTo(z, y)));
    flare.closePath();
    const geo = new THREE.ExtrudeGeometry(flare, { depth: 0.07, bevelEnabled: false }).rotateY(-Math.PI / 2);
    for (const axle of CYBERTRUCK.axles) {
      for (const side of [-1, 1]) {
        const m = add(geo, 'trim', 'flare');
        m.position.set(side * 1.05, 0, axle);
        m.scale.x = side;
      }
    }
  },
};
