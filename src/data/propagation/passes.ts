import { Observer, Pass, PassQuality, TleRecord, TrackPoint } from '../../types/satellite';
import { buildSatrec, getLookAnglesFromSatrec, getSatellitePositionFromSatrec } from './propagate';

type Satrec = ReturnType<typeof buildSatrec>;

const COARSE_STEP_MS = 30_000;
const REFINE_TOLERANCE_MS = 1_000;
const MAX_LOOKBACK_STEPS = 60; // 30 minutes: longer than any LEO pass
const MAX_OVERRUN_MS = 60 * 60_000;
const EARTH_RADIUS_KM = 6371;

function elevationAt(satrec: Satrec, observer: Observer, timeMs: number): number {
  const angles = getLookAnglesFromSatrec(satrec, observer, new Date(timeMs));
  // A failed propagation (decayed or bad element set) counts as "below the horizon".
  return angles ? angles.elevationDeg : -90;
}

/**
 * Narrows the instant where the satellite crosses the horizon. `visibleMs` must be above the
 * horizon and `hiddenMs` below it (in either order). Returns the visible side of the crossing,
 * accurate to REFINE_TOLERANCE_MS.
 */
function refineHorizonCrossing(satrec: Satrec, observer: Observer, visibleMs: number, hiddenMs: number): number {
  let visible = visibleMs;
  let hidden = hiddenMs;
  while (Math.abs(visible - hidden) > REFINE_TOLERANCE_MS) {
    const mid = Math.round((visible + hidden) / 2);
    if (elevationAt(satrec, observer, mid) > 0) visible = mid;
    else hidden = mid;
  }
  return visible;
}

/** Golden-section search for the time of maximum elevation inside a pass. */
function findPeak(satrec: Satrec, observer: Observer, startMs: number, endMs: number): { timeMs: number; elevationDeg: number } {
  const invPhi = (Math.sqrt(5) - 1) / 2;
  let lo = startMs;
  let hi = endMs;
  let a = Math.round(hi - invPhi * (hi - lo));
  let b = Math.round(lo + invPhi * (hi - lo));
  let fa = elevationAt(satrec, observer, a);
  let fb = elevationAt(satrec, observer, b);

  while (hi - lo > 2 * REFINE_TOLERANCE_MS) {
    if (fa < fb) {
      lo = a;
      a = b;
      fa = fb;
      b = Math.round(lo + invPhi * (hi - lo));
      fb = elevationAt(satrec, observer, b);
    } else {
      hi = b;
      b = a;
      fb = fa;
      a = Math.round(hi - invPhi * (hi - lo));
      fa = elevationAt(satrec, observer, a);
    }
  }

  const timeMs = Math.round((lo + hi) / 2);
  return { timeMs, elevationDeg: elevationAt(satrec, observer, timeMs) };
}

function azimuthAt(satrec: Satrec, observer: Observer, timeMs: number): number {
  const angles = getLookAnglesFromSatrec(satrec, observer, new Date(timeMs));
  return angles ? angles.azimuthDeg : 0;
}

function buildPass(
  noradId: string,
  satrec: Satrec,
  observer: Observer,
  riseMs: number,
  setMs: number
): Pass {
  const peak = findPeak(satrec, observer, riseMs, setMs);
  return {
    noradId,
    riseTime: new Date(riseMs),
    setTime: new Date(setMs),
    maxElevationTime: new Date(peak.timeMs),
    maxElevationDeg: peak.elevationDeg,
    riseAzimuthDeg: azimuthAt(satrec, observer, riseMs),
    maxAzimuthDeg: azimuthAt(satrec, observer, peak.timeMs),
    setAzimuthDeg: azimuthAt(satrec, observer, setMs),
    durationSec: Math.round((setMs - riseMs) / 1000),
  };
}

export interface PredictOptions {
  /** Passes whose peak stays below this elevation are dropped. Default 0 (everything above the horizon). */
  minElevationDeg?: number;
}

/**
 * Finds every pass between `from` and `to`. A pass already underway at `from` is included with its
 * true (past) rise time, so "in progress" passes are never silently lost.
 */
export function predictPasses(
  tle: TleRecord,
  observer: Observer,
  from: Date,
  to: Date,
  options: PredictOptions = {}
): Pass[] {
  const satrec = buildSatrec(tle);
  const minElevation = options.minElevationDeg ?? 0;
  const startMs = from.getTime();
  const endMs = to.getTime();
  const passes: Pass[] = [];

  let riseMs: number | null = null;
  let previousMs = startMs;
  let previousElevation = elevationAt(satrec, observer, startMs);

  if (previousElevation > 0) {
    riseMs = startMs;
    let visible = startMs;
    for (let i = 0; i < MAX_LOOKBACK_STEPS; i += 1) {
      const earlier = visible - COARSE_STEP_MS;
      if (elevationAt(satrec, observer, earlier) <= 0) {
        riseMs = refineHorizonCrossing(satrec, observer, visible, earlier);
        break;
      }
      visible = earlier;
    }
  }

  for (let t = startMs + COARSE_STEP_MS; t <= endMs || (riseMs !== null && t <= endMs + MAX_OVERRUN_MS); t += COARSE_STEP_MS) {
    const elevation = elevationAt(satrec, observer, t);

    if (previousElevation <= 0 && elevation > 0) {
      riseMs = refineHorizonCrossing(satrec, observer, t, previousMs);
    } else if (previousElevation > 0 && elevation <= 0 && riseMs !== null) {
      const setMs = refineHorizonCrossing(satrec, observer, previousMs, t);
      const pass = buildPass(tle.noradId, satrec, observer, riseMs, setMs);
      if (pass.maxElevationDeg >= minElevation) passes.push(pass);
      riseMs = null;
    }

    previousMs = t;
    previousElevation = elevation;
  }

  return passes;
}

