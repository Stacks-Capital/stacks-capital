import type { StacksNetwork } from "@stacks-capital/core";

/** Everything cached belongs to one network, one address, and optionally one tenant. Nothing is shared across either. */
export type Scope = { network: StacksNetwork; address: string | null; tenantId?: string | null };

export type EntryStatus = "idle" | "loading" | "ready" | "error";
export type Entry<T> = {
  status: EntryStatus;
  data: T | undefined;
  error: unknown;
  /** When the data was stored, by the cache's clock. */
  updatedAt: number | undefined;
};

export const RESOURCES = {
  markets: "markets",
  capabilities: "capabilities",
  workflow: "workflow",
  positions: "positions",
  quote: "quote",
  portfolio: "portfolio",
  earnPerformance: "earnPerformance",
  prices: "prices",
  priceValuations: "priceValuations",
  earnOptions: "earnOptions",
  risk: "risk",
  swapMarkets: "swapMarkets",
  swapQuotes: "swapQuotes",
} as const;

export type Resource = (typeof RESOURCES)[keyof typeof RESOURCES] | (string & {});

const IDLE: Entry<never> = { status: "idle", data: undefined, error: undefined, updatedAt: undefined };
export const DEFAULT_STALE_MS = 30_000;

export function scopeKey(scope: Scope): string {
  const tenantPrefix = scope.tenantId ? `${scope.tenantId}|` : "";
  return `${tenantPrefix}${scope.network}|${scope.address ?? "anonymous"}`;
}

export function sameScope(left: Scope, right: Scope): boolean {
  return (
    left.network === right.network &&
    left.address === right.address &&
    (left.tenantId ?? null) === (right.tenantId ?? null)
  );
}

export function cacheKey(scope: Scope, resource: Resource, params: Record<string, unknown> = {}): string {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([name, value]) => `${name}=${String(value)}`)
    .join("&");
  return `${scopeKey(scope)}|${resource}${query === "" ? "" : `?${query}`}`;
}

export type LoadOptions = { staleMs?: number; force?: boolean; signal?: AbortSignal | undefined };

export type Cache = {
  get<T>(key: string): Entry<T>;
  subscribe(key: string, listener: () => void): () => void;
  load<T>(key: string, loader: (signal?: AbortSignal) => Promise<T>, options?: LoadOptions): Promise<T>;
  set<T>(key: string, data: T): void;
  /** Drops every entry whose key matches, so the next read starts from the network. */
  invalidate(match: (key: string) => boolean): number;
  /** Keeps only this network and address. Used when the wallet or network changes. */
  keepScope(scope: Scope): number;
  /** A quote is bound to one address and expires, so a wallet switch must not leave one behind (page 01). */
  dropQuotes(): number;
  keys(): string[];
};

export function createCache(options: { now?: () => number; staleMs?: number } = {}): Cache {
  const now = options.now ?? Date.now;
  const defaultStaleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const entries = new Map<string, Entry<unknown>>();
  const listeners = new Map<string, Set<() => void>>();
  const inFlight = new Map<string, Promise<unknown>>();

  const notify = (key: string) => {
    for (const listener of listeners.get(key) ?? []) listener();
  };

  const write = (key: string, entry: Entry<unknown>) => {
    entries.set(key, entry);
    notify(key);
  };

  const cache: Cache = {
    get<T>(key: string): Entry<T> {
      return (entries.get(key) as Entry<T> | undefined) ?? (IDLE as Entry<T>);
    },

    subscribe(key, listener) {
      const set = listeners.get(key) ?? new Set();
      set.add(listener);
      listeners.set(key, set);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(key);
      };
    },

    async load<T>(key: string, loader: (signal?: AbortSignal) => Promise<T>, load: LoadOptions = {}) {
      const entry = cache.get<T>(key);
      const staleMs = load.staleMs ?? defaultStaleMs;
      const fresh = entry.status === "ready" && entry.updatedAt !== undefined && now() - entry.updatedAt < staleMs;
      if (fresh && load.force !== true) return entry.data as T;

      // One request per key: a second caller joins the first instead of asking again.
      const running = inFlight.get(key) as Promise<T> | undefined;
      if (running !== undefined) return running;

      write(key, { ...entry, status: "loading", error: undefined });
      const pending = loader(load.signal)
        .then((data) => {
          // An entry dropped while loading (a wallet switch) must not come back.
          if (inFlight.get(key) === pending) write(key, { status: "ready", data, error: undefined, updatedAt: now() });
          return data;
        })
        .catch((error: unknown) => {
          if (inFlight.get(key) === pending) {
            write(key, { status: "error", data: cache.get<T>(key).data, error, updatedAt: undefined });
          }
          throw error;
        })
        .finally(() => {
          if (inFlight.get(key) === pending) inFlight.delete(key);
        });

      inFlight.set(key, pending);
      return pending;
    },

    set<T>(key: string, data: T) {
      write(key, { status: "ready", data, error: undefined, updatedAt: now() });
    },

    invalidate(match) {
      let dropped = 0;
      for (const key of [...entries.keys()]) {
        if (!match(key)) continue;
        entries.delete(key);
        inFlight.delete(key);
        dropped += 1;
        notify(key);
      }
      return dropped;
    },

    keepScope(scope) {
      const prefix = `${scopeKey(scope)}|`;
      return cache.invalidate((key) => !key.startsWith(prefix));
    },

    dropQuotes() {
      return cache.invalidate((key) => key.includes(`|${RESOURCES.quote}`));
    },

    keys() {
      return [...entries.keys()];
    },
  };

  return cache;
}
