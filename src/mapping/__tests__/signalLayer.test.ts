import { CELLULAR_RANGE, HEAT_RADIUS_M, addReading, circleRing, legendFor, level, metresPerPoint, radiusForMetres, rampColour, signalPoints, toHex } from '../signalLayer';
import type { CellSignal } from '../signalLayer';
import type { MappedScan } from '../aggregate';
import { distanceM } from '../hexGrid';

const cell = (dbm: number) => ({ tech: 'lte' as const, registered: true, dbm, level: 2, cellId: '1', channel: 1, plmn: '1' });
const scan = (over: Partial<MappedScan> = {}): MappedScan => ({
  atMs: 0,
  cellular: { available: true, cells: [cell(-90)] },
  wifi: { available: true, count: 10 },
  bluetooth: { available: true, count: 6 },
  gnss: {},
  ...over,
});

describe('folding readings into a cell', () => {
  it('keeps running sums and counts', () => {
    let s = addReading(undefined, scan(), 1);
    s = addReading(s, scan({ cellular: { available: true, cells: [cell(-100), cell(-80)] }, wifi: { available: true, count: 20 } }), 2);
    expect(s).toMatchObject({ n: 2, cn: 2, cs: -170, dz: 0, wn: 2, ws: 30, bn: 2, bs: 12, t: 2 });
  });

  it('counts readings with no cell as dead-zone readings, and ignores sensors that were unavailable', () => {
    const s = addReading(undefined, scan({ cellular: { available: true, cells: [] }, wifi: { available: false }, bluetooth: null }), 1);
    expect(s).toMatchObject({ n: 1, cn: 0, dz: 1, wn: 0, bn: 0 });
    const off = addReading(undefined, scan({ cellular: { available: false, cells: [] } }), 1);
    expect(off.dz).toBe(0);
    expect(off.cn).toBe(0);
  });

  it('does not change the cell it was given', () => {
    const a = addReading(undefined, scan(), 1);
    const snapshot = JSON.stringify(a);
    addReading(a, scan(), 2);
    expect(JSON.stringify(a)).toBe(snapshot);
  });
});

describe('levels and colours', () => {
  const s = (over: Partial<CellSignal> = {}): CellSignal => ({ n: 1, cs: 0, cn: 0, dz: 0, ws: 0, wn: 0, bs: 0, bn: 0, t: 0, ...over });

  it('puts cellular dBm on a 0 to 1 scale and clamps it', () => {
    expect(level('cellular', s({ cn: 1, cs: CELLULAR_RANGE.weak }))).toBe(0);
    expect(level('cellular', s({ cn: 1, cs: CELLULAR_RANGE.strong }))).toBe(1);
    expect(level('cellular', s({ cn: 2, cs: -260 }))).toBe(0);
    expect(level('cellular', s({ cn: 1, cs: -40 }))).toBe(1);
    expect(level('cellular', s({ cn: 1, cs: -97.5 }))).toBeCloseTo(0.5, 5);
  });

  it('shows a cell with no signal at the bottom, and a cell without data as nothing', () => {
    expect(level('cellular', s({ dz: 3 }))).toBe(0);
    expect(level('cellular', s())).toBeNull();
    expect(level('wifi', s())).toBeNull();
    expect(level('bluetooth', s())).toBeNull();
    expect(level('off', s({ cn: 1, cs: -80 }))).toBeNull();
  });

  it('scales Wi-Fi and Bluetooth by how many were seen', () => {
    expect(level('wifi', s({ wn: 2, ws: 25 }))).toBeCloseTo(0.5, 5);
    expect(level('wifi', s({ wn: 1, ws: 400 }))).toBe(1);
    expect(level('bluetooth', s({ bn: 1, bs: 0 }))).toBe(0);
  });

  it('colours weak red and strong green-teal, with amber between', () => {
    expect(toHex(rampColour('cellular', 0))).toBe('#ff4d6d');
    expect(toHex(rampColour('cellular', 1))).toBe('#2ee6c5');
    const mid = rampColour('cellular', 0.35);
    expect(mid).toEqual([255, 176, 32]);
    expect(rampColour('cellular', -5)).toEqual(rampColour('cellular', 0));
    expect(rampColour('cellular', 9)).toEqual(rampColour('cellular', 1));
  });

  it('has a legend for each layer that matches its ramp ends', () => {
    for (const layer of ['cellular', 'wifi', 'bluetooth'] as const) {
      const l = legendFor(layer);
      expect(l.low).toBe(toHex(rampColour(layer, 0)));
      expect(l.high).toBe(toHex(rampColour(layer, 1)));
      expect(l.title.length).toBeGreaterThan(5);
    }
  });
});

