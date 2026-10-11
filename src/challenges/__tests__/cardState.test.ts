import { cardState } from '../cardState';
import { challengeFromRow } from '../definitions';

const NOW = Date.UTC(2026, 9, 10, 15, 0);
const scan = challengeFromRow({ id: 'scan-30', title: 'Scan', blurb: '', period: 'daily', metric: 'mapping_minutes', goal: 30, reward: 5, go_tab: 'Map' })!;
const chest = challengeFromRow({ id: 'first-chest', title: 'Chest', blurb: '', period: 'once', metric: 'chests_opened', goal: 1, reward: 20, go_tab: 'Map' })!;
const base = { claims: [] as never[], verified: [] as never[], nowMs: NOW };

describe('cardState', () => {
  it('progress while below the goal, ready at the goal', () => {
    expect(cardState(scan, { ...base, value: 12 })).toEqual({ kind: 'progress', value: 12 });
    expect(cardState(scan, { ...base, value: 30 })).toEqual({ kind: 'ready' });
  });
  it('waiting while a claim for this period is unsettled', () => {
    const claims = [{ challengeId: 'scan-30', period: '2026-10-10', status: 'new' as const, reasons: null }];
    expect(cardState(scan, { ...base, claims, value: 30 })).toEqual({ kind: 'waiting' });
  });
  it('claimed after a verified claim for this period, but not for an older period', () => {
    expect(cardState(scan, { ...base, value: 30, verified: [{ type: 'challenge-claim', verified_ms: NOW, challenge: 'scan-30', period: '2026-10-10' }] })).toEqual({ kind: 'claimed' });
    expect(cardState(scan, { ...base, value: 30, verified: [{ type: 'challenge-claim', verified_ms: NOW, challenge: 'scan-30', period: '2026-10-09' }] })).toEqual({ kind: 'ready' });
  });
  it('a one-time challenge stays claimed forever', () => {
    expect(cardState(chest, { ...base, value: 1, verified: [{ type: 'challenge-claim', verified_ms: 1, challenge: 'first-chest', period: 'once' }] })).toEqual({ kind: 'claimed' });
  });
  it('a rejected claim shows the reason and can be claimed again when progress is still enough', () => {
    const claims = [{ challengeId: 'scan-30', period: '2026-10-10', status: 'rejected' as const, reasons: ['23 of 30 verified so far.'] }];
    expect(cardState(scan, { ...base, claims, value: 30 })).toEqual({ kind: 'rejected', value: 30, reason: '23 of 30 verified so far.' });
    expect(cardState(scan, { ...base, claims, value: 10 })).toEqual({ kind: 'progress', value: 10 });
  });
});
