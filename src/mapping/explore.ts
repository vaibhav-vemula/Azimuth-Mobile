import { LatLon, cellId, distanceM, hexAt, hexCenter, hexDisk } from './hexGrid';

/**
 * The fog uses a finer grid than the reporting cells: a 5 m (projected) hex is about 4 m across on the ground at
 * Washington, DC, so cleared ground follows your path closely instead of in blocks.
 */
export const FOG_CELL_M = 5;
/** Ground you can "see" around you. Walking anywhere clears a bubble this wide, and the bubble stays cleared. */
export const VISION_RADIUS_M = 60;
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

/** Ground area covered by `cells` fog cells at a latitude, in square kilometres. */
export function exploredAreaKm2(cells: number, latitudeDeg: number, sizeM = FOG_CELL_M): number {
  const side = sizeM * Math.cos(toRad(latitudeDeg));
  return (cells * 2.598 * side * side) / 1e6;
}

export function formatArea(km2: number): string {
  if (km2 < 0.01) return `${Math.round(km2 * 1e6).toLocaleString('en-US')} m²`;
  if (km2 < 10) return `${km2.toFixed(2)} km²`;
  return `${Math.round(km2).toLocaleString('en-US')} km²`;
}
