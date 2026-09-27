import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion.ts";

/** Counts down and loops, the way a live quote expiry does. */
export function useCountdown(from: number): number {
  const [seconds, setSeconds] = useState(from);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (reduced) return;
    const timer = setInterval(() => setSeconds((value) => (value <= 1 ? from : value - 1)), 1000);
    return () => clearInterval(timer);
  }, [from, reduced]);

  return seconds;
}
