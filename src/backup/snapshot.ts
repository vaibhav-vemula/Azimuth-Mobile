import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import type { CellSignal } from '../mapping/signalLayer';

/** Everything that makes up the user's map progress. Local to the phone, and backed up only in encrypted form. */
export interface Snapshot {
  v: 1;
  savedMs: number;
  /** Cleared fog cells and when each was first cleared. */
  explored: Record<string, number>;
  /** Reporting cells visited and when. */
  visited: Record<string, number>;
  /** What was measured in each signal cell. */
  signals: Record<string, CellSignal>;
}

export const EMPTY: Omit<Snapshot, 'savedMs'> = { v: 1, explored: {}, visited: {}, signals: {} };

function earliest(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out = { ...a };
  for (const [id, t] of Object.entries(b)) out[id] = id in out ? Math.min(out[id], t) : t;
  return out;
}

/**
 * Joins the progress on this phone with a backup. Cells are only ever added, never lost: for fog and visits the earliest
 * time wins; for a signal cell, whichever copy holds more readings (then the newer one) is kept, since two copies of one
 * cell cannot be added without counting the same readings twice.
 */
export function mergeSnapshots(local: Snapshot, remote: Snapshot): Snapshot {
  const signals = { ...local.signals };
  for (const [id, theirs] of Object.entries(remote.signals)) {
    const mine = signals[id];
    if (!mine || theirs.n > mine.n || (theirs.n === mine.n && theirs.t > mine.t)) signals[id] = theirs;
  }
  return {
    v: 1,
    savedMs: Math.max(local.savedMs, remote.savedMs),
    explored: earliest(local.explored, remote.explored),
    visited: earliest(local.visited, remote.visited),
    signals,
  };
}

/** True when the first holds a cell the second lacks, i.e. there is something worth uploading. */
export function hasNewerThan(a: Snapshot, b: Snapshot): boolean {
  const lacking = (x: Record<string, unknown>, y: Record<string, unknown>) => Object.keys(x).some((id) => !(id in y));
  if (lacking(a.explored, b.explored) || lacking(a.visited, b.visited) || lacking(a.signals, b.signals)) return true;
  return Object.entries(a.signals).some(([id, s]) => s.n > (b.signals[id]?.n ?? 0));
}

/** Compressed bytes for a snapshot. Cell ids repeat a lot, so this is typically 10 to 20 times smaller. */
export function packSnapshot(snapshot: Snapshot): Uint8Array {
  return gzipSync(strToU8(JSON.stringify(snapshot)), { level: 9 });
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Reads bytes made by packSnapshot, refusing anything that is not a well-formed snapshot. */
export function unpackSnapshot(bytes: Uint8Array): Snapshot {
  const parsed: unknown = JSON.parse(strFromU8(gunzipSync(bytes)));
  if (!isRecord(parsed) || parsed.v !== 1 || !isRecord(parsed.explored) || !isRecord(parsed.visited) || !isRecord(parsed.signals)) {
    throw new Error('This backup is not in a format this version understands.');
  }
  const numbers = (r: Record<string, unknown>) => Object.values(r).every((t) => typeof t === 'number' && Number.isFinite(t));
  if (!numbers(parsed.explored) || !numbers(parsed.visited)) throw new Error('This backup is damaged.');
  if (!Object.values(parsed.signals).every((s) => isRecord(s) && typeof s.n === 'number' && typeof s.t === 'number')) throw new Error('This backup is damaged.');
  return { v: 1, savedMs: typeof parsed.savedMs === 'number' ? parsed.savedMs : 0, explored: parsed.explored as Record<string, number>, visited: parsed.visited as Record<string, number>, signals: parsed.signals as Record<string, CellSignal> };
}
