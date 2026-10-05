import { useEffect, useRef, useState } from 'react';

/**
 * A value that follows `value` but changes at most once every `ms`, always ending on the latest. Used for work that is
 * expensive and does not need to keep pace with every change, like redrawing the fog while you walk.
 */
export function useThrottled<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    const wait = Math.max(0, last.current + ms - Date.now());
    const timer = setTimeout(() => {
      last.current = Date.now();
      setShown(value);
    }, wait);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return shown;
}
