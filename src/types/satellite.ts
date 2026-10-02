export interface TleRecord {
  noradId: string;
  name: string;
  line1: string;
  line2: string;
}

export interface Observer {
  latitudeDeg: number;
  longitudeDeg: number;
  heightKm: number;
}

export interface GeodeticPosition {
  latitudeDeg: number;
  longitudeDeg: number;
  altitudeKm: number;
}

export interface LookAngles {
  azimuthDeg: number;
  elevationDeg: number;
  rangeKm: number;
}

/** A satellite position sampled along a pass, seen from the observer. */
export interface TrackPoint extends GeodeticPosition, LookAngles {
  time: Date;
}

export interface Pass {
  noradId: string;
  /** Acquisition of signal: elevation crosses 0 degrees going up. */
  riseTime: Date;
  /** Loss of signal: elevation crosses 0 degrees going down. */
  setTime: Date;
  /** Time of closest approach (maximum elevation). */
  maxElevationTime: Date;
  maxElevationDeg: number;
  riseAzimuthDeg: number;
  maxAzimuthDeg: number;
  setAzimuthDeg: number;
  durationSec: number;
}

export type PassQuality = 'excellent' | 'good' | 'fair' | 'low';
