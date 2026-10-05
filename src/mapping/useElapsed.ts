import { useEffect, useState } from 'react';

/** Seconds since `startedAtMs`, refreshed every second; 0 when there is no start time. */
export function useElapsed(startedAtMs: number | null): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startedAtMs) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAtMs]);
  return startedAtMs ? Math.max(0, (now - startedAtMs) / 1000) : 0;
}
