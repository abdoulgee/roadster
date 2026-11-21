import type { CarDesign } from './carModel';

// The paint shop: body colours and wheel finishes that unlock as the pilot racks up distance.

export interface PaintFinish {
  color: number;
  metalness: number;
  roughness: number;
  clearcoat: number;
  clearcoatRoughness?: number;
  anisotropy?: number;
}

export interface WheelFinish {
  rim: number;
  /** The dish behind the spokes on covered wheels. */
  cover: number;
  metalness: number;
  roughness: number;
}

interface Item<T> {
  id: string;
  name: string;
  /** Lifetime distance (km) that unlocks it. */
  km: number;
  /** null means the car's own factory finish. */
  finish: T | null;
  /** CSS colour for the swatch. */
  swatch: string;
}

export type PaintItem = Item<PaintFinish>;
export type WheelItem = Item<WheelFinish>;

export const PAINTS: readonly PaintItem[] = [
  { id: 'factory', name: 'Factory', km: 0, finish: null, swatch: '' },
  { id: 'midnight', name: 'Midnight Black', km: 0, swatch: '#101116', finish: { color: 0x0b0c10, metalness: 0.4, roughness: 0.3, clearcoat: 1 } },
  { id: 'pearl', name: 'Pearl White', km: 0, swatch: '#f1f0eb', finish: { color: 0xf2f1ec, metalness: 0.15, roughness: 0.3, clearcoat: 1 } },
  { id: 'red', name: 'Racing Red', km: 1, swatch: '#b3121d', finish: { color: 0xb3121d, metalness: 0.35, roughness: 0.35, clearcoat: 1 } },
  { id: 'blue', name: 'Deep Blue', km: 3, swatch: '#1a3f92', finish: { color: 0x123a8a, metalness: 0.55, roughness: 0.32, clearcoat: 1 } },
  { id: 'silver', name: 'Quicksilver', km: 6, swatch: '#b9bdc3', finish: { color: 0xb9bdc3, metalness: 0.85, roughness: 0.28, clearcoat: 1 } },
  { id: 'lime', name: 'Lime Volt', km: 10, swatch: '#7bd13a', finish: { color: 0x6cc22c, metalness: 0.4, roughness: 0.35, clearcoat: 1 } },
  { id: 'orange', name: 'Sunset Orange', km: 15, swatch: '#f06a1c', finish: { color: 0xf06a1c, metalness: 0.45, roughness: 0.33, clearcoat: 1 } },
  { id: 'violet', name: 'Ultra Violet', km: 25, swatch: '#6a35b8', finish: { color: 0x5a2a9e, metalness: 0.6, roughness: 0.3, clearcoat: 1 } },
  { id: 'stealth', name: 'Matte Stealth', km: 35, swatch: '#2c2e33', finish: { color: 0x2a2c30, metalness: 0.2, roughness: 0.72, clearcoat: 0 } },
  { id: 'gold', name: 'Liquid Gold', km: 50, swatch: '#c9a14a', finish: { color: 0xc9a14a, metalness: 1, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 } },
  { id: 'chrome', name: 'Mirror Chrome', km: 80, swatch: '#e6e8ec', finish: { color: 0xe2e5ea, metalness: 1, roughness: 0.08, clearcoat: 0 } },
];

export const WHEELS: readonly WheelItem[] = [
  { id: 'factory', name: 'Factory', km: 0, finish: null, swatch: '' },
  { id: 'black', name: 'Gloss Black', km: 0, swatch: '#141518', finish: { rim: 0x111214, cover: 0x1a1b1e, metalness: 0.6, roughness: 0.3 } },
  { id: 'silver', name: 'Silver', km: 2, swatch: '#c3c6cc', finish: { rim: 0xc3c6cc, cover: 0xa6aab0, metalness: 1, roughness: 0.25 } },
  { id: 'gunmetal', name: 'Gunmetal', km: 5, swatch: '#4a4e55', finish: { rim: 0x4a4e55, cover: 0x3a3d43, metalness: 0.9, roughness: 0.35 } },
  { id: 'bronze', name: 'Bronze', km: 12, swatch: '#8a6a3c', finish: { rim: 0x8a6a3c, cover: 0x6e5532, metalness: 1, roughness: 0.3 } },
  { id: 'red', name: 'Red', km: 20, swatch: '#b3121d', finish: { rim: 0xb3121d, cover: 0x8f0e17, metalness: 0.5, roughness: 0.3 } },
  { id: 'gold', name: 'Gold', km: 30, swatch: '#c9a14a', finish: { rim: 0xc9a14a, cover: 0xa8853a, metalness: 1, roughness: 0.22 } },
];

/** The design's own paint, used for the Factory swatch. */
export const factoryPaint = (d: CarDesign): PaintFinish => ({ ...d.paint });

export const factoryWheels = (d: CarDesign): WheelFinish => ({
  rim: d.wheels.rimColor,
  cover: d.wheels.coverColor ?? d.wheels.rimColor,
  metalness: 0.85,
  roughness: 0.3,
});

export const factorySwatch = (d: CarDesign, wheels = false) =>
  `#${(wheels ? d.wheels.rimColor : d.paint.color).toString(16).padStart(6, '0')}`;

export const paintItem = (id: string | undefined) => PAINTS.find((p) => p.id === id) ?? PAINTS[0];
export const wheelItem = (id: string | undefined) => WHEELS.find((w) => w.id === id) ?? WHEELS[0];
