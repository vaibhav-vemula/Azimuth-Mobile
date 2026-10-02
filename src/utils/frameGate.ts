/**
 * Lets at most one event through per `minIntervalMs`. Used to cap how often the UI re-renders from the
 * spectrum stream, so a slow device drops frames instead of falling behind and freezing.
 */
export function createFrameGate(minIntervalMs: number, now: () => number = Date.now): () => boolean {
  let last = Number.NEGATIVE_INFINITY;
  return () => {
    const t = now();
    if (t - last >= minIntervalMs) {
      last = t;
      return true;
    }
    return false;
  };
}
