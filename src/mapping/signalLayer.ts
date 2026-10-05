import type { MappedScan } from './aggregate';
import { hexCenter, parseCellId } from './hexGrid';
import { levelDbfs } from './radio';

/**
 * The signal map is drawn on its own grid of 20 m (projected) hexagons, about 16 m across on the ground at Washington,
 * DC: fine enough to show how signal changes as you walk, and coarser than the 5 m fog cells. It is separate from the
 * 120 m cells used in reports, and it never leaves the phone.
 */
export const SIGNAL_CELL_M = 20;

/** What the map can tint your explored ground by. */
export type SignalLayer = 'off' | 'cellular' | 'wifi' | 'bluetooth' | 'radio';

/**
 * A running summary of what the phone measured in one reporting cell. Sums and counts, so new readings fold in
 * without keeping each one. Stays on the phone; it is the local copy behind the signal map.
 */
export interface CellSignal {
  /** Readings in this cell. */
  n: number;
  /** Sum of the strongest cellular signal (dBm) over readings that saw a cell, and how many saw one. */
  cs: number;
  cn: number;
  /** Readings with no cellular signal at all. */
  dz: number;
  /** Wi-Fi networks seen: sum over readings, and number of readings. */
  ws: number;
  wn: number;
  /** Bluetooth devices seen: sum and number of readings. */
  bs: number;
  bn: number;
  /** Dongle readings: how many, how many heard a Meteor satellite, and the sum of their overall radio level (dB below full scale). */
  rn?: number;
  rc?: number;
  rs?: number;
  /** Last updated (epoch ms). */
  t: number;
}

export function addReading(prev: CellSignal | undefined, scan: MappedScan, now: number): CellSignal {
  const s: CellSignal = prev ? { ...prev } : { n: 0, cs: 0, cn: 0, dz: 0, ws: 0, wn: 0, bs: 0, bn: 0, t: now };
  s.n += 1;
  s.t = now;
  if (scan.cellular.available) {
    if (scan.cellular.cells.length > 0) {
      s.cs += Math.max(...scan.cellular.cells.map((c) => c.dbm));
      s.cn += 1;
    } else {
      s.dz += 1;
    }
  }
  if (scan.wifi.available && typeof scan.wifi.count === 'number') {
    s.ws += scan.wifi.count;
    s.wn += 1;
  }
  if (scan.bluetooth?.available && typeof scan.bluetooth.count === 'number') {
    s.bs += scan.bluetooth.count;
    s.bn += 1;
  }
  if (scan.radio) {
    s.rn = (s.rn ?? 0) + 1;
    s.rc = (s.rc ?? 0) + (scan.radio.carrier ? 1 : 0);
    s.rs = (s.rs ?? 0) + levelDbfs(scan.radio.rms);
  }
  return s;
}

/** Cellular strength that counts as the bottom and top of the scale, in dBm. */
export const CELLULAR_RANGE = { weak: -120, strong: -75 } as const;
/** Networks or devices at which the density colour is at its maximum. */
export const WIFI_FULL = 25;
export const BLUETOOTH_FULL = 30;
/** Overall radio level, in dB below full scale at the fixed gain, at the bottom and top of the colour scale. */
export const RADIO_RANGE_DBFS = { weak: -45, strong: -20 } as const;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Where this cell sits on the scale, 0 to 1, or null if this layer has no data for it. */
export function level(layer: SignalLayer, s: CellSignal): number | null {
  if (layer === 'cellular') {
    if (s.cn > 0) return clamp01((s.cs / s.cn - CELLULAR_RANGE.weak) / (CELLULAR_RANGE.strong - CELLULAR_RANGE.weak));
    return s.dz > 0 ? 0 : null; // no signal at all: the bottom of the scale
  }
  if (layer === 'wifi') return s.wn > 0 ? clamp01(s.ws / s.wn / WIFI_FULL) : null;
  if (layer === 'bluetooth') return s.bn > 0 ? clamp01(s.bs / s.bn / BLUETOOTH_FULL) : null;
  if (layer === 'radio') return s.rn ? clamp01(((s.rs ?? 0) / s.rn - RADIO_RANGE_DBFS.weak) / (RADIO_RANGE_DBFS.strong - RADIO_RANGE_DBFS.weak)) : null;
  return null;
}

export type Rgb = [number, number, number];
type Stop = [number, Rgb];

