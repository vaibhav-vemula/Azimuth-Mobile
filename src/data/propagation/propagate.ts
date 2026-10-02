// src/data/propagation/propagate.ts
import * as satellite from 'satellite.js';
import { TleRecord, GeodeticPosition, LookAngles } from '../../types/satellite';

interface Observer {
  latitudeDeg: number;
  longitudeDeg: number;
  heightKm: number;
}

type Satrec = ReturnType<typeof satellite.twoline2satrec>;

function toSatrec(tle: TleRecord): Satrec {
  return satellite.twoline2satrec(tle.line1, tle.line2);
}

// Exposed so hot loops (e.g. predictPasses) can build the satrec once and
// reuse it across many propagation calls instead of re-parsing the TLE on
// every sample.
export function buildSatrec(tle: TleRecord): Satrec {
  return toSatrec(tle);
}

export function getSatellitePosition(tle: TleRecord, at: Date): GeodeticPosition | null {
  return getSatellitePositionFromSatrec(toSatrec(tle), at);
}

export function getSatellitePositionFromSatrec(satrec: Satrec, at: Date): GeodeticPosition | null {
  const result = satellite.propagate(satrec, at);
  // satellite.propagate returns { position: false, velocity: false } (not
  // null/undefined) when sgp4 fails for a given TLE/time pair - a routine
  // occurrence for decayed or otherwise bad TLEs in real CelesTrak data.
  if (!result || !result.position) {
    return null;
  }

  const gmst = satellite.gstime(at);
  const positionGd = satellite.eciToGeodetic(result.position, gmst);

  return {
    latitudeDeg: satellite.degreesLat(positionGd.latitude),
    longitudeDeg: satellite.degreesLong(positionGd.longitude),
    altitudeKm: positionGd.height,
  };
}

export function getLookAngles(tle: TleRecord, observer: Observer, at: Date): LookAngles | null {
  return getLookAnglesFromSatrec(toSatrec(tle), observer, at);
}

export function getLookAnglesFromSatrec(satrec: Satrec, observer: Observer, at: Date): LookAngles | null {
  const result = satellite.propagate(satrec, at);
  if (!result || !result.position) {
    return null;
  }

  const gmst = satellite.gstime(at);
  const observerGd = {
    latitude: satellite.degreesToRadians(observer.latitudeDeg),
    longitude: satellite.degreesToRadians(observer.longitudeDeg),
    height: observer.heightKm,
  };
  const positionEcf = satellite.eciToEcf(result.position, gmst);
  const lookAngles = satellite.ecfToLookAngles(observerGd, positionEcf);

  const azimuthDeg = (satellite.radiansToDegrees(lookAngles.azimuth) + 360) % 360;

  return {
    azimuthDeg,
    // Use radiansToDegrees (not degreesLat, which throws outside +-90deg)
    // for consistency with the azimuth conversion above - elevation's
    // asin-derived range can't exceed +-90deg so this is also just safer
    // against any future change to the upstream library's range checks.
    elevationDeg: satellite.radiansToDegrees(lookAngles.elevation),
    rangeKm: lookAngles.rangeSat,
  };
}
