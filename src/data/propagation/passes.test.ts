import * as fs from 'fs';
import { getLookAngles } from './propagate';
import {
  classifyPass,
  destinationPoint,
  footprintPolygon,
  footprintRadiusDeg,
  getCurrentTrackPoint,
  predictPasses,
  sampleGroundTrack,
  sampleTrack,
  unwrapLongitudes,
} from './passes';
import { Observer, TleRecord } from '../../types/satellite';

// Real element set for METEOR-M2 4 (CelesTrak, epoch 2026-10-02).
const M2_4: TleRecord = {
  noradId: '59051',
  name: 'METEOR-M2 4',
  line1: '1 59051U 24039A   26275.31389677  .00000003  00000+0  20956-4 0  9992',
  line2: '2 59051  98.7159 233.3284 0006296 213.1613 146.9171 14.22438822134492',
};

const WASHINGTON: Observer = { latitudeDeg: 38.9072, longitudeDeg: -77.0369, heightKm: 0.05 };
const FROM = new Date('2026-10-02T14:00:00Z');
const TWO_DAYS = new Date(FROM.getTime() + 48 * 3600_000);

function elevation(at: Date): number {
  return getLookAngles(M2_4, WASHINGTON, at)!.elevationDeg;
}

function haversineDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return (2 * Math.asin(Math.sqrt(a))) / r;
}

describe('predictPasses', () => {
  const passes = predictPasses(M2_4, WASHINGTON, FROM, TWO_DAYS);

  it('finds a plausible number of passes for a polar LEO satellite in 48 hours', () => {
    expect(passes.length).toBeGreaterThanOrEqual(6);
    expect(passes.length).toBeLessThanOrEqual(24);
  });

  it('returns passes in chronological order with sane ordering and durations', () => {
    for (let i = 0; i < passes.length; i += 1) {
      const p = passes[i];
      expect(p.riseTime.getTime()).toBeLessThan(p.maxElevationTime.getTime());
      expect(p.maxElevationTime.getTime()).toBeLessThanOrEqual(p.setTime.getTime());
      expect(p.durationSec).toBeGreaterThan(60);
      expect(p.durationSec).toBeLessThan(1000);
      if (i > 0) expect(p.riseTime.getTime()).toBeGreaterThan(passes[i - 1].setTime.getTime());
    }
  });

  it('puts rise and set times on the horizon to within a second', () => {
    for (const p of passes) {
      const justBeforeRise = elevation(new Date(p.riseTime.getTime() - 1500));
      const atRise = elevation(p.riseTime);
      expect(atRise).toBeGreaterThan(0);
      expect(atRise).toBeLessThan(0.3);
      expect(justBeforeRise).toBeLessThanOrEqual(0.0001);

      const atSet = elevation(p.setTime);
      const justAfterSet = elevation(new Date(p.setTime.getTime() + 1500));
      expect(atSet).toBeGreaterThan(0);
      expect(atSet).toBeLessThan(0.3);
      expect(justAfterSet).toBeLessThanOrEqual(0.0001);
    }
  });

  it('reports a true maximum elevation', () => {
    for (const p of passes) {
      const atPeak = elevation(p.maxElevationTime);
      expect(atPeak).toBeCloseTo(p.maxElevationDeg, 3);
      expect(atPeak + 0.01).toBeGreaterThanOrEqual(elevation(new Date(p.maxElevationTime.getTime() - 30_000)));
      expect(atPeak + 0.01).toBeGreaterThanOrEqual(elevation(new Date(p.maxElevationTime.getTime() + 30_000)));
      expect(p.maxElevationDeg).toBeLessThanOrEqual(90);
    }
  });

  it('reports azimuths in 0..360', () => {
    for (const p of passes) {
      for (const az of [p.riseAzimuthDeg, p.maxAzimuthDeg, p.setAzimuthDeg]) {
        expect(az).toBeGreaterThanOrEqual(0);
        expect(az).toBeLessThan(360);
      }
    }
  });

  it('drops passes below the minimum elevation and keeps the rest unchanged', () => {
    const filtered = predictPasses(M2_4, WASHINGTON, FROM, TWO_DAYS, { minElevationDeg: 30 });
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.length).toBeLessThan(passes.length);
    for (const p of filtered) expect(p.maxElevationDeg).toBeGreaterThanOrEqual(30);
    const times = new Set(passes.map((p) => p.riseTime.getTime()));
    for (const p of filtered) expect(times.has(p.riseTime.getTime())).toBe(true);
  });

  it('includes a pass that is already in progress, with its real rise time', () => {
    const original = passes[2];
    const midPass = new Date((original.riseTime.getTime() + original.setTime.getTime()) / 2);
    const fromMid = predictPasses(M2_4, WASHINGTON, midPass, new Date(midPass.getTime() + 3600_000));
    expect(fromMid.length).toBeGreaterThan(0);
    expect(Math.abs(fromMid[0].riseTime.getTime() - original.riseTime.getTime())).toBeLessThanOrEqual(1000);
    expect(Math.abs(fromMid[0].setTime.getTime() - original.setTime.getTime())).toBeLessThanOrEqual(1000);
  });

  it('writes predictions for external cross-checking when asked', () => {
    if (!process.env.AZIMUTH_PASS_DUMP) return;
    fs.writeFileSync(
      process.env.AZIMUTH_PASS_DUMP,
      JSON.stringify(
        passes.map((p) => ({
          rise: p.riseTime.toISOString(),
          peak: p.maxElevationTime.toISOString(),
          set: p.setTime.toISOString(),
          maxEl: p.maxElevationDeg,
          riseAz: p.riseAzimuthDeg,
          setAz: p.setAzimuthDeg,
        })),
        null,
        1
      )
    );
  });
});

