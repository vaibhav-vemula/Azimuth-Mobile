import { periodKey, previousPeriodKey, periodWindow, isClaimablePeriod } from '../periods';

const T = Date.UTC(2026, 9, 10, 15, 30);

describe('periods (UTC, same vectors as the server)', () => {
  it('keys', () => {
    expect(periodKey('daily', T)).toBe('2026-10-10');
    expect(periodKey('daily', Date.UTC(2026, 9, 10, 23, 59, 59))).toBe('2026-10-10');
    expect(periodKey('daily', Date.UTC(2026, 9, 11))).toBe('2026-10-11');
    expect(periodKey('weekly', T)).toBe('2026-W41');
    expect(periodKey('weekly', Date.UTC(2026, 9, 12))).toBe('2026-W42');
    expect(periodKey('weekly', Date.UTC(2026, 9, 11, 23, 59, 59))).toBe('2026-W41');
    expect(periodKey('weekly', Date.UTC(2027, 0, 1))).toBe('2026-W53');
    expect(periodKey('weekly', Date.UTC(2024, 11, 30))).toBe('2025-W01');
    expect(periodKey('once', T)).toBe('once');
  });
  it('previous period, windows and claimable', () => {
    expect(previousPeriodKey('daily', T)).toBe('2026-10-09');
    expect(previousPeriodKey('weekly', T)).toBe('2026-W40');
    expect(periodWindow('daily', '2026-10-10', T)).toEqual({ fromMs: Date.UTC(2026, 9, 10), toMs: Date.UTC(2026, 9, 11) });
    expect(periodWindow('weekly', '2026-W41', T)).toEqual({ fromMs: Date.UTC(2026, 9, 5), toMs: Date.UTC(2026, 9, 12) });
    expect(periodWindow('once', 'once', T)).toEqual({ fromMs: 0, toMs: T + 1 });
    expect(isClaimablePeriod('daily', '2026-10-09', T)).toBe(true);
    expect(isClaimablePeriod('daily', '2026-10-08', T)).toBe(false);
    expect(isClaimablePeriod('daily', '2026-10-11', T)).toBe(false);
  });
});
