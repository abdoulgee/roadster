import { profile } from '../../util/shape';
import { V_BELT, type CarDesign } from '../carModel';

const NOSE = -2.3;
const TAIL = 2.42;

/**
 * Model 3 (2024 "Highland"): a compact fastback saloon. 4.72 m long, 1.85 m wide, 1.44 m tall on a
 * 2.875 m wheelbase; a short dropping nose with razor-thin headlights, an all-glass black roof and
 * C-shaped tail lamps wrapped around the rear corners under a small trunk lip.
 */
export const MODEL_3: CarDesign = {
  id: 'model3',
  name: 'Model 3',
  tagline: 'Compact sport saloon',
  paint: { color: 0xe9eaec, metalness: 0.15, roughness: 0.3, clearcoat: 1 },
  nose: NOSE,
  tail: TAIL,
  axles: [-1.44, 1.435],
  height: 1.44,
  wheels: { radius: 0.335, rim: 0.229, track: [0.79, 0.79], width: [0.235, 0.235], style: 'aero', rimColor: 0x2c2e33, caliper: 0x2c2e33 },
  archR: 0.4,
  noseCap: [0.34, 2.5],
  tailCap: [0.34, 2.5],
  tailRound: 0.12,
  tailRoundY: 0.65,
  lean: { nose: 0.07, noseY: [0.48, 0.3], tail: 0.05, tailY: [0.8, 0.5] },
  P: {
    width: profile([[NOSE, 0.8], [-2.05, 0.885], [-1.7, 0.92], [-1.44, 0.925], [-0.8, 0.91], [0, 0.905], [0.9, 0.915], [1.44, 0.925], [2.0, 0.905], [TAIL, 0.84]]),
    sill: profile([[NOSE, 0.3], [-2.0, 0.24], [-1.0, 0.2], [1.0, 0.2], [2.0, 0.26], [TAIL, 0.4]]),
    floor: profile([[NOSE, 0.3], [-2.0, 0.2], [-1.6, 0.15], [1.7, 0.15], [2.15, 0.25], [TAIL, 0.4]]),
    tuck: profile([[1.9, 0], [TAIL, 0.05]]),
    scallop: profile([[NOSE, 0.02], [-1.0, 0.03], [0, 0.04], [1.0, 0.03], [TAIL, 0.04]]),
    s1y: profile([[NOSE, 0.36], [-1.9, 0.34], [0, 0.34], [2.0, 0.38], [TAIL, 0.45]]),
    s2y: profile([[NOSE, 0.48], [-1.95, 0.58], [-1.44, 0.64], [0, 0.66], [1.44, 0.72], [TAIL, 0.72]]),
    s3y: profile([[NOSE, 0.52], [-1.95, 0.66], [-1.44, 0.77], [-0.6, 0.81], [0.6, 0.85], [1.44, 0.88], [2.1, 0.88], [TAIL, 0.86]]),
    bx: profile([[NOSE, 0.7], [-1.95, 0.8], [-1.44, 0.83], [-0.7, 0.82], [0.4, 0.8], [1.4, 0.82], [2.1, 0.8], [TAIL, 0.74]]),
    by: profile([[NOSE, 0.56], [-2.0, 0.71], [-1.5, 0.79], [-1.0, 0.85], [-0.6, 0.91], [0.4, 0.94], [1.3, 0.97], [2.0, 0.99], [TAIL, 0.98]]),
    t1x: profile([[NOSE, 0.52], [-1.5, 0.63], [-0.8, 0.66], [0, 0.65], [0.9, 0.63], [1.7, 0.62], [TAIL, 0.6]]),
    t1y: profile([[NOSE, 0.57], [-2.0, 0.69], [-1.5, 0.77], [-0.9, 0.86], [-0.5, 1.04], [-0.2, 1.28], [0.2, 1.36], [0.6, 1.34], [1.1, 1.22], [1.6, 1.08], [2.0, 1.01], [TAIL, 1.0]]),
    t2x: profile([[NOSE, 0.27], [-1.5, 0.32], [0.1, 0.36], [1.5, 0.33], [TAIL, 0.31]]),
    t2y: profile([[NOSE, 0.58], [-2.0, 0.7], [-1.5, 0.77], [-0.9, 0.87], [-0.5, 1.08], [-0.2, 1.34], [0.2, 1.42], [0.6, 1.4], [1.1, 1.27], [1.6, 1.1], [2.0, 1.03], [TAIL, 1.02]]),
    cy: profile([[NOSE, 0.58], [-2.0, 0.7], [-1.5, 0.765], [-0.9, 0.87], [-0.5, 1.1], [-0.2, 1.36], [0.2, 1.44], [0.6, 1.42], [1.1, 1.28], [1.6, 1.11], [2.0, 1.04], [TAIL, 1.03]]),
  },
  greenhouse: [[-0.75, V_BELT], [1.55, V_BELT], [1.8, 2.1], [1.9, 2.4], [1.92, 2.9], [-0.92, 2.9]],
  windows: [
    [[-0.88, 1.96], [-0.06, 1.96], [-0.02, 2.9], [-0.92, 2.9]], // windscreen
    [[-0.6, 1.715], [0.42, 1.715], [0.42, 1.9], [0.05, 1.9]], // front door
    [[0.55, 1.715], [1.4, 1.715], [1.2, 1.88], [0.55, 1.9]], // rear door
    [[0.75, 2.15], [1.7, 2.22], [1.86, 2.45], [1.88, 2.9], [0.7, 2.9]], // rear glass
  ],
  decals: [
    { material: 'lens', quads: [[[NOSE + 0.07, 1.92], [NOSE + 0.4, 1.5], [NOSE + 0.43, 1.57], [NOSE + 0.085, 1.985]]] },
    { material: 'head', lift: 0.005, quads: [[[NOSE + 0.08, 1.965], [NOSE + 0.415, 1.55], [NOSE + 0.42, 1.565], [NOSE + 0.084, 1.978]]] },
    // C-shaped tail lamps: a band across the corner plus a drop down the side.
    {
      material: 'tailLens',
      quads: [
        [[TAIL - 0.34, 1.47], [TAIL - 0.006, 1.52], [TAIL - 0.006, 1.6], [TAIL - 0.34, 1.6]],
        [[TAIL - 0.36, 1.36], [TAIL - 0.3, 1.36], [TAIL - 0.3, 1.6], [TAIL - 0.36, 1.6]],
      ],
    },
    { material: 'tail', lift: 0.005, quads: [[[TAIL - 0.33, 1.575], [TAIL - 0.008, 1.578], [TAIL - 0.008, 1.59], [TAIL - 0.33, 1.59]]] },
    {
      material: 'trim',
      quads: [
        [[NOSE - 0.002, 1.02], [NOSE + 0.14, 1.02], [NOSE + 0.14, 1.12], [NOSE - 0.002, 1.12]], // lower intake slot
        [[TAIL - 0.28, 1.0], [TAIL + 0.002, 1.0], [TAIL + 0.002, 1.1], [TAIL - 0.28, 1.1]], // diffuser
        [[-0.72, 1.655], [1.55, 1.655], [1.55, 1.68], [-0.72, 1.68]], // black window line
      ],
    },
    {
      material: 'gap',
      lift: 0.002,
      ns: 2,
      nt: 16,
      quads: [
        [[-0.74, 1.05], [-0.734, 1.05], [-0.72, V_BELT], [-0.726, V_BELT]],
        [[0.49, 1.05], [0.496, 1.05], [0.5, V_BELT], [0.494, V_BELT]],
        [[1.42, 1.05], [1.426, 1.05], [1.45, V_BELT], [1.444, V_BELT]],
      ],
    },
  ],
  interior: { seatZ: 0.1, seatX: 0.34, seatY: 0.32, dashZ: -0.62, dashY: 0.82, rearSeatZ: 0.95 },
  mirrors: { z: -0.62, housing: 'paint' },
};
