import type { SessionRecord } from '../mapping/sessionHistory';
import type { Challenge } from './definitions';
import { periodKey, periodWindow } from './periods';

export interface VerifiedItem {
  type: string;
  verified_ms: number;
  challenge?: string | null;
  period?: string | null;
}

/**
 * Progress shown on the card, from what is on the phone (sessions) and what the server already verified (passes and
 * chests). It is for display only: the server recomputes everything when a challenge is claimed.
 */
export function localProgress(
  c: Challenge,
  data: { sessions: SessionRecord[]; verified: VerifiedItem[]; nowMs: number }
): number {
  const { fromMs, toMs } = periodWindow(c.period, periodKey(c.period, data.nowMs), data.nowMs);
  const inWindow = (ms: number) => ms >= fromMs && ms < toMs;
  let value = 0;
  switch (c.metric) {
    case 'mapping_minutes':
      value = Math.floor(data.sessions.filter((s) => inWindow(s.startedMs)).reduce((n, s) => n + s.durationSec, 0) / 60);
      break;
    case 'new_cells':
      value = data.sessions.filter((s) => inWindow(s.startedMs)).reduce((n, s) => n + s.newCells, 0);
      break;
    case 'satellite_passes':
      value = data.verified.filter((v) => v.type === 'satellite-pass' && inWindow(v.verified_ms)).length;
      break;
    case 'chests_opened':
      value = data.verified.filter((v) => v.type === 'chest-claim' && inWindow(v.verified_ms)).length;
      break;
  }
  return Math.min(value, c.goal);
}
