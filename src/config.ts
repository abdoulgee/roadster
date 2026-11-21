// All gameplay tuning lives here so balancing never means hunting through systems.

export const LANES = 4;
export const LANE_WIDTH = 3.6;
export const SHOULDER = 1.6;
export const ROAD_HALF = (LANES * LANE_WIDTH) / 2 + SHOULDER;
export const START_LANE = 1;

export const laneX = (lane: number) => (lane - (LANES - 1) / 2) * LANE_WIDTH;

// Player cruise speed (m/s) by distance travelled (m), linearly interpolated.
export const SPEED_CURVE: readonly (readonly [number, number])[] = [
  [0, 28],
  [1000, 35],
  [3000, 46],
  [6000, 56],
  [10000, 65],
  [20000, 77],
  [30000, 86],
  [40000, 94],
  [50000, 100],
];

export const PHYS = {
  gravity: 25,
  jumpHeight: 3.2,
  maxHeight: 6.2,
  holdDelay: 0.12, // hold jump this long before hovering kicks in
  laneShiftTime: 0.21,
  laneShiftTimeNoAir: 0.3,
  airLaneShiftTime: 0.24,
  trickTime: 0.55,
  flipTime: 0.5,
  flipMinLift: 2.5,
  flipGravity: 0.55,
  slamSpeed: -22,
  trickLandGrace: 0.7, // landing past this fraction of a trick still counts it
};

export const AIR = {
  capacity: 600,
  groundRefillPerSec: 30,
  laneShift: 3,
  airLaneShift: 15,
  jump: 20,
  hoverPerSec: 120,
  flip: 40,
  flipMin: 20,
  slam: 20,
  boostPerSec: 40,
  flipReward: 10,
  rollReward: 40,
  lowRatio: 0.2,
};

export const BOOST = { mult: 1.4 };

// Skills (tricks, clears, near misses, stunt landings) chain into a streak. Each skill raises the
// multiplier by one; the window refills on every skill and is frozen while airborne.
export const COMBO = {
  window: 2.2,
  maxMult: 50,
};

export const POINTS = {
  perMeter: 1,
  nearMiss: 10,
  cleared: 20,
  clearedBig: 50,
  trick: 20,
  stuntLanding: 10,
  nearMissClearance: 0.8, // metres of side gap that still counts as a near miss
};

export const TRAFFIC = {
  speedRatio: 0.38, // traffic cruises at this fraction of the player's base speed
  spawnZ: -300,
  firstRowZ: -45,
  despawnZ: 30,
  minLaneGap: 7,
  difficultyDistance: 6000, // metres until traffic reaches full density
  rowTimeEasy: 1.5,
  rowTimeHard: 0.7,
  minRowGap: 14,
  emptyRowEasy: 0.45,
  emptyRowHard: 0.08,
};

export type ItemKind = 'airCan' | 'overpressure' | 'shield' | 'shockwave' | 'ludicrous';

export const PICKUPS = {
  orbAir: 15,
  orbPoints: 5,
  orbSpacing: 4.5,
  orbLineGap: [60, 130] as const, // metres between orb lines
  orbArcChance: 0.35,
  itemGap: [320, 560] as const,
  // Air can, overpressure and shield apply on pickup; shockwave and ludicrous wait in the item slot.
  itemWeights: { airCan: 30, overpressure: 10, shield: 25, shockwave: 20, ludicrous: 15 } as Record<ItemKind, number>,
  starFirst: 1500,
  starGap: [2500, 3500] as const,
  airCan: 150,
};

// How much each action charges the rocket meter (1 = full). It auto-launches when full.
export const ROCKET_FILL = { trick: 0.03, nearMiss: 0.05, cleared: 0.04, orb: 0.015, airCan: 0.15 };

export type PowerKind = 'starman' | 'rocket' | 'ludicrous';

export const POWERS: Record<PowerKind, { duration: number; speedMult: number; scoreMult: number }> = {
  starman: { duration: 8, speedMult: 1.6, scoreMult: 2 },
  rocket: { duration: 6, speedMult: 1.5, scoreMult: 3 },
  ludicrous: { duration: 5, speedMult: 1.85, scoreMult: 2 },
};

export const POWER_GRACE = 1; // invincible seconds after a power or a shield hit ends
export const BOOST_DURING_POWER = 1.15;
export const SMASH_POINTS = 50;
export const SHOCKWAVE = { reach: 75, points: 20 };

// Zone-independent colours; per-zone lighting lives in world/zones.ts.
export const PALETTE = {
  palmLeaf: 0x34502f,
  palmTrunk: 0x6b4a32,
};

export const SUN_DIR: readonly [number, number, number] = [-0.35, 0.13, -1];

export const STORAGE_KEY = 'drive-roadster:v1';
export const SETTINGS_KEY = 'drive-roadster:settings:v1';
