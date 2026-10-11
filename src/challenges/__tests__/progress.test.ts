import { challengeFromRow } from '../definitions';
import type { Challenge } from '../definitions';
import { localProgress } from '../progress';
import type { SessionRecord } from '../../mapping/sessionHistory';

const NOW = Date.UTC(2026, 9, 10, 15, 0);
const session = (over: Partial<SessionRecord>): SessionRecord => ({
  id: String(over.startedMs), startedMs: NOW - 3600_000, endedMs: NOW - 1800_000, durationSec: 1800, distanceM: 0,
  clearedCells: 0, areaKm2: 0, newCells: 0, readings: 5, towers: 0, wifi: 0, bluetooth: 0, radioDbfs: null, ...over,
});

const make = (over: Record<string, unknown>): Challenge =>
  challengeFromRow({ id: 'x', title: 't', blurb: '', period: 'daily', metric: 'mapping_minutes', goal: 30, reward: 5, go_tab: 'Map', ...over })!;

describe('challengeFromRow', () => {
  it('maps a valid row and drops invalid ones', () => {
    expect(make({})).toEqual({ id: 'x', title: 't', blurb: '', period: 'daily', metric: 'mapping_minutes', goal: 30, reward: 5, go: 'Map' });
    for (const bad of [{ reward: 0 }, { reward: 101 }, { reward: 2.5 }, { goal: 0 }, { period: 'monthly' }, { metric: 'steps' }, { go_tab: 'Profile' }, { id: 'Bad Id' }]) {
      expect(challengeFromRow({ id: 'x', title: 't', period: 'daily', metric: 'mapping_minutes', goal: 30, reward: 5, go_tab: 'Map', ...bad })).toBeNull();
    }
    expect(challengeFromRow(null)).toBeNull();
    expect(challengeFromRow('nope')).toBeNull();
  });
});

describe('localProgress', () => {
  const scan = make({ id: 'scan-30' });
  const cells = make({ id: 'cells-20', metric: 'new_cells', goal: 20 });
  const weekly = make({ id: 'ground-weekly', period: 'weekly', metric: 'new_cells', goal: 70, reward: 40 });
  const passes = make({ id: 'passes-3', period: 'weekly', metric: 'satellite_passes', goal: 3, reward: 30, go_tab: 'Satellites' });
  const chest = make({ id: 'first-chest', period: 'once', metric: 'chests_opened', goal: 1, reward: 20 });

  it('adds up today\'s mapping minutes and ignores sessions from other UTC days', () => {
    const sessions = [session({ startedMs: NOW - 3600_000, durationSec: 1800 }), session({ startedMs: NOW - 86_400_000 * 2, durationSec: 3600 })];
    expect(localProgress(scan, { sessions, verified: [], nowMs: NOW })).toBe(30);
  });
  it('counts new cells in the period (day vs week)', () => {
    const sessions = [session({ startedMs: NOW - 1000, newCells: 12 }), session({ startedMs: NOW - 3 * 86_400_000, newCells: 30 })];
    expect(localProgress(cells, { sessions, verified: [], nowMs: NOW })).toBe(12);
    expect(localProgress(weekly, { sessions, verified: [], nowMs: NOW })).toBe(42); // Oct 7 is in ISO week 41 with Oct 10
  });
  it('counts verified passes this week and chests ever', () => {
    const verified = [
      { type: 'satellite-pass', verified_ms: NOW - 1000 }, { type: 'satellite-pass', verified_ms: NOW - 86_400_000 },
      { type: 'satellite-pass', verified_ms: NOW - 20 * 86_400_000 }, { type: 'chest-claim', verified_ms: NOW - 40 * 86_400_000 },
    ];
    expect(localProgress(passes, { sessions: [], verified, nowMs: NOW })).toBe(2);
    expect(localProgress(chest, { sessions: [], verified, nowMs: NOW })).toBe(1);
  });
  it('never goes above the goal for display', () => {
    expect(localProgress(scan, { sessions: [session({ durationSec: 99999 })], verified: [], nowMs: NOW })).toBe(30);
  });
});
