import * as THREE from 'three';
import { profile } from '../../util/shape';
import { V_BELT, type CarDesign } from '../carModel';

const NOSE = -2.43;
const TAIL = 2.62;

/**
 * Model X: a big, rounded crossover. 5.06 m long, 2.0 m wide, 1.68 m tall on a 2.97 m wheelbase;
 * a panoramic windscreen that sweeps up over the front seats, falcon-wing rear doors, chrome window
 * line and a hatch with a rear spoiler.
 */
export const MODEL_X: CarDesign = {
  id: 'modelX',
  name: 'Model X',
  tagline: 'Falcon-wing SUV',
  paint: { color: 0x585c63, metalness: 0.6, roughness: 0.32, clearcoat: 1 },
  nose: NOSE,
  tail: TAIL,
  axles: [-1.48, 1.485],
  height: 1.68,
  wheels: { radius: 0.375, rim: 0.254, track: [0.845, 0.85], width: [0.265, 0.265], style: 'turbine', rimColor: 0x9a9ea5, caliper: 0x3a3c40 },
  archR: 0.45,
  noseCap: [0.44, 2.2],
  tailCap: [0.36, 2.4],
  tailRound: 0.1,
  tailRoundY: 0.8,
  lean: { nose: 0.06, noseY: [0.55, 0.35], tail: 0.06, tailY: [0.9, 0.55] },
  P: {
    width: profile([[NOSE, 0.86], [-2.1, 0.95], [-1.8, 0.99], [-1.48, 1.0], [-0.8, 0.99], [0.4, 0.99], [1.48, 1.0], [2.2, 0.985], [TAIL, 0.92]]),
    sill: profile([[NOSE, 0.36], [-2.1, 0.28], [-1.0, 0.24], [1.0, 0.24], [2.2, 0.3], [TAIL, 0.44]]),
    floor: profile([[NOSE, 0.36], [-2.1, 0.24], [-1.7, 0.18], [1.9, 0.18], [2.35, 0.3], [TAIL, 0.44]]),
    tuck: profile([[2.1, 0], [TAIL, 0.05]]),
    scallop: profile([[NOSE, 0.02], [-1.0, 0.025], [0.4, 0.03], [1.4, 0.025], [TAIL, 0.04]]),
    s1y: profile([[NOSE, 0.42], [-2.0, 0.4], [0, 0.4], [2.2, 0.44], [TAIL, 0.5]]),
    s2y: profile([[NOSE, 0.6], [-2.0, 0.72], [-1.48, 0.78], [0, 0.78], [1.48, 0.81], [TAIL, 0.82]]),
    s3y: profile([[NOSE, 0.7], [-2.05, 0.86], [-1.48, 0.96], [-0.5, 1.0], [0.6, 1.01], [1.48, 1.03], [2.2, 1.03], [TAIL, 1.0]]),
    bx: profile([[NOSE, 0.74], [-2.05, 0.86], [-1.48, 0.9], [-0.6, 0.9], [0.4, 0.89], [1.5, 0.9], [2.2, 0.87], [TAIL, 0.82]]),
    by: profile([[NOSE, 0.76], [-2.1, 0.91], [-1.6, 0.98], [-1.0, 1.03], [-0.6, 1.05], [0.4, 1.06], [1.5, 1.08], [2.2, 1.09], [TAIL, 1.08]]),
    t1x: profile([[NOSE, 0.56], [-1.5, 0.68], [-0.9, 0.74], [0, 0.74], [1.0, 0.73], [2.0, 0.72], [TAIL, 0.68]]),
    t1y: profile([[NOSE, 0.77], [-2.1, 0.92], [-1.5, 0.99], [-0.95, 1.05], [-0.5, 1.26], [-0.1, 1.5], [0.4, 1.6], [1.2, 1.6], [1.8, 1.52], [2.25, 1.4], [2.5, 1.32], [TAIL, 1.28]]),
    t2x: profile([[NOSE, 0.29], [-1.5, 0.34], [0.2, 0.4], [1.6, 0.38], [TAIL, 0.35]]),
    t2y: profile([[NOSE, 0.78], [-2.1, 0.93], [-1.5, 1.0], [-0.95, 1.06], [-0.5, 1.3], [-0.1, 1.58], [0.4, 1.665], [1.2, 1.67], [1.8, 1.6], [2.25, 1.45], [2.5, 1.35], [TAIL, 1.3]]),
    cy: profile([[NOSE, 0.78], [-2.1, 0.93], [-1.5, 1.0], [-0.95, 1.07], [-0.5, 1.32], [-0.1, 1.6], [0.4, 1.68], [1.2, 1.685], [1.8, 1.61], [2.25, 1.46], [2.5, 1.36], [TAIL, 1.31]]),
  },
  greenhouse: [[-0.82, V_BELT], [2.15, V_BELT], [2.4, 2.1], [2.48, 2.4], [2.5, 2.9], [-0.97, 2.9]],
  windows: [
    [[-0.92, 1.96], [0.3, 1.96], [0.32, 2.9], [-0.96, 2.9]], // panoramic windscreen
    [[-0.62, 1.715], [0.35, 1.715], [0.35, 1.9], [0.0, 1.9]], // front door
    [[0.5, 1.715], [1.6, 1.715], [1.55, 1.92], [0.5, 1.92]], // falcon-wing door
    [[1.72, 1.715], [2.05, 1.715], [1.95, 1.88], [1.72, 1.88]], // rear quarter
    [[1.85, 2.15], [2.38, 2.2], [2.45, 2.45], [2.46, 2.9], [1.8, 2.9]], // hatch glass
  ],
  decals: [
    { material: 'lens', quads: [[[NOSE + 0.09, 1.86], [NOSE + 0.44, 1.46], [NOSE + 0.48, 1.6], [NOSE + 0.11, 1.98]]] },
    { material: 'head', lift: 0.005, quads: [[[NOSE + 0.1, 1.94], [NOSE + 0.46, 1.555], [NOSE + 0.465, 1.575], [NOSE + 0.104, 1.958]]] },
    { material: 'tailLens', quads: [[[TAIL - 0.36, 1.46], [TAIL - 0.006, 1.5], [TAIL - 0.006, 1.6], [TAIL - 0.36, 1.6]]] },
    { material: 'tail', lift: 0.005, quads: [[[TAIL - 0.33, 1.56], [TAIL - 0.008, 1.565], [TAIL - 0.008, 1.58], [TAIL - 0.33, 1.58]]] },
    {
      material: 'trim',
      quads: [
        [[NOSE - 0.002, 1.02], [NOSE + 0.18, 1.02], [NOSE + 0.18, 1.16], [NOSE - 0.002, 1.16]], // lower intake
        [[TAIL - 0.32, 1.0], [TAIL + 0.002, 1.0], [TAIL + 0.002, 1.14], [TAIL - 0.32, 1.14]], // diffuser
        [[-1.0, 1.0], [1.0, 1.0], [1.0, 1.08], [-1.0, 1.08]], // rocker
      ],
    },
    { material: 'chrome', lift: 0.0035, quads: [[[-0.8, 1.655], [2.14, 1.655], [2.14, 1.675], [-0.8, 1.675]]] },
    {
      material: 'gap',
      lift: 0.002,
      ns: 2,
      nt: 16,
      quads: [
        [[-0.78, 1.08], [-0.774, 1.08], [-0.76, V_BELT], [-0.766, V_BELT]],
        [[0.42, 1.08], [0.426, 1.08], [0.44, V_BELT], [0.434, V_BELT]],
        [[1.66, 1.08], [1.666, 1.08], [1.68, V_BELT], [1.674, V_BELT]],
      ],
    },
  ],
  interior: { seatZ: 0.0, seatX: 0.38, seatY: 0.4, dashZ: -0.75, dashY: 0.95, rearSeatZ: 0.95 },
  mirrors: { z: -0.66, housing: 'paint' },
  extras({ add, design }) {
    // Rear spoiler lip along the top of the hatch.
    const z = design.tail - 0.14;
    const lip = new THREE.BoxGeometry(design.P.t1x(z) * 2 - 0.1, 0.022, 0.16);
    add(lip, 'paint', 'spoiler').position.set(0, design.P.t1y(z) + 0.03, z);
  },
};
