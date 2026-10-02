// src/data/propagation/propagate.test.ts
import { getSatellitePosition, getLookAngles } from './propagate';
import { TleRecord } from '../../types/satellite';

// Real ISS TLE, epoch 2024-01-01T12:00:00Z.
const ISS_TLE: TleRecord = {
  noradId: '25544',
  name: 'ISS (ZARYA)',
  line1: '1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9000',
  line2: '2 25544  51.6400 208.9163 0006317  69.9862  25.2906 15.49560000000000',
};

describe('getSatellitePosition', () => {
  it('returns a position near the ISS orbital inclination and altitude at epoch', () => {
    const at = new Date('2024-01-01T12:00:00Z');
    const position = getSatellitePosition(ISS_TLE, at);

    expect(position).not.toBeNull();
    expect(Math.abs(position!.latitudeDeg)).toBeLessThanOrEqual(51.7);
    expect(position!.altitudeKm).toBeGreaterThan(300);
    expect(position!.altitudeKm).toBeLessThan(500);
    expect(position!.longitudeDeg).toBeGreaterThanOrEqual(-180);
    expect(position!.longitudeDeg).toBeLessThanOrEqual(180);
  });

  it('moves over time (is not static)', () => {
    const t1 = new Date('2024-01-01T12:00:00Z');
    const t2 = new Date('2024-01-01T12:10:00Z');
    const p1 = getSatellitePosition(ISS_TLE, t1);
    const p2 = getSatellitePosition(ISS_TLE, t2);
    expect(p1).not.toBeNull();
    expect(p2).not.toBeNull();
    expect(p1!.longitudeDeg).not.toBeCloseTo(p2!.longitudeDeg, 2);
  });

  it('returns null instead of throwing when propagation fails (e.g. a decayed orbit)', () => {
    // Far enough past epoch that sgp4 reports a decayed/invalid orbit
    // (position: false) rather than a usable result.
    const at = new Date('2100-01-01T00:00:00Z');
    const position = getSatellitePosition(ISS_TLE, at);
    expect(position).toBeNull();
  });
});

describe('getLookAngles', () => {
  it('returns azimuth in [0,360), elevation in [-90,90], and a positive range', () => {
    const at = new Date('2024-01-01T12:00:00Z');
    const observer = { latitudeDeg: 40.7128, longitudeDeg: -74.006, heightKm: 0.01 };
    const angles = getLookAngles(ISS_TLE, observer, at);

    expect(angles).not.toBeNull();
    expect(angles!.azimuthDeg).toBeGreaterThanOrEqual(0);
    expect(angles!.azimuthDeg).toBeLessThan(360);
    expect(angles!.elevationDeg).toBeGreaterThanOrEqual(-90);
    expect(angles!.elevationDeg).toBeLessThanOrEqual(90);
    expect(angles!.rangeKm).toBeGreaterThan(0);
  });

  it('returns null instead of throwing when propagation fails (e.g. a decayed orbit)', () => {
    const at = new Date('2100-01-01T00:00:00Z');
    const observer = { latitudeDeg: 40.7128, longitudeDeg: -74.006, heightKm: 0.01 };
    const angles = getLookAngles(ISS_TLE, observer, at);
    expect(angles).toBeNull();
  });
});
