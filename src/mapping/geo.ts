import { LatLon, distanceM } from './hexGrid';

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Compass bearing from one point to another, in degrees clockwise from north (0 to 360). */
export function bearingDeg(from: LatLon, to: LatLon): number {
  const f1 = toRad(from.latitudeDeg);
  const f2 = toRad(to.latitudeDeg);
  const dl = toRad(to.longitudeDeg - from.longitudeDeg);
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * How far to rotate an arrow so it points at the target when the phone faces `headingDeg`. Positive is clockwise.
 * Result is in (-180, 180]. With no heading (compass unavailable) the arrow points relative to north.
 */
export function arrowRotationDeg(bearing: number, headingDeg: number | null): number {
  const diff = (bearing - (headingDeg ?? 0) + 540) % 360 - 180;
  return diff === -180 ? 180 : diff;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function compassPoint(bearing: number): string {
  return COMPASS[Math.round(((bearing % 360) + 360) % 360 / 45) % 8];
}

/** "120 m", "1.4 km". */
export function formatDistanceShort(m: number): string {
  if (!Number.isFinite(m)) return '—';
  if (m < 1000) return `${Math.max(5, Math.round(m / 5) * 5)} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

export interface Located<T> {
  item: T;
  position: LatLon;
}

export interface Nearest<T> {
  item: T;
  distanceM: number;
  bearingDeg: number;
}

/** The closest of several things to a point, with distance and bearing; null if there are none. */
export function nearestOf<T>(from: LatLon, candidates: Located<T>[]): Nearest<T> | null {
  let best: Nearest<T> | null = null;
  for (const c of candidates) {
    const d = distanceM(from, c.position);
    if (!best || d < best.distanceM) best = { item: c.item, distanceM: d, bearingDeg: bearingDeg(from, c.position) };
  }
  return best;
}
