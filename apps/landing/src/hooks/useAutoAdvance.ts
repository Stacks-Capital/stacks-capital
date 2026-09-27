import { useCallback, useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion.ts";

/**
 * Cycles an index on an interval, and restarts the clock when something is picked by hand so a
 * deliberate choice is never yanked away half a second later.
 */
export function useAutoAdvance(count: number, intervalMs: number): [number, (next: number) => void] {
  const [index, setIndex] = useState(0);
  const reduced = usePrefersReducedMotion();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const countRef = useRef(count);
  countRef.current = count;

  const start = useCallback(() => {
    if (timer.current !== null) clearInterval(timer.current);
    if (reduced) return;
    timer.current = setInterval(() => setIndex((current) => (current + 1) % countRef.current), intervalMs);
  }, [intervalMs, reduced]);

  useEffect(() => {
    start();
    return () => {
      if (timer.current !== null) clearInterval(timer.current);
    };
  }, [start]);

  const select = useCallback(
    (next: number) => {
      setIndex(next);
      start();
    },
    [start],
  );

  return [index, select];
}