/** Satellite positions and look angles every `stepSec` between two instants (inclusive of both ends). */
export function sampleTrack(
  tle: TleRecord,
  observer: Observer,
  from: Date,
  to: Date,
  stepSec = 10
): TrackPoint[] {
  const satrec = buildSatrec(tle);
  const points: TrackPoint[] = [];
  const stepMs = stepSec * 1000;
  const startMs = from.getTime();
  const endMs = to.getTime();

  for (let t = startMs; t < endMs + stepMs; t += stepMs) {
    const time = new Date(Math.min(t, endMs));
    const position = getSatellitePositionFromSatrec(satrec, time);
    const look = getLookAnglesFromSatrec(satrec, observer, time);
    if (position && look) points.push({ time, ...position, ...look });
    if (t >= endMs) break;
  }
  return points;
}

/** Sub-satellite positions only (cheap): used for the longer ground track drawn on the map. */
export function sampleGroundTrack(tle: TleRecord, from: Date, to: Date, stepSec = 30) {
  const satrec = buildSatrec(tle);
  const points: { time: Date; latitudeDeg: number; longitudeDeg: number; altitudeKm: number }[] = [];
  const stepMs = stepSec * 1000;
  for (let t = from.getTime(); t <= to.getTime(); t += stepMs) {
    const time = new Date(t);
    const position = getSatellitePositionFromSatrec(satrec, time);
    if (position) points.push({ time, ...position });
  }
  return points;
}

export function getCurrentTrackPoint(tle: TleRecord, observer: Observer, at: Date): TrackPoint | null {
  const satrec = buildSatrec(tle);
  const position = getSatellitePositionFromSatrec(satrec, at);
  const look = getLookAnglesFromSatrec(satrec, observer, at);
  return position && look ? { time: at, ...position, ...look } : null;
}

/** Half-angle (degrees of arc on the ground) of the area from which the satellite is above `minElevationDeg`. */
export function footprintRadiusDeg(altitudeKm: number, minElevationDeg = 0): number {
  const elevation = (minElevationDeg * Math.PI) / 180;
  const centralAngle =
    Math.acos((EARTH_RADIUS_KM * Math.cos(elevation)) / (EARTH_RADIUS_KM + altitudeKm)) - elevation;
  return (centralAngle * 180) / Math.PI;
}

export function destinationPoint(
  latitudeDeg: number,
  longitudeDeg: number,
  bearingDeg: number,
  distanceDeg: number
): { latitudeDeg: number; longitudeDeg: number } {
  const toRad = Math.PI / 180;
  const lat1 = latitudeDeg * toRad;
  const lon1 = longitudeDeg * toRad;
  const bearing = bearingDeg * toRad;
  const d = distanceDeg * toRad;

  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing));
  const lon2 =
    lon1 +
    Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));

  return { latitudeDeg: lat2 / toRad, longitudeDeg: lon2 / toRad };
}

/**
 * Outline of the visibility circle. Longitudes are unwrapped relative to the centre (they may fall
 * outside +-180) so the polygon never jumps across the antimeridian.
 */
export function footprintPolygon(
  latitudeDeg: number,
  longitudeDeg: number,
  radiusDeg: number,
  points = 72
): { latitudeDeg: number; longitudeDeg: number }[] {
  const outline: { latitudeDeg: number; longitudeDeg: number }[] = [];
  for (let i = 0; i < points; i += 1) {
    const point = destinationPoint(latitudeDeg, longitudeDeg, (360 * i) / points, radiusDeg);
    let lon = point.longitudeDeg;
    while (lon - longitudeDeg > 180) lon -= 360;
    while (lon - longitudeDeg < -180) lon += 360;
    outline.push({ latitudeDeg: Math.max(-90, Math.min(90, point.latitudeDeg)), longitudeDeg: lon });
  }
  return outline;
}

/** Unwraps a ground track so consecutive longitudes never jump by more than 180 degrees. */
export function unwrapLongitudes(longitudesDeg: number[]): number[] {
  const out: number[] = [];
  let offset = 0;
  for (let i = 0; i < longitudesDeg.length; i += 1) {
    if (i > 0) {
      const delta = longitudesDeg[i] - longitudesDeg[i - 1];
      if (delta > 180) offset -= 360;
      else if (delta < -180) offset += 360;
    }
    out.push(longitudesDeg[i] + offset);
  }
  return out;
}

export function classifyPass(maxElevationDeg: number): PassQuality {
  if (maxElevationDeg >= 50) return 'excellent';
  if (maxElevationDeg >= 30) return 'good';
  if (maxElevationDeg >= 15) return 'fair';
  return 'low';
}

export const PASS_QUALITY_LABEL: Record<PassQuality, string> = {
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  low: 'Low',
};
