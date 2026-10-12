import { LatLon, cellId, distanceM, hexAt, hexCenter, hexDisk } from './hexGrid';
import { areaParts, formatQuantity } from '../units/units';

/**
 * The fog uses a finer grid than the reporting cells: a 5 m (projected) hex is about 4 m across on the ground at
 * Washington, DC, so cleared ground follows your path closely instead of in blocks.
 */
export const FOG_CELL_M = 5;
/** Ground you can "see" around you. Walking anywhere clears a bubble this wide, and the bubble stays cleared. */
export const VISION_RADIUS_M = 150;
/** Fixes less accurate than this are ignored, so a poor GPS reading cannot clear a distant street. */
export const MAX_REVEAL_ACCURACY_M = 40;

const toRad = (d: number) => (d * Math.PI) / 180;

/** Ids of the fog cells whose centres lie within `radiusM` of a point. */
export function cellsWithin(center: LatLon, radiusM = VISION_RADIUS_M, sizeM = FOG_CELL_M): string[] {
  const hex = hexAt(center, sizeM);
  // Ground distance between neighbouring cell centres at this latitude.
  const step = Math.sqrt(3) * sizeM * Math.cos(toRad(center.latitudeDeg));
  const rings = Math.ceil(radiusM / Math.max(step, 1)) + 1;
  const out: string[] = [];
  for (const h of hexDisk(hex, rings)) {
    if (distanceM(center, hexCenter(h, sizeM)) <= radiusM) out.push(cellId(h, sizeM));
  }
  return out;
}

/** Fixes further apart than this are not joined by a line: a gap that long is a signal loss, not a drive. */
export const MAX_JOIN_M = 2000;
/** Fixes further apart in time than this are not joined either. */
export const MAX_JOIN_S = 120;
/** Along a joined line, the fog is cleared at points this far apart (well under the vision radius, so the line comes out solid). */
export const JOIN_SPACING_M = 20;

/**
 * The places between two fixes at which to clear the fog, so that driving clears one continuous road and not a string of
 * separate circles. Returns points spaced `spacingM` apart along the straight line from `a` to `b`, ending at `b` (`a` itself
 * is left out: the caller has already cleared it). Nothing is returned for a join that is too long to be real driving.
 */
export function pointsAlong(a: LatLon, b: LatLon, seconds: number, spacingM = JOIN_SPACING_M): LatLon[] {
  const gap = distanceM(a, b);
  if (!Number.isFinite(gap) || gap <= spacingM) return [];
  if (gap > MAX_JOIN_M || !(seconds >= 0) || seconds > MAX_JOIN_S) return [];
  const n = Math.ceil(gap / spacingM);
  const out: LatLon[] = [];
  for (let i = 1; i <= n; i += 1) {
    const t = i / n;
    out.push({ latitudeDeg: a.latitudeDeg + (b.latitudeDeg - a.latitudeDeg) * t, longitudeDeg: a.longitudeDeg + (b.longitudeDeg - a.longitudeDeg) * t });
  }
  return out;
}

/** Ground area covered by `cells` fog cells at a latitude, in square kilometres. */
export function exploredAreaKm2(cells: number, latitudeDeg: number, sizeM = FOG_CELL_M): number {
  const side = sizeM * Math.cos(toRad(latitudeDeg));
  return (cells * 2.598 * side * side) / 1e6;
}

export function formatArea(km2: number): string {
  return formatQuantity(areaParts(km2));
}
