import { buildSessionRecord, sessionDate, sortSessions } from '../sessionHistory';
import { emptyTotals } from '../sessionStats';

const base = {
  startedMs: 1_700_000_000_000,
  endedMs: 1_700_000_000_000 + 754_000,
  distanceM: 812.4,
  clearedCells: 120,
  areaKm2: 0.003,
  newCells: 4,
  readings: 38,
  totals: { ...emptyTotals(), towers: 6, wifiUnique: 41, bluetoothUnique: 17 },
  radioLevelSum: 0,
  radioLevelN: 0,
};

describe('session records', () => {
  it('summarise a session', () => {
    const r = buildSessionRecord({ ...base, radioLevelSum: -90, radioLevelN: 3 })!;
    expect(r).toMatchObject({ id: '1700000000000', durationSec: 754, distanceM: 812, clearedCells: 120, areaKm2: 0.003, newCells: 4, readings: 38, towers: 6, wifi: 41, bluetooth: 17, radioDbfs: -30 });
  });

  it('have no radio level when the dongle took no readings', () => {
    expect(buildSessionRecord(base)!.radioDbfs).toBeNull();
  });

  it('are not made for a session where nothing happened', () => {
    expect(buildSessionRecord({ ...base, readings: 0, clearedCells: 0 })).toBeNull();
    expect(buildSessionRecord({ ...base, readings: 0 })).not.toBeNull(); // it still cleared some fog
  });

  it('sort newest first and keep one per id', () => {
    const a = buildSessionRecord({ ...base, startedMs: 1000, endedMs: 2000 })!;
    const b = buildSessionRecord({ ...base, startedMs: 5000, endedMs: 6000 })!;
    expect(sortSessions([a, b, a]).map((r) => r.id)).toEqual(['5000', '1000']);
  });
});

describe('session dates', () => {
  const now = new Date(2026, 9, 4, 15, 0).getTime();
  it('say today and yesterday, and give the date for older ones', () => {
    expect(sessionDate(new Date(2026, 9, 4, 9, 5).getTime(), now)).toMatch(/^Today, /);
    expect(sessionDate(new Date(2026, 9, 3, 23, 50).getTime(), now)).toMatch(/^Yesterday, /);
    expect(sessionDate(new Date(2026, 8, 20, 9, 5).getTime(), now)).toMatch(/^Sep 20, /);
    expect(sessionDate(new Date(2025, 8, 20, 9, 5).getTime(), now)).toMatch(/2025/);
  });
});

describe('rebuilding sessions mapped before history existed', () => {
  const { reconstructSessions } = require('../sessionHistory');
  const MIN = 60_000;
  const T0 = 1_700_000_000_000;
  /** n cells cleared one per `step` ms from `start`. */
  const run = (prefix: string, start: number, n: number, step = 5_000) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`h5:${prefix}:${i}`, start + i * step]));

  it('finds each walk by the pauses between them', () => {
    const explored = { ...run('a', T0, 100), ...run('b', T0 + 5 * 3_600_000, 60) };
    const found = reconstructSessions(explored);
    expect(found).toHaveLength(2);
    const [first, second] = found;
    expect(first.record).toMatchObject({ startedMs: T0, clearedCells: 100, estimated: true, distanceM: 0, readings: 0, radioDbfs: null });
    expect(first.record.durationSec).toBe(495);
    expect(first.cells).toHaveLength(100);
    expect(second.record.clearedCells).toBe(60);
  });

  it('keeps cells together when the pause is short, and ignores a handful of stray cells', () => {
    const explored = { ...run('a', T0, 50), ...run('b', T0 + 49 * 5_000 + 20 * MIN, 50), ...run('c', T0 + 10 * 3_600_000, 5) };
    const found = reconstructSessions(explored);
    expect(found).toHaveLength(1);
    expect(found[0].record.clearedCells).toBe(100);
  });

  it('skips cells from sessions that have real records already', () => {
    const explored = { ...run('a', T0, 50), ...run('b', T0 + 3_600_000 * 5, 50) };
    expect(reconstructSessions(explored, T0 + 3_600_000 * 4)).toHaveLength(1);
  });

  it('gives nothing for an empty fog map', () => {
    expect(reconstructSessions({})).toEqual([]);
  });
});
