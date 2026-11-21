import * as THREE from 'three';
import { profile } from '../../util/shape';
import { V_BELT, type CarDesign } from '../carModel';

const NOSE = -2.25;
const TAIL = 2.1;
const R = 0.36;

/** The rear wing: chord centre, underside height and half span. */
const WING_Z = TAIL - 0.2;
const WING_Y = 1.07;
const WING_HALF = 0.88;

/**
 * Roadster (2026 reveal): an angular wedge in Ano White. 4.35 m long, 2.0 m wide, 1.14 m tall on a
 * 2.825 m wheelbase. A flat hood sits between raised fender blades with the headlamps hidden in the
 * notch, under a thin light bar over a black intake. One long raked windscreen runs into a gold-tinted
 * glasshouse with T-top panels. The tail is cut off high, with a full-width red light bar, a swan-neck
 * active wing and an exposed diffuser showing four thruster nozzles.
 */
export const ROADSTER: CarDesign = {
  id: 'roadster',
  name: 'Roadster',
  tagline: 'Ano White · 2026 reveal',
  // Ano White: a satin, slightly warm white, like the anodised coatings on rocket hardware.
  paint: { color: 0xeceae4, metalness: 0.05, roughness: 0.36, clearcoat: 0.7, clearcoatRoughness: 0.1 },
  nose: NOSE,
  tail: TAIL,
  axles: [-1.42, 1.405],
  height: 1.14,
  wheels: {
    radius: R,
    rim: 0.28,
    track: [0.85, 0.855],
    width: [0.255, 0.295],
    style: 'blade',
    rimColor: 0x1a1b1e,
    coverColor: 0xa6aab0,
    caliper: 0x1a1b1e,
  },
  archR: 0.42,
  noseCap: [0.3, 5],
  tailCap: [0.2, 4],
  tailRound: 0.02,
  tailRoundY: 0.6,
  lean: { nose: 0.05, noseY: [0.4, 0.2], tail: 0.05, tailY: [0.8, 0.5] },
  // Straight panels between the creases, so the wedge reads as folded sheet rather than a blob.
  crease: 0.36,
  P: {
    width: profile([[NOSE, 0.8], [-2.0, 0.92], [-1.42, 0.965], [-1.0, 0.955], [-0.3, 0.94], [0.5, 0.95], [1.405, 0.985], [1.85, 0.97], [TAIL, 0.9]]),
    sill: profile([[NOSE, 0.17], [-1.9, 0.18], [-1.0, 0.19], [0.9, 0.2], [1.8, 0.26], [TAIL, 0.34]]),
    floor: profile([[NOSE, 0.17], [-1.95, 0.14], [-1.5, 0.12], [1.55, 0.12], [1.9, 0.22], [TAIL, 0.3]]),
    tuck: profile([[1.7, 0], [TAIL, 0.05]]),
    // The lower side folds in under the main crease.
    scallop: profile([[NOSE, 0.03], [-1.0, 0.05], [0.9, 0.05], [TAIL, 0.03]]),
    s1y: profile([[NOSE, 0.2], [-1.0, 0.26], [0.9, 0.3], [TAIL, 0.38]]),
    // Main side crease: the widest line, rising toward the rear haunch.
    s2y: profile([[NOSE, 0.32], [-1.9, 0.4], [-1.42, 0.46], [-0.9, 0.44], [0.3, 0.47], [0.9, 0.5], [1.405, 0.55], [TAIL, 0.56]]),
    s3y: profile([[NOSE, 0.36], [-1.9, 0.5], [-1.42, 0.62], [-0.9, 0.6], [0.3, 0.64], [1.405, 0.72], [TAIL, 0.74]]),
    // Fender crest over the hood, then the belt under the glass, then the deck edge.
    bx: profile([[NOSE, 0.7], [-1.95, 0.84], [-1.42, 0.9], [-0.9, 0.88], [0, 0.86], [0.9, 0.88], [1.405, 0.92], [1.9, 0.9], [TAIL, 0.84]]),
    by: profile([[NOSE, 0.46], [-2.0, 0.62], [-1.42, 0.76], [-1.15, 0.8], [-0.8, 0.81], [0.3, 0.84], [1.0, 0.87], [1.6, 0.89], [TAIL, 0.87]]),
    // Inner edge of the fender blades, then the side glass, then the deck shoulder.
    t1x: profile([[NOSE, 0.5], [-1.95, 0.56], [-1.3, 0.6], [-0.8, 0.7], [-0.3, 0.74], [0.4, 0.74], [0.95, 0.72], [1.4, 0.66], [TAIL, 0.6]]),
    t1y: profile([[NOSE, 0.45], [-2.0, 0.6], [-1.42, 0.735], [-1.2, 0.76], [-0.8, 0.86], [-0.3, 1.0], [0.4, 1.03], [0.9, 0.97], [1.3, 0.92], [TAIL, 0.89]]),
    // Hood panel edge (sunk between the fenders at the front), roof edge, deck.
    t2x: profile([[NOSE, 0.46], [-1.3, 0.52], [-0.8, 0.5], [-0.3, 0.48], [0.4, 0.47], [1.0, 0.44], [TAIL, 0.4]]),
    t2y: profile([[NOSE, 0.43], [-1.95, 0.5], [-1.42, 0.62], [-1.25, 0.7], [-1.2, 0.755], [-0.8, 0.93], [-0.3, 1.11], [0.45, 1.13], [0.95, 1.04], [1.4, 0.96], [TAIL, 0.9]]),
    cy: profile([[NOSE, 0.43], [-1.95, 0.505], [-1.42, 0.63], [-1.25, 0.72], [-1.2, 0.77], [-0.8, 0.945], [-0.3, 1.13], [0.45, 1.145], [0.95, 1.05], [1.4, 0.965], [TAIL, 0.905]]),
  },
  // One sweep of gold-tinted glass from the cowl over the T-top roof, closing to a point behind the doors.
  greenhouse: [[-1.27, 1.8], [-0.98, V_BELT], [1.0, V_BELT], [0.8, 2.0], [0.82, 2.56], [0.82, 2.9], [-1.27, 2.9]],
  windows: [
    [[-1.24, 2.9], [-1.24, 1.83], [-0.95, V_BELT + 0.03], [-0.66, V_BELT + 0.03], [-0.38, 2.18], [-0.34, 2.9]], // windscreen
    [[-0.6, V_BELT + 0.03], [0.26, V_BELT + 0.03], [0.24, 2.15], [-0.32, 2.15]], // door glass
    [[0.34, V_BELT + 0.03], [0.94, V_BELT + 0.03], [0.5, 2.12], [0.34, 2.14]], // rear quarter glass
  ],
  canopyColor: 0x3b2711,
  glassTint: { color: 0x5c3c18, metalness: 0.55 },
  decals: [
    // Front: a thin light bar along the hood's leading edge over a black intake band.
    { material: 'trim', ns: 120, nt: 8, quads: [[[NOSE - 0.002, 1.0], [NOSE + 0.3, 1.0], [NOSE + 0.3, 1.58], [NOSE - 0.002, 1.58]]] },
    { material: 'head', lift: 0.004, ns: 120, quads: [[[NOSE - 0.002, 1.605], [NOSE + 0.075, 1.605], [NOSE + 0.075, 1.628], [NOSE - 0.002, 1.628]]] },
    // Hidden headlamps: slits in the notch where the fender blade stands over the hood.
    { material: 'lens', quads: [[[NOSE + 0.1, 1.76], [NOSE + 0.28, 1.76], [NOSE + 0.28, 1.95], [NOSE + 0.1, 1.95]]] },
    { material: 'head', lift: 0.005, quads: [[[NOSE + 0.14, 1.84], [NOSE + 0.27, 1.84], [NOSE + 0.27, 1.9], [NOSE + 0.14, 1.9]]] },
    // Rear: a full-width red light bar under the deck lip, over a black fascia.
    { material: 'tailLens', ns: 120, quads: [[[TAIL - 0.26, 1.575], [TAIL + 0.002, 1.575], [TAIL + 0.002, 1.645], [TAIL - 0.26, 1.645]]] },
    { material: 'tail', lift: 0.005, ns: 120, quads: [[[TAIL - 0.24, 1.6], [TAIL + 0.002, 1.6], [TAIL + 0.002, 1.618], [TAIL - 0.24, 1.618]]] },
    { material: 'trim', ns: 120, nt: 8, quads: [[[TAIL - 0.22, 1.0], [TAIL + 0.002, 1.0], [TAIL + 0.002, 1.5], [TAIL - 0.22, 1.5]]] },
    // Black lower body along the sides.
    { material: 'trim', ns: 40, quads: [[[-1.0, 1.0], [0.98, 1.0], [0.98, 1.12], [-1.0, 1.12]]] },
    {
      material: 'gap',
      lift: 0.002,
      ns: 2,
      nt: 16,
      quads: [
        [[-0.96, 1.08], [-0.954, 1.08], [-0.9, V_BELT], [-0.906, V_BELT]],
        [[0.26, 1.08], [0.266, 1.08], [0.3, V_BELT], [0.294, V_BELT]],
      ],
    },
  ],
  interior: { seatZ: 0.12, seatX: 0.36, seatY: 0.28, dashZ: -0.62, dashY: 0.72 },
  extras({ add, design }) {
    // Front splitter blade.
    add(new THREE.BoxGeometry(1.5, 0.018, 0.2), 'trim', 'splitter').position.set(0, 0.16, NOSE + 0.12);

    // Active rear wing: a cambered blade on two swan-neck pylons, its tips turned down.
    const chord = 0.32;
    const foil = new THREE.Shape();
    foil.moveTo(-chord / 2, 0);
    foil.quadraticCurveTo(-chord / 2 + 0.03, 0.045, chord * 0.05, 0.04);
    foil.quadraticCurveTo(chord * 0.35, 0.036, chord / 2, 0.05);
    foil.lineTo(chord / 2, 0.042);
    foil.quadraticCurveTo(0, 0.004, -chord / 2, 0);
    // Shape (z, y) extruded along x.
    const blade = (span: number) =>
      new THREE.ExtrudeGeometry(foil, { depth: span, bevelEnabled: false, curveSegments: 10 }).rotateY(Math.PI / 2).translate(-span / 2, 0, 0);
    const main = add(blade(WING_HALF * 2 - 0.16), 'paint', 'wing');
    main.position.set(0, WING_Y, WING_Z);
    main.castShadow = true;
    for (const side of [-1, 1]) {
      const tip = add(blade(0.1), 'paint', 'wing-tip');
      tip.position.set(side * (WING_HALF - 0.08), WING_Y, WING_Z);
      tip.geometry.translate(side * 0.05, 0, 0);
      tip.rotation.z = side * -0.5;
    }
    // Swan necks rise from the deck behind the glass and hook over onto the top of the wing.
    const deck = design.P.cy(WING_Z - 0.2) - 0.02;
    const neck = new THREE.Shape();
    neck.moveTo(WING_Z - 0.3, deck);
    neck.lineTo(WING_Z - 0.16, deck);
    neck.quadraticCurveTo(WING_Z - 0.1, WING_Y + 0.02, WING_Z - 0.04, WING_Y + 0.095);
    neck.quadraticCurveTo(WING_Z + 0.02, WING_Y + 0.12, WING_Z + 0.06, WING_Y + 0.045);
    neck.lineTo(WING_Z + 0.02, WING_Y + 0.04);
    neck.quadraticCurveTo(WING_Z - 0.01, WING_Y + 0.08, WING_Z - 0.06, WING_Y + 0.06);
    neck.quadraticCurveTo(WING_Z - 0.16, WING_Y - 0.04, WING_Z - 0.3, deck);
    const neckGeo = new THREE.ExtrudeGeometry(neck, { depth: 0.024, bevelEnabled: false, curveSegments: 8 })
      .rotateY(-Math.PI / 2)
      .translate(0.012, 0, 0);
    for (const x of [-0.42, 0.42]) add(neckGeo, 'trim', 'wing-mount').position.x = x;

    // Exposed diffuser: the floor sweeps up toward the tail between vertical fins, with four cold-gas
    // nozzles in its rear face. Profiles are drawn in (z, y) and extruded across the car.
    const zFront = TAIL - 0.46;
    const zBack = TAIL - 0.012;
    const across = (shape: THREE.Shape, width: number) =>
      new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 8 })
        .rotateY(-Math.PI / 2)
        .translate(width / 2, 0, 0);
    const ramp = new THREE.Shape();
    ramp.moveTo(zFront, 0.13);
    ramp.quadraticCurveTo(TAIL - 0.2, 0.14, zBack, 0.19);
    ramp.lineTo(zBack, 0.36);
    ramp.lineTo(zFront, 0.34);
    ramp.closePath();
    add(across(ramp, 1.24), 'trim', 'diffuser').castShadow = true;
    // Fins: flat along the floor line, their top edge following the ramp.
    const fin = new THREE.Shape();
    fin.moveTo(zFront + 0.04, 0.13);
    fin.quadraticCurveTo(TAIL - 0.2, 0.14, zBack + 0.004, 0.19);
    fin.lineTo(zBack + 0.004, 0.11);
    fin.quadraticCurveTo(TAIL - 0.12, 0.105, zFront + 0.08, 0.125);
    fin.closePath();
    const finGeo = across(fin, 0.014);
    for (const x of [-0.6, -0.26, 0, 0.26, 0.6]) add(finGeo, 'trim', 'strake').position.x = x;
    // Nozzles: a polished lip, a dark bell and a throat that glows hot under boost.
    const ring = new THREE.TorusGeometry(0.055, 0.011, 10, 32);
    // Mirrored so its inside faces outward: it is only ever seen from within, looking into the bell.
    const bell = new THREE.CylinderGeometry(0.052, 0.034, 0.07, 28, 1, true).rotateX(Math.PI / 2).scale(-1, 1, 1);
    bell.computeVertexNormals();
    const throat = new THREE.CircleGeometry(0.034, 24);
    for (const x of [-0.39, -0.13, 0.13, 0.39]) {
      add(ring, 'chrome', 'nozzle').position.set(x, 0.275, zBack + 0.004);
      add(bell, 'under', 'nozzle-bell').position.set(x, 0.275, zBack - 0.03);
      add(throat, 'glow', 'nozzle-throat').position.set(x, 0.275, zBack - 0.06);
    }
  },
};
