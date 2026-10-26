import { profile } from '../../util/shape';
import { V_BELT, type CarDesign } from '../carModel';

const NOSE = -2.43;
const TAIL = 2.54;

/**
 * Model S (2021 refresh): a long, low liftback. 4.97 m long, 1.96 m wide, 1.43 m tall on a 2.96 m
 * wheelbase; smooth grille-less nose, slim wrapped headlights, a glass roof running into a long
 * fastback, and smoked tail lamps wrapped around the rear corners.
 */
export const MODEL_S: CarDesign = {
  id: 'modelS',
  name: 'Model S',
  tagline: 'Long-range luxury liftback',
  paint: { color: 0x13244a, metalness: 0.55, roughness: 0.35, clearcoat: 1 },
  nose: NOSE,
  tail: TAIL,
  axles: [-1.48, 1.48],
  height: 1.43,
  wheels: { radius: 0.352, rim: 0.241, track: [0.83, 0.845], width: [0.245, 0.245], style: 'turbine', rimColor: 0x8c9097, caliper: 0x3a3c40 },
  archR: 0.42,
  noseCap: [0.36, 2.6],
  tailCap: [0.38, 2.5],
  tailRound: 0.12,
  tailRoundY: 0.65,
  lean: { nose: 0.06, noseY: [0.5, 0.3], tail: 0.06, tailY: [0.82, 0.5] },
  P: {
    width: profile([[NOSE, 0.86], [-2.15, 0.94], [-1.8, 0.975], [-1.48, 0.982], [-1.0, 0.97], [0, 0.965], [1.0, 0.975], [1.48, 0.985], [2.0, 0.97], [TAIL, 0.9]]),
    sill: profile([[NOSE, 0.3], [-2.1, 0.24], [-1.0, 0.2], [1.0, 0.2], [2.1, 0.26], [TAIL, 0.38]]),
    floor: profile([[NOSE, 0.3], [-2.1, 0.2], [-1.7, 0.15], [1.8, 0.15], [2.25, 0.25], [TAIL, 0.38]]),
    tuck: profile([[2.0, 0], [TAIL, 0.05]]),
    scallop: profile([[NOSE, 0.02], [-1.0, 0.03], [0, 0.035], [1.0, 0.03], [TAIL, 0.04]]),
    s1y: profile([[NOSE, 0.36], [-2.0, 0.34], [-1.0, 0.33], [1.0, 0.34], [2.0, 0.38], [TAIL, 0.44]]),
    s2y: profile([[NOSE, 0.5], [-2.0, 0.6], [-1.48, 0.66], [-0.5, 0.66], [0.8, 0.68], [1.6, 0.72], [TAIL, 0.72]]),
    s3y: profile([[NOSE, 0.55], [-2.05, 0.7], [-1.48, 0.8], [-0.5, 0.84], [0.8, 0.87], [1.6, 0.9], [2.2, 0.89], [TAIL, 0.86]]),
    bx: profile([[NOSE, 0.74], [-2.05, 0.84], [-1.48, 0.88], [-0.7, 0.88], [0.4, 0.86], [1.4, 0.88], [2.2, 0.85], [TAIL, 0.8]]),
    by: profile([[NOSE, 0.58], [-2.1, 0.74], [-1.6, 0.82], [-1.0, 0.88], [-0.7, 0.93], [0.4, 0.95], [1.3, 0.97], [2.0, 0.98], [TAIL, 0.96]]),
    t1x: profile([[NOSE, 0.55], [-1.5, 0.66], [-0.75, 0.7], [0, 0.68], [1.0, 0.66], [1.8, 0.64], [TAIL, 0.62]]),
    t1y: profile([[NOSE, 0.59], [-2.1, 0.72], [-1.5, 0.8], [-0.9, 0.88], [-0.5, 1.06], [-0.15, 1.3], [0.3, 1.36], [0.8, 1.35], [1.3, 1.25], [1.8, 1.1], [2.2, 1.02], [TAIL, 0.99]]),
    t2x: profile([[NOSE, 0.28], [-1.5, 0.33], [0.2, 0.38], [1.5, 0.34], [TAIL, 0.32]]),
    t2y: profile([[NOSE, 0.6], [-2.1, 0.73], [-1.5, 0.81], [-0.9, 0.89], [-0.5, 1.1], [-0.15, 1.36], [0.3, 1.415], [0.8, 1.41], [1.3, 1.3], [1.8, 1.13], [2.2, 1.04], [TAIL, 1.0]]),
    cy: profile([[NOSE, 0.6], [-2.1, 0.73], [-1.5, 0.8], [-0.9, 0.89], [-0.5, 1.12], [-0.15, 1.38], [0.3, 1.43], [0.8, 1.425], [1.3, 1.31], [1.8, 1.14], [2.2, 1.05], [TAIL, 1.02]]),
  },
  greenhouse: [[-0.72, V_BELT], [1.75, V_BELT], [2.05, 2.1], [2.2, 2.4], [2.22, 2.9], [-0.92, 2.9]],
  windows: [
    [[-0.86, 1.96], [-0.02, 1.96], [0.02, 2.9], [-0.9, 2.9]], // windscreen
    [[-0.55, 1.715], [0.45, 1.715], [0.45, 1.9], [0.1, 1.9]], // front door
    [[0.6, 1.715], [1.38, 1.715], [1.25, 1.9], [0.6, 1.9]], // rear door
    [[1.47, 1.715], [1.72, 1.715], [1.55, 1.86], [1.47, 1.86]], // rear quarter
    [[1.0, 2.15], [1.95, 2.2], [2.15, 2.45], [2.18, 2.9], [0.95, 2.9]], // liftback glass
  ],
  decals: [
    { material: 'lens', quads: [[[NOSE + 0.07, 1.86], [NOSE + 0.42, 1.44], [NOSE + 0.47, 1.63], [NOSE + 0.1, 2.03]]] },
    { material: 'head', lift: 0.005, quads: [[[NOSE + 0.085, 1.985], [NOSE + 0.455, 1.585], [NOSE + 0.462, 1.605], [NOSE + 0.09, 2.0]]] },
    { material: 'tailLens', quads: [[[TAIL - 0.44, 1.4], [TAIL - 0.006, 1.47], [TAIL - 0.006, 1.62], [TAIL - 0.44, 1.62]]] },
    {
      material: 'tail',
      lift: 0.005,
      quads: [
        [[TAIL - 0.41, 1.585], [TAIL - 0.008, 1.59], [TAIL - 0.008, 1.605], [TAIL - 0.41, 1.605]],
        [[TAIL - 0.4, 1.43], [TAIL - 0.37, 1.43], [TAIL - 0.37, 1.6], [TAIL - 0.4, 1.6]],
      ],
    },
    {
      material: 'trim',
      quads: [
        [[NOSE - 0.002, 1.02], [NOSE + 0.16, 1.02], [NOSE + 0.16, 1.14], [NOSE - 0.002, 1.14]], // lower intake
        [[TAIL - 0.3, 1.0], [TAIL + 0.002, 1.0], [TAIL + 0.002, 1.12], [TAIL - 0.3, 1.12]], // diffuser
      ],
    },
    { material: 'chrome', lift: 0.0035, quads: [[[-0.7, 1.655], [1.74, 1.655], [1.74, 1.675], [-0.7, 1.675]]] },
    {
      material: 'gap',
      lift: 0.002,
      ns: 2,
      nt: 16,
      quads: [
        [[-0.71, 1.05], [-0.704, 1.05], [-0.69, V_BELT], [-0.696, V_BELT]],
        [[0.52, 1.05], [0.526, 1.05], [0.54, V_BELT], [0.534, V_BELT]],
        [[1.4, 1.05], [1.406, 1.05], [1.42, V_BELT], [1.414, V_BELT]],
      ],
    },
  ],
  interior: { seatZ: 0.15, seatX: 0.36, seatY: 0.32, dashZ: -0.62, dashY: 0.82, rearSeatZ: 1.05 },
  mirrors: { z: -0.58, housing: 'paint' },
};