/** Cellular: red is a dead zone, green is strong. Density layers run from deep blue to a hot colour. */
const RAMPS: Record<Exclude<SignalLayer, 'off'>, Stop[]> = {
  cellular: [
    [0, [255, 77, 109]],
    [0.35, [255, 176, 32]],
    [0.65, [61, 220, 132]],
    [1, [46, 230, 197]],
  ],
  wifi: [
    [0, [43, 70, 150]],
    [0.5, [120, 92, 230]],
    [1, [214, 120, 255]],
  ],
  bluetooth: [
    [0, [43, 70, 150]],
    [0.5, [90, 150, 240]],
    [1, [255, 128, 171]],
  ],
  // Radio: dark where little radio energy was measured, then cyan to bright yellow where there is a lot.
  radio: [
    [0, [38, 58, 110]],
    [0.4, [41, 182, 246]],
    [0.75, [105, 240, 174]],
    [1, [255, 235, 59]],
  ],
};

export function rampColour(layer: Exclude<SignalLayer, 'off'>, v: number): Rgb {
  const stops = RAMPS[layer];
  const x = clamp01(v);
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [p0, c0] = stops[i - 1];
      const [p1, c1] = stops[i];
      const t = (x - p0) / (p1 - p0);
      return [0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * t)) as Rgb;
    }
  }
  return stops[stops.length - 1][1];
}

export const toHex = (c: Rgb) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

export interface Legend {
  title: string;
  low: string;
  high: string;
  lowLabel: string;
  highLabel: string;
}

export function legendFor(layer: Exclude<SignalLayer, 'off'>): Legend {
  const ends = (l: Exclude<SignalLayer, 'off'>) => ({ low: toHex(rampColour(l, 0)), high: toHex(rampColour(l, 1)) });
  if (layer === 'cellular') return { title: 'Cellular signal', ...ends(layer), lowLabel: 'No signal', highLabel: 'Strong' };
  if (layer === 'wifi') return { title: 'Wi-Fi networks nearby', ...ends(layer), lowLabel: 'Few', highLabel: 'Many' };
  if (layer === 'radio') return { title: 'Radio signal strength', ...ends(layer), lowLabel: 'Quiet', highLabel: 'Strong' };
  return { title: 'Bluetooth devices nearby', ...ends(layer), lowLabel: 'Few', highLabel: 'Many' };
}

/** How far a reading's glow spreads, in metres. Wider than a signal cell, so readings along a walk blend into one band. */
export const HEAT_RADIUS_M = 32;

/**
 * One point per measured spot, coloured by the chosen layer. The map draws each as a soft glowing blob, so a walk
 * becomes a smooth heat trail rather than a row of tiles. Spots without data are left out.
 */
export function signalPoints(signals: Record<string, CellSignal>, layer: SignalLayer): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
  if (layer !== 'off') {
    for (const [id, s] of Object.entries(signals)) {
      const parsed = parseCellId(id);
      const v = level(layer, s);
      if (!parsed || v === null) continue;
      const c = hexCenter(parsed.hex, parsed.sizeM);
      features.push({
        type: 'Feature',
        properties: { color: toHex(rampColour(layer, v)), level: Math.round(v * 100) / 100 },
        geometry: { type: 'Point', coordinates: [c.longitudeDeg, c.latitudeDeg] },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

/** Ground metres covered by one screen point at a zoom level (512 px tiles) and latitude. */
export function metresPerPoint(zoom: number, latitudeDeg: number): number {
  return (40075016.686 * Math.cos((latitudeDeg * Math.PI) / 180)) / (512 * 2 ** zoom);
}

/**
 * A circle radius that stays `metres` wide on the ground as you zoom. Radius in points doubles with each zoom level,
 * which is what an exponential interpolation with base 2 does.
 */
export function radiusForMetres(metres: number, latitudeDeg: number): unknown[] {
  const lo = 10;
  const hi = 21;
  return ['interpolate', ['exponential', 2], ['zoom'], lo, metres / metresPerPoint(lo, latitudeDeg), hi, metres / metresPerPoint(hi, latitudeDeg)];
}

/** A circle as a closed line of points, `radiusM` around a place. */
export function circleRing(centre: { latitudeDeg: number; longitudeDeg: number }, radiusM: number, points = 72): [number, number][] {
  const k = Math.cos((centre.latitudeDeg * Math.PI) / 180);
  const ring: [number, number][] = [];
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * 2 * Math.PI;
    ring.push([centre.longitudeDeg + (radiusM * Math.sin(a)) / (111320 * k), centre.latitudeDeg + (radiusM * Math.cos(a)) / 111320]);
  }
  return ring;
}