describe('heat points', () => {
  const signals: Record<string, CellSignal> = {
    'h20:1:1': { n: 3, cs: -270, cn: 3, dz: 0, ws: 30, wn: 3, bs: 0, bn: 0, t: 0 },
    'h20:2:2': { n: 1, cs: 0, cn: 0, dz: 1, ws: 0, wn: 0, bs: 0, bn: 0, t: 0 },
    nonsense: { n: 1, cs: -80, cn: 1, dz: 0, ws: 0, wn: 0, bs: 0, bn: 0, t: 0 },
  };

  it('makes one coloured point per measured spot, skipping bad ids and spots without data', () => {
    const f = signalPoints(signals, 'cellular');
    expect(f.features).toHaveLength(2);
    expect(f.features[0].geometry.type).toBe('Point');
    expect(f.features.map((x) => x.properties?.color)).toEqual([toHex(rampColour('cellular', 30 / 45)), '#ff4d6d']);
    expect(signalPoints(signals, 'wifi').features).toHaveLength(1);
    expect(signalPoints(signals, 'bluetooth').features).toHaveLength(0);
  });

  it('puts each point at the centre of its cell', () => {
    const [p] = signalPoints(signals, 'wifi').features;
    const [lon, lat] = p.geometry.coordinates;
    expect(Number.isFinite(lon) && Number.isFinite(lat)).toBe(true);
    expect(Math.abs(lat)).toBeLessThan(1); // the test cell is near the equator
  });

  it('draws nothing when the layer is off', () => {
    expect(signalPoints(signals, 'off').features).toHaveLength(0);
  });
});

describe('glow size', () => {
  it('halves the ground covered per point at each zoom step', () => {
    expect(metresPerPoint(17, 38.9) / metresPerPoint(18, 38.9)).toBeCloseTo(2, 6);
    expect(metresPerPoint(16, 0)).toBeCloseTo(1.194, 2);
    expect(metresPerPoint(16, 60)).toBeCloseTo(metresPerPoint(16, 0) / 2, 3);
  });

  it('keeps the glow the same size on the ground at every zoom', () => {
    const expr = radiusForMetres(HEAT_RADIUS_M, 38.9) as unknown[];
    expect(expr.slice(0, 3)).toEqual(['interpolate', ['exponential', 2], ['zoom']]);
    const [lo, loPx, hi, hiPx] = expr.slice(3) as number[];
    expect(loPx * metresPerPoint(lo, 38.9)).toBeCloseTo(HEAT_RADIUS_M, 6);
    expect(hiPx * metresPerPoint(hi, 38.9)).toBeCloseTo(HEAT_RADIUS_M, 6);
    // Halfway in zoom, an exponential(2) curve gives the radius that matches the ground size there too.
    const mid = (lo + hi) / 2;
    const t = (2 ** (mid - lo) - 1) / (2 ** (hi - lo) - 1);
    expect((loPx + (hiPx - loPx) * t) * metresPerPoint(mid, 38.9)).toBeCloseTo(HEAT_RADIUS_M, 3);
  });
});

describe('vision ring', () => {
  it('is a closed circle of the right radius around a point', () => {
    const c = { latitudeDeg: 38.9072, longitudeDeg: -77.0369 };
    const ring = circleRing(c, 60);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    for (const [lon, lat] of ring) {
      expect(distanceM(c, { latitudeDeg: lat, longitudeDeg: lon })).toBeGreaterThan(59);
      expect(distanceM(c, { latitudeDeg: lat, longitudeDeg: lon })).toBeLessThan(61);
    }
  });
});