describe('track sampling', () => {
  const [pass] = predictPasses(M2_4, WASHINGTON, FROM, TWO_DAYS);

  it('covers the pass from rise to set at the requested step', () => {
    const track = sampleTrack(M2_4, WASHINGTON, pass.riseTime, pass.setTime, 10);
    expect(track[0].time.getTime()).toBe(pass.riseTime.getTime());
    expect(track[track.length - 1].time.getTime()).toBe(pass.setTime.getTime());
    expect(track.length).toBeGreaterThan(pass.durationSec / 10);
    expect(Math.max(...track.map((t) => t.elevationDeg))).toBeCloseTo(pass.maxElevationDeg, 0);
    for (const point of track) {
      expect(point.altitudeKm).toBeGreaterThan(700);
      expect(point.altitudeKm).toBeLessThan(900);
      expect(point.latitudeDeg).toBeGreaterThanOrEqual(-90);
      expect(point.latitudeDeg).toBeLessThanOrEqual(90);
    }
  });

  it('builds a long ground track and a current position', () => {
    const track = sampleGroundTrack(M2_4, FROM, new Date(FROM.getTime() + 100 * 60_000), 30);
    expect(track.length).toBeGreaterThan(190);
    const now = getCurrentTrackPoint(M2_4, WASHINGTON, FROM);
    expect(now).not.toBeNull();
    expect(now!.rangeKm).toBeGreaterThan(700);
  });
});

describe('footprint geometry', () => {
  it('has a horizon radius of about 28 degrees at Meteor altitude', () => {
    const radius = footprintRadiusDeg(830);
    expect(radius).toBeGreaterThan(27);
    expect(radius).toBeLessThan(29);
    expect(footprintRadiusDeg(830, 10)).toBeLessThan(radius);
    expect(footprintRadiusDeg(830, 10)).toBeGreaterThan(0);
  });

  it('traces a circle of constant angular radius', () => {
    const polygon = footprintPolygon(40, -75, 25, 72);
    expect(polygon).toHaveLength(72);
    for (const p of polygon) {
      expect(haversineDeg(40, -75, p.latitudeDeg, p.longitudeDeg)).toBeCloseTo(25, 1);
    }
  });

  it('keeps the outline continuous across the antimeridian', () => {
    const polygon = footprintPolygon(10, 175, 20, 72);
    for (let i = 1; i < polygon.length; i += 1) {
      expect(Math.abs(polygon[i].longitudeDeg - polygon[i - 1].longitudeDeg)).toBeLessThan(30);
    }
    expect(Math.max(...polygon.map((p) => p.longitudeDeg))).toBeGreaterThan(180);
  });

  it('moves due north by the requested arc', () => {
    const p = destinationPoint(0, 0, 0, 10);
    expect(p.latitudeDeg).toBeCloseTo(10, 6);
    expect(p.longitudeDeg).toBeCloseTo(0, 6);
  });
});

describe('helpers', () => {
  it('unwraps longitudes across the antimeridian in both directions', () => {
    expect(unwrapLongitudes([170, 179, -178, -170])).toEqual([170, 179, 182, 190]);
    expect(unwrapLongitudes([-170, -179, 178, 170])).toEqual([-170, -179, -182, -190]);
    expect(unwrapLongitudes([])).toEqual([]);
  });

  it('classifies pass quality by peak elevation', () => {
    expect(classifyPass(75)).toBe('excellent');
    expect(classifyPass(50)).toBe('excellent');
    expect(classifyPass(35)).toBe('good');
    expect(classifyPass(20)).toBe('fair');
    expect(classifyPass(8)).toBe('low');
  });
});
