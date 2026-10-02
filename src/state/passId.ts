export interface HasPassIdentity {
  id: string;
  noradId: string;
  riseTime: Date;
}

/**
 * Stable identity for a pass: satellite plus rise time rounded to the minute. Predictions are
 * recomputed whenever orbital data or location refreshes and the refined rise time can move by a
 * second or so; rounding keeps screens and reminders attached to the same pass.
 */
export function passId(noradId: string, riseTime: Date): string {
  return `${noradId}-${Math.round(riseTime.getTime() / 60_000)}`;
}

/** Finds a pass by id, tolerating a one-minute shift in the rounded rise time. */
export function findPassById<T extends HasPassIdentity>(passes: T[], id: string): T | undefined {
  const exact = passes.find((p) => p.id === id);
  if (exact) return exact;

  const separator = id.lastIndexOf('-');
  if (separator < 0) return undefined;
  const noradId = id.slice(0, separator);
  const minute = Number(id.slice(separator + 1));
  if (!Number.isFinite(minute)) return undefined;

  const target = minute * 60_000;
  return passes.find((p) => p.noradId === noradId && Math.abs(p.riseTime.getTime() - target) <= 90_000);
}
