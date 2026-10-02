import { computeTriggerDate } from './reminders';

describe('computeTriggerDate', () => {
  const now = new Date('2026-10-02T12:00:00Z');

  it('fires the requested number of minutes before the rise', () => {
    const rise = new Date('2026-10-02T13:00:00Z');
    expect(computeTriggerDate(rise, 10, now)!.toISOString()).toBe('2026-10-02T12:50:00.000Z');
  });

  it('fires almost immediately when the lead time has already passed', () => {
    const rise = new Date('2026-10-02T12:05:00Z');
    const trigger = computeTriggerDate(rise, 10, now)!;
    expect(trigger.getTime()).toBeGreaterThan(now.getTime());
    expect(trigger.getTime()).toBeLessThan(now.getTime() + 5000);
  });

  it('returns null for a pass that has already started', () => {
    expect(computeTriggerDate(new Date('2026-10-02T11:59:00Z'), 10, now)).toBeNull();
  });
});
