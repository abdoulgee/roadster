import { profile } from '../../util/shape';
import { V_BELT, type CarDesign } from '../carModel';

const NOSE = -2.33;
const TAIL = 2.46;

/**
 * Model Y (2025 "Juniper"): a fastback crossover. 4.79 m long, 1.92 m wide, 1.62 m tall on a 2.89 m
 * wheelbase; a full-width light bar across the nose with the headlamps set low in the corners, a
 * glass roof, and a full-width red light bar across the hatch under the spoiler lip.
 */
export const MODEL_Y: CarDesign = {
  id: 'modelY',
  name: 'Model Y',
  tagline: 'Light-bar crossover',
  paint: { color: 0x7d98b2, metalness: 0.45, roughness: 0.32, clearcoat: 1 },
  nose: NOSE,
  tail: TAIL,
  axles: [-1.445, 1.445],
  height: 1.62,
  wheels: { radius: 0.356, rim: 0.241, track: [0.82, 0.82], width: [0.255, 0.255], style: 'aero', rimColor: 0x26282c, caliper: 0x2c2e33 },
  archR: 0.43,
  noseCap: [0.36, 2.4],
  tailCap: [0.34, 2.4],
  tailRound: 0.1,
  tailRoundY: 0.8,
  lean: { nose: 0.06, noseY: [0.52, 0.32], tail: 0.06, tailY: [0.85, 0.55] },
  P: {
    width: profile([[NOSE, 0.82], [-2.05, 0.92], [-1.7, 0.955], [-1.445, 0.96], [-0.8, 0.95], [0.3, 0.95], [1.445, 0.965], [2.05, 0.95], [TAIL, 0.88]]),
    sill: profile([[NOSE, 0.34], [-2.0, 0.27], [-1.0, 0.23], [1.0, 0.23], [2.1, 0.29], [TAIL, 0.42]]),
    floor: profile([[NOSE, 0.34], [-2.0, 0.23], [-1.6, 0.17], [1.75, 0.17], [2.2, 0.29], [TAIL, 0.42]]),
    tuck: profile([[2.0, 0], [TAIL, 0.05]]),
    scallop: profile([[NOSE, 0.02], [-1.0, 0.03], [0.3, 0.035], [1.3, 0.03], [TAIL, 0.04]]),
    s1y: profile([[NOSE, 0.4], [-1.9, 0.38], [0, 0.38], [2.0, 0.42], [TAIL, 0.5]]),
    s2y: profile([[NOSE, 0.52], [-1.95, 0.64], [-1.445, 0.71], [0, 0.73], [1.445, 0.79], [TAIL, 0.8]]),
    s3y: profile([[NOSE, 0.58], [-1.95, 0.75], [-1.445, 0.86], [-0.5, 0.92], [0.6, 0.96], [1.445, 1.0], [2.1, 1.0], [TAIL, 0.98]]),
    bx: profile([[NOSE, 0.72], [-1.95, 0.84], [-1.445, 0.87], [-0.6, 0.86], [0.4, 0.85], [1.45, 0.87], [2.1, 0.85], [TAIL, 0.8]]),
    by: profile([[NOSE, 0.62], [-2.0, 0.79], [-1.5, 0.87], [-1.0, 0.93], [-0.6, 0.99], [0.4, 1.01], [1.4, 1.04], [2.1, 1.06], [TAIL, 1.05]]),
    t1x: profile([[NOSE, 0.54], [-1.5, 0.65], [-0.85, 0.7], [0, 0.7], [1.0, 0.68], [1.9, 0.66], [TAIL, 0.64]]),
    t1y: profile([[NOSE, 0.63], [-2.0, 0.78], [-1.5, 0.86], [-0.9, 0.95], [-0.45, 1.18], [-0.05, 1.44], [0.4, 1.52], [1.0, 1.5], [1.6, 1.38], [2.05, 1.25], [2.3, 1.2], [TAIL, 1.18]]),
    t2x: profile([[NOSE, 0.28], [-1.5, 0.33], [0.2, 0.38], [1.6, 0.35], [TAIL, 0.33]]),
    t2y: profile([[NOSE, 0.64], [-2.0, 0.79], [-1.5, 0.865], [-0.9, 0.96], [-0.45, 1.22], [-0.05, 1.52], [0.4, 1.6], [1.0, 1.58], [1.6, 1.44], [2.05, 1.29], [2.3, 1.22], [TAIL, 1.2]]),
    cy: profile([[NOSE, 0.64], [-2.0, 0.79], [-1.5, 0.86], [-0.9, 0.965], [-0.45, 1.24], [-0.05, 1.54], [0.4, 1.62], [1.0, 1.6], [1.6, 1.46], [2.05, 1.3], [2.3, 1.23], [TAIL, 1.21]]),
  },
  greenhouse: [[-0.78, V_BELT], [1.95, V_BELT], [2.2, 2.1], [2.3, 2.4], [2.32, 2.9], [-0.95, 2.9]],
  windows: [
    [[-0.9, 1.96], [-0.04, 1.96], [0.0, 2.9], [-0.94, 2.9]], // windscreen
    [[-0.62, 1.715], [0.4, 1.715], [0.4, 1.9], [0.02, 1.9]], // front door
    [[0.55, 1.715], [1.45, 1.715], [1.35, 1.9], [0.55, 1.9]], // rear door
    [[1.58, 1.715], [1.88, 1.715], [1.75, 1.86], [1.58, 1.86]], // rear quarter
    [[1.3, 2.15], [2.15, 2.2], [2.27, 2.45], [2.29, 2.9], [1.25, 2.9]], // hatch glass
  ],
  decals: [
    // Full-width light bar across the nose, with the headlamps tucked low in the corners.
    { material: 'head', lift: 0.005, quads: [[[NOSE - 0.002, 1.995], [NOSE + 0.42, 1.6], [NOSE + 0.42, 1.615], [NOSE - 0.002, 2.012]]] },
    { material: 'lens', quads: [[[NOSE + 0.1, 1.5], [NOSE + 0.36, 1.38], [NOSE + 0.38, 1.45], [NOSE + 0.12, 1.58]]] },
    // Full-width tail bar.
    { material: 'tailLens', quads: [[[TAIL - 0.36, 1.53], [TAIL + 0.002, 1.56], [TAIL + 0.002, 1.62], [TAIL - 0.36, 1.62]]] },
    { material: 'tail', lift: 0.005, quads: [[[TAIL - 0.34, 1.585], [TAIL + 0.002, 1.588], [TAIL + 0.002, 1.6], [TAIL - 0.34, 1.6]]] },
    {
      material: 'trim',
      quads: [
        [[NOSE - 0.002, 1.02], [NOSE + 0.16, 1.02], [NOSE + 0.16, 1.14], [NOSE - 0.002, 1.14]], // lower intake
        [[TAIL - 0.3, 1.0], [TAIL + 0.002, 1.0], [TAIL + 0.002, 1.14], [TAIL - 0.3, 1.14]], // diffuser
        [[-0.98, 1.0], [0.98, 1.0], [0.98, 1.07], [-0.98, 1.07]], // rocker
        [[-0.76, 1.655], [1.94, 1.655], [1.94, 1.68], [-0.76, 1.68]], // black window line
      ],
    },
    {
      material: 'gap',
      lift: 0.002,
      ns: 2,
      nt: 16,
      quads: [
        [[-0.76, 1.08], [-0.754, 1.08], [-0.74, V_BELT], [-0.746, V_BELT]],
        [[0.47, 1.08], [0.476, 1.08], [0.49, V_BELT], [0.484, V_BELT]],
        [[1.5, 1.08], [1.506, 1.08], [1.52, V_BELT], [1.514, V_BELT]],
      ],
    },
  ],
  interior: { seatZ: 0.05, seatX: 0.36, seatY: 0.38, dashZ: -0.68, dashY: 0.92, rearSeatZ: 0.95 },
  mirrors: { z: -0.64, housing: 'paint' },
};
