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
