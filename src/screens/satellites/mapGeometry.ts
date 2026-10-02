import { unwrapLongitudes } from '../../data/propagation/passes';

export interface LatLon {
  latitudeDeg: number;
  longitudeDeg: number;
}

export interface Viewport {
  /** Left edge in longitude degrees (may be below -180 or above 180 after unwrapping). */
  x: number;
  /** Top edge in SVG space, which is minus latitude. */
  y: number;
  width: number;
  height: number;
}

/** Shifts a longitude by whole turns so it sits within 180 degrees of `reference`. */
export function nearLongitude(longitudeDeg: number, referenceDeg: number): number {
  let lon = longitudeDeg;
  while (lon - referenceDeg > 180) lon -= 360;
  while (lon - referenceDeg < -180) lon += 360;
  return lon;
}

/**
 * Brings a ground track into a continuous longitude frame near `referenceDeg`, so it can be drawn as one
 * polyline even when the satellite crosses the antimeridian.
 */
export function continuousTrack(points: LatLon[], referenceDeg: number): LatLon[] {
  if (points.length === 0) return [];
  const first = nearLongitude(points[0].longitudeDeg, referenceDeg);
  const unwrapped = unwrapLongitudes(points.map((p) => p.longitudeDeg));
  const offset = first - unwrapped[0];
  return points.map((p, i) => ({ latitudeDeg: p.latitudeDeg, longitudeDeg: unwrapped[i] + offset }));
}

/**
 * Chooses a map window (in lon / -lat space) that contains every point with some margin, keeps the
 * requested aspect ratio, and never zooms in further than `minWidthDeg`.
 */
export function fitViewport(
  points: LatLon[],
  aspect: number,
  options: { marginFactor?: number; minWidthDeg?: number } = {}
): Viewport {
  const marginFactor = options.marginFactor ?? 1.35;
  const minWidth = options.minWidthDeg ?? 40;
  if (points.length === 0) return { x: -180, y: -90 / aspect, width: 360, height: 360 / aspect };

  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const p of points) {
    minLon = Math.min(minLon, p.longitudeDeg);
    maxLon = Math.max(maxLon, p.longitudeDeg);
    minLat = Math.min(minLat, p.latitudeDeg);
    maxLat = Math.max(maxLat, p.latitudeDeg);
  }

  const spanLon = Math.max(maxLon - minLon, 1);
  const spanLat = Math.max(maxLat - minLat, 1);
  let width = Math.max(spanLon * marginFactor, spanLat * marginFactor * aspect, minWidth);
  width = Math.min(width, 360);
  const height = width / aspect;

  const centerLon = (minLon + maxLon) / 2;
  let centerLat = (minLat + maxLat) / 2;
  // Keep the window on the globe vertically where possible.
  centerLat = Math.max(-90 + height / 2, Math.min(90 - height / 2, centerLat));

  return { x: centerLon - width / 2, y: -centerLat - height / 2, width, height };
}

/** Graticule spacing that keeps roughly 4 to 8 lines in view. */
export function graticuleStep(widthDeg: number): number {
  if (widthDeg > 200) return 30;
  if (widthDeg > 90) return 15;
  if (widthDeg > 40) return 10;
  return 5;
}
