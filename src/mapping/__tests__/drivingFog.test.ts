import { JOIN_SPACING_M, MAX_JOIN_M, MAX_JOIN_S, FOG_CELL_M, pointsAlong } from '../explore';
import { cellIdAt, distanceM } from '../hexGrid';
import { useMapping } from '../useMapping';

jest.mock('../../../modules/rtl-sdr', () => ({
  FM_SAMPLE_RATE_HZ: 2_400_000,
  SATELLITE_SAMPLE_RATE_HZ: 2_304_000,
  MIN_FREQUENCY_HZ: 24_000_000,
  MAX_FREQUENCY_HZ: 1_766_000_000,
  addSignalListener: jest.fn(),
  addStatusListener: jest.fn(),
}));

const A = { latitudeDeg: 38.9072, longitudeDeg: -77.0369 };
/** About `m` metres east of A. */
const east = (m: number) => ({ ...A, longitudeDeg: A.longitudeDeg + m / (111_320 * Math.cos((A.latitudeDeg * Math.PI) / 180)) });

describe('pointsAlong', () => {
  it('walks from one fix to the next in even steps, ending on the new fix', () => {
    const pts = pointsAlong(A, east(100), 5);
    expect(pts).toHaveLength(5);
    expect(distanceM(pts[pts.length - 1], east(100))).toBeLessThan(0.01);
    for (let i = 1; i < pts.length; i += 1) expect(distanceM(pts[i - 1], pts[i])).toBeLessThanOrEqual(JOIN_SPACING_M + 0.5);
  });

  it('has nothing to add when the fixes are already close, or the gap is not driving', () => {
    expect(pointsAlong(A, east(10), 1)).toEqual([]);
    expect(pointsAlong(A, east(MAX_JOIN_M + 500), 60)).toEqual([]); // too far
    expect(pointsAlong(A, east(300), MAX_JOIN_S + 1)).toEqual([]); // too long ago
    expect(pointsAlong(A, east(300), -1)).toEqual([]);
  });
});

describe('driving', () => {
  beforeEach(() => useMapping.setState({ explored: {}, status: 'idle' }));

  it('leaves gaps if each fix only clears a circle around itself, 450 m apart at 70 km/h', () => {
    useMapping.getState().revealAt(A);
    useMapping.getState().revealAt(east(450));
    const explored = useMapping.getState().explored;
    expect(explored[cellIdAt(east(225), FOG_CELL_M)]).toBeUndefined(); // the road between the two circles is still fog
  });

  it('clears one continuous road when the line between the fixes is cleared too', () => {
    const store = useMapping.getState();
    store.revealAt(A);
    store.revealPath(pointsAlong(A, east(200), 10), east(200));
    const explored = useMapping.getState().explored;
    for (let m = 0; m <= 200; m += 5) expect(explored[cellIdAt(east(m), FOG_CELL_M)]).toBeDefined();
  });

  it('reports only the new cells, so the session counter is right', () => {
    const first = useMapping.getState().revealAt(A);
    expect(first).toBeGreaterThan(200);
    const again = useMapping.getState().revealPath([], A);
    expect(again).toBe(0);
    const driven = useMapping.getState().revealPath(pointsAlong(A, east(200), 10), east(200));
    expect(driven).toBeGreaterThan(0);
    expect(Object.keys(useMapping.getState().explored)).toHaveLength(first + driven);
  });

  it('keeps the road solid at speed over a long drive', () => {
    const store = useMapping.getState();
    let at = A;
    store.revealAt(at);
    for (let i = 1; i <= 15; i += 1) {
      const next = east(i * 25); // one fix a second at 25 m/s (90 km/h)
      store.revealPath(pointsAlong(at, next, 1), next);
      at = next;
    }
    const explored = useMapping.getState().explored;
    for (let m = 0; m <= 375; m += 5) expect(explored[cellIdAt(east(m), FOG_CELL_M)]).toBeDefined();
  });
});

describe('how often readings are taken', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { scanIntervalFor, SCAN_INTERVAL_MS } = require('../useMapping');

  it('is every 20 seconds on foot and more often the faster you go', () => {
    expect(scanIntervalFor(0)).toBe(SCAN_INTERVAL_MS);
    expect(scanIntervalFor(1.4)).toBe(SCAN_INTERVAL_MS);
    expect(scanIntervalFor(5)).toBe(10_000); // cycling
    expect(scanIntervalFor(25)).toBe(6_000); // driving
  });

  it('falls back to the walking rate when the speed is not known', () => {
    expect(scanIntervalFor(Number.NaN)).toBe(SCAN_INTERVAL_MS);
    expect(scanIntervalFor(-1)).toBe(SCAN_INTERVAL_MS);
  });
});
