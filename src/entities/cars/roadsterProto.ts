import * as THREE from 'three';
import { profile, superellipse } from '../../util/shape';
import { V_BELT, type CarDesign } from '../carModel';

const TAIL = 2.12;

/** The 2017 Roadster prototype: a smooth, low hypercar with a black teardrop canopy. */
export const ROADSTER_PROTO: CarDesign = {
  id: 'roadsterProto',
  name: 'Roadster Prototype',
  tagline: 'The 2017 original',
  paint: { color: 0x8f0a16, metalness: 0.3, roughness: 0.45, clearcoat: 1 },
  nose: -2.25,
  tail: TAIL,
  axles: [-1.38, 1.32],
  height: 1.15,
  wheels: { radius: 0.36, rim: 0.255, track: [0.84, 0.86], width: [0.235, 0.255], style: 'split', rimColor: 0x6a6e76, caliper: 0xc4161c },
  archR: 0.405,
  noseCap: [0.32, 2.8],
  tailCap: [0.34, 2.6],
  lean: { nose: 0.09, noseY: [0.36, 0.2], tail: 0.1, tailY: [0.72, 0.42] },
  P: {
    width: profile([[-2.25, 0.84], [-1.95, 0.93], [-1.6, 0.965], [-1.2, 0.972], [-0.85, 0.955], [-0.4, 0.935], [0.2, 0.94], [0.7, 0.975], [1.1, 1.0], [1.5, 1.0], [1.85, 0.965], [2.12, 0.9]]),
    sill: profile([[-2.25, 0.2], [-1.9, 0.19], [-0.9, 0.2], [0.9, 0.2], [1.7, 0.22], [2.12, 0.4]]),
    floor: profile([[-2.25, 0.2], [-1.95, 0.17], [-1.5, 0.13], [1.55, 0.13], [1.85, 0.24], [2.12, 0.4]]),
    tuck: profile([[1.65, 0], [2.12, 0.06]]),
    scallop: profile([[-2.25, 0.02], [-1.0, 0.035], [-0.6, 0.08], [0.3, 0.075], [0.85, 0.035], [1.65, 0.02], [2.12, 0.06]]),
    s1y: profile([[-2.25, 0.25], [-1.9, 0.26], [-0.9, 0.29], [0.9, 0.32], [1.75, 0.36], [2.12, 0.47]]),
    // The character line dips behind the front wheel and sweeps up into the rear haunch.
    s2y: profile([[-2.25, 0.33], [-1.95, 0.42], [-1.4, 0.55], [-0.9, 0.52], [0.0, 0.56], [0.8, 0.63], [1.4, 0.66], [2.12, 0.62]]),
    s3y: profile([[-2.25, 0.37], [-1.95, 0.49], [-1.4, 0.75], [-0.9, 0.74], [-0.3, 0.72], [0.5, 0.75], [1.0, 0.8], [1.4, 0.83], [1.85, 0.82], [2.12, 0.83]]),
    bx: profile([[-2.25, 0.7], [-1.95, 0.78], [-1.4, 0.83], [-0.9, 0.82], [-0.4, 0.8], [0.4, 0.79], [0.9, 0.8], [1.35, 0.84], [1.75, 0.83], [2.12, 0.78]]),
    by: profile([[-2.25, 0.4], [-2.05, 0.52], [-1.85, 0.63], [-1.5, 0.8], [-1.2, 0.84], [-0.8, 0.82], [-0.3, 0.8], [0.3, 0.8], [0.8, 0.83], [1.3, 0.875], [1.7, 0.875], [2.12, 0.865]]),
    t1x: profile([[-2.25, 0.5], [-1.4, 0.6], [-0.85, 0.62], [-0.2, 0.6], [0.4, 0.58], [1.0, 0.56], [1.5, 0.58], [2.12, 0.58]]),
    t1y: profile([[-2.25, 0.4], [-1.95, 0.51], [-1.5, 0.69], [-1.15, 0.75], [-0.85, 0.8], [-0.5, 0.9], [-0.1, 1.0], [0.3, 1.05], [0.7, 1.04], [1.1, 0.99], [1.5, 0.925], [1.85, 0.88], [2.12, 0.88]]),
    t2x: profile([[-2.25, 0.25], [-1.4, 0.3], [0.2, 0.34], [0.8, 0.32], [1.4, 0.3], [2.12, 0.3]]),
    t2y: profile([[-2.25, 0.41], [-1.95, 0.495], [-1.5, 0.645], [-1.15, 0.71], [-0.85, 0.775], [-0.5, 0.92], [-0.1, 1.05], [0.3, 1.115], [0.6, 1.12], [1.0, 1.06], [1.4, 0.975], [1.75, 0.9], [2.12, 0.89]]),
    cy: profile([[-2.25, 0.41], [-1.95, 0.49], [-1.5, 0.635], [-1.15, 0.7], [-0.85, 0.77], [-0.5, 0.93], [-0.1, 1.07], [0.3, 1.135], [0.55, 1.145], [0.9, 1.1], [1.3, 1.01], [1.65, 0.915], [1.9, 0.885], [2.12, 0.895]]),
  },
  // Greenhouse and glazing as (z, v) polygons; anything past v = V_TOP mirrors onto the other half. The
  // canopy reads as one dark teardrop bubble and the panes inside it are see-through.
  greenhouse: [[-0.88, V_BELT], [1.22, V_BELT], [1.5, 2.1], [1.64, 2.35], [1.7, 2.56], [1.7, 2.9], [-0.92, 2.9]],
  windows: [
    [[-0.86, 1.96], [0.12, 1.96], [0.16, 2.9], [-0.9, 2.9]], // windscreen
    [[-0.45, 1.715], [0.85, 1.715], [0.72, 1.9], [0.0, 1.9]], // door glass
    [[0.93, 1.715], [1.18, 1.715], [1.02, 1.86], [0.9, 1.86]], // rear quarter glass
    [[0.9, 2.16], [1.4, 2.22], [1.52, 2.4], [1.57, 2.56], [1.57, 2.9], [0.85, 2.9]], // rear glass
  ],
  decals: [
    { material: 'lens', quads: [[[-2.165, 1.93], [-1.81, 1.49], [-1.765, 1.645], [-2.15, 2.05]]] },
    { material: 'head', lift: 0.005, quads: [[[-2.153, 2.015], [-1.785, 1.605], [-1.778, 1.625], [-2.15, 2.03]]] },
    { material: 'tailLens', quads: [[[TAIL - 0.32, 1.47], [TAIL - 0.006, 1.535], [TAIL - 0.006, 1.605], [TAIL - 0.32, 1.605]]] },
    { material: 'tail', lift: 0.005, quads: [[[TAIL - 0.29, 1.572], [TAIL - 0.008, 1.58], [TAIL - 0.008, 1.597], [TAIL - 0.29, 1.594]]] },
    {
      material: 'trim',
      quads: [
        [[-0.96, 1.0], [0.9, 1.0], [0.9, 1.07], [-0.96, 1.07]], // sill
        [[TAIL - 0.36, 1.0], [TAIL + 0.002, 1.0], [TAIL + 0.002, 1.16], [TAIL - 0.36, 1.16]], // rear valance
        [[-2.252, 1.03], [-2.12, 1.03], [-2.12, 1.17], [-2.252, 1.17]], // front intake
        [[-1.0, 1.4], [-0.86, 1.43], [-0.855, 1.448], [-0.995, 1.422]], // fender vent
      ],
    },
    {
      material: 'gap',
      lift: 0.002,
      ns: 2,
      nt: 16,
      quads: [
        [[-0.837, 1.05], [-0.831, 1.05], [-0.8, V_BELT], [-0.806, V_BELT]],
        [[0.86, 1.05], [0.866, 1.05], [0.904, V_BELT], [0.898, V_BELT]],
      ],
    },
  ],
  interior: { seatZ: 0.45, seatX: 0.34, seatY: 0.3, dashZ: -0.32, dashY: 0.7 },
  extras({ add, design }) {
    // Front splitter blade.
    const split = new THREE.Shape();
    split.moveTo(-0.82, 0);
    for (let k = 0; k <= 20; k++) {
      const x = -0.82 + (1.64 * k) / 20;
      split.lineTo(x, -0.28 * superellipse(Math.abs(x) / 0.82, 2.2) - 0.03);
    }
    split.lineTo(0.82, 0);
    split.closePath();
    add(new THREE.ExtrudeGeometry(split, { depth: 0.02, bevelEnabled: false }).rotateX(Math.PI / 2), 'trim', 'splitter').position.set(
      0,
      0.19,
      design.nose + 0.36,
    );
    // Diffuser strakes hang from the up-swept floor, flush with the tail.
    const fin = new THREE.Shape();
    fin.moveTo(TAIL - 0.58, 0.135);
    fin.lineTo(TAIL - 0.1, 0.34);
    fin.lineTo(TAIL - 0.1, 0.2);
    fin.closePath();
    const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.014, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(0.007, 0, 0);
    for (const x of [-0.5, -0.2, 0.2, 0.5]) add(finGeo, 'trim', 'fin').position.x = x;
  },
};
