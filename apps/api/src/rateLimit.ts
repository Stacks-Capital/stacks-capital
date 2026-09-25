import { createClient } from "redis";
import { ApiError } from "./errors.ts";

export type RateDecision = { allowed: boolean; limit: number; remaining: number; resetSeconds: number };

export interface RateLimiter {
  hit(bucket: string, limit: number, windowSeconds: number, now: Date): Promise<RateDecision>;
}

// Requests per window for each kind of caller.
export type RateLimits = { key: number; session: number; client: number; windowSeconds: number };
export const DEFAULT_RATE_LIMITS: RateLimits = { key: 600, session: 600, client: 60, windowSeconds: 60 };

// Fixed windows: every caller's window starts on the same boundary, so a counter key never needs cleanup logic.
function windowOf(now: Date, windowSeconds: number) {
  const index = Math.floor(now.getTime() / 1000 / windowSeconds);
  const resetSeconds = Math.max(1, Math.ceil((index + 1) * windowSeconds - now.getTime() / 1000));
  return { index, resetSeconds };
}

function decide(count: number, limit: number, resetSeconds: number): RateDecision {
  return { allowed: count <= limit, limit, remaining: Math.max(0, limit - count), resetSeconds };
}

// For tests and single process development only. Counters are not shared between processes.
export function memoryLimiter(): RateLimiter {
  const counts = new Map<string, number>();
  return {
    async hit(bucket, limit, windowSeconds, now) {
      const { index, resetSeconds } = windowOf(now, windowSeconds);
      const key = `${bucket}:${index}`;
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return decide(count, limit, resetSeconds);
    },
  };
}

// Commands fail at once while Redis is disconnected instead of queueing, and the limiter turns that into a 503.
export function redisClient(url: string) {
  const client = createClient({
    url,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: 2_000,
      reconnectStrategy: (retries) => Math.min(100 * 2 ** retries, 5_000),
    },
  });
  client.on("error", () => {});
  return client;
}

// Covers a connection that is open but not answering, which the offline queue setting does not.
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Redis did not answer in time")), ms);
  });
  work.catch(() => {});
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export type RedisConnection = ReturnType<typeof redisClient>;

export function redisLimiter(client: RedisConnection, prefix = "stacks-capital:rl", timeoutMs = 1_000): RateLimiter {
  return {
    async hit(bucket, limit, windowSeconds, now) {
      const { index, resetSeconds } = windowOf(now, windowSeconds);
      const key = `${prefix}:${bucket}:${index}`;
      try {
        const counted = client.multi().incr(key).expire(key, windowSeconds, "NX").exec();
        const [count] = await withTimeout(counted, timeoutMs);
        return decide(Number(count), limit, resetSeconds);
      } catch {
        // Fail closed: without a working counter no request is let through.
        throw new ApiError("TEMPORARY_UNAVAILABLE", "Rate limiting is unavailable, try again shortly", 1);
      }
    },
  };
}
