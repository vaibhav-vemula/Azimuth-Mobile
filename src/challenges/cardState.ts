import type { NodeSummary } from '../network/api';
import type { Challenge } from './definitions';
import { periodKey } from './periods';
import type { VerifiedItem } from './progress';

export type CardState =
  | { kind: 'progress'; value: number }
  | { kind: 'ready' }
  | { kind: 'waiting' }
  | { kind: 'claimed' }
  | { kind: 'rejected'; value: number; reason: string };

export function cardState(
  c: Challenge,
  a: { value: number; claims: NodeSummary['claims']; verified: VerifiedItem[]; nowMs: number }
): CardState {
  const key = periodKey(c.period, a.nowMs);
  const mine = (a.claims ?? []).filter((x) => x.challengeId === c.id && x.period === key);
  const paid = a.verified.some((v) => v.type === 'challenge-claim' && v.challenge === c.id && v.period === key);
  if (paid || mine.some((x) => x.status === 'verified')) return { kind: 'claimed' };
  if (mine.some((x) => x.status === 'new')) return { kind: 'waiting' };
  const ready = a.value >= c.goal;
  const rejected = mine.find((x) => x.status === 'rejected');
  if (rejected && ready) return { kind: 'rejected', value: a.value, reason: rejected.reasons?.[0] ?? 'Not verified yet' };
  return ready ? { kind: 'ready' } : { kind: 'progress', value: a.value };
}
