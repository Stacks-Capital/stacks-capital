import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  type Cache,
  type CapitalClient,
  cacheKey,
  createCache,
  type Market,
  type Page,
  RESOURCES,
} from "@stacks-capital/client";
import { JSDOM } from "jsdom";
import { createElement, type ReactNode } from "react";
import { CapitalProvider } from "./context.ts";
import {
  useEarnPerformance,
  useMarkets,
  usePortfolio,
  usePriceValuations,
  useSwapMarkets,
  useSwapQuotes,
  useWorkflow,
  useWorkflowResume,
} from "./hooks.ts";

// React needs a document. jsdom gives one without a browser.
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>");
const globals = globalThis as unknown as Record<string, unknown>;
globals.window = dom.window;
globals.document = dom.window.document;
// navigator is a getter on globalThis, so it needs defineProperty rather than assignment.
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globals.IS_REACT_ACT_ENVIRONMENT = true;

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");

after(() => dom.window.close());

const MARKET: Market = {
  id: "zest.sbtc.vault",
  network: "mainnet",
  protocol: "zest",
  suppliedAssetId: null,
  receiptAssetId: null,
  capabilities: [],
};

const page = (id: string): Page<Market> => ({
  items: [{ ...MARKET, id }],
  nextCursor: null,
  context: {
    requestId: "req_1",
    network: "mainnet",
    observedAt: "2026-09-18T09:00:00.000Z",
    stale: false,
    warnings: [],
  },
});

function fakeClient(overrides: Partial<CapitalClient> = {}): CapitalClient {
  const client = {
    network: "mainnet" as const,
    hasSession: false,
    markets: async () => page("zest.sbtc.vault"),
    allMarkets: async () => [MARKET],
    capabilities: async () => ({ items: [], nextCursor: null, context: page("x").context }),
    workflow: async (id: string) =>
      ({
        data: {
          id,
          network: "mainnet",
          state: "AWAITING_SIGNATURE",
          nextAction: "SIGN_STEP",
          transitions: [],
          idempotencyKey: "idem_1",
        },
        context: page("x").context,
      }) as never,
    challenge: async () => ({ data: { nonceId: "non_1" }, context: page("x").context }),
    verify: async () => ({ data: { token: "ses_1.secret" }, context: page("x").context }),
    portfolio: async () =>
      ({
        data: {
          totalAssets: { quantity: "1000", asset: "sbtc" },
          totalDebt: { quantity: "0", asset: "sbtc" },
          netWorth: { quantity: "1000", asset: "sbtc" },
          categories: [],
          collateralValuations: [],
        },
        context: page("x").context,
      }) as never,
    earnPerformance: async () =>
      ({
        data: {
          items: [
            {
              marketId: "zest.sbtc.vault",
              realizedEarnings: { quantity: "50", asset: "sbtc" },
              claimedRewards: [],
              accruedEstimates: [],
            },
          ],
        },
        context: page("x").context,
      }) as never,
    priceValuations: async () =>
      ({
        data: {
          items: [
            {
              asset: "sbtc",
              referencePriceUsd: "60000",
              sources: [],
              spreadBps: "5",
              stale: false,
            },
          ],
        },
        context: page("x").context,
      }) as never,
    withSession: () => client,
    ...overrides,
  } as unknown as CapitalClient;
  return client;
}

/** Renders a tree and returns helpers to change its props and read what the hook produced. */
function mount(
  element: (props: { address: string | null; tenantId?: string | null }) => ReactNode,
  address: string | null = "SP1",
  tenantId?: string | null,
) {
  const container = dom.window.document.createElement("div");
  const root = createRoot(container);
  const render = (next: string | null, nextTenant?: string | null) =>
    act(
      () => void root.render(element({ address: next, ...(nextTenant !== undefined ? { tenantId: nextTenant } : {}) })),
    );
  render(address, tenantId);
  return {
    async set(next: string | null, nextTenant?: string | null) {
      render(next, nextTenant);
      await act(async () => {});
    },
    async settle() {
      await act(async () => {});
    },
    unmount() {
      act(() => root.unmount());
    },
  };
}

function harness(
  client: CapitalClient,
  cache: Cache,
  useHook: () => unknown,
  options?: { tenantId?: string | null; address?: string | null },
) {
  const results: unknown[] = [];
  const Probe = () => {
    results.push(useHook());
    return null;
  };
  const view = mount(
    ({ address, tenantId }) =>
      createElement(
        CapitalProvider,
        {
          client,
          cache,
          address,
          ...(tenantId !== undefined
            ? { tenantId }
            : options?.tenantId !== undefined
              ? { tenantId: options.tenantId }
              : {}),
        },
        createElement(Probe, null),
      ),
    options && "address" in options ? options.address : "SP1",
    options?.tenantId,
  );
  return { results, view, last: () => results.at(-1) };
}

type MarketsResult = { status: string; data?: Page<Market>; isLoading: boolean; refresh: () => Promise<void> };

describe("useMarkets", () => {
  it("loads once and shares the entry with the cache", async () => {
    const cache = createCache();
    let calls = 0;
    const client = fakeClient({
      markets: async () => {
        calls += 1;
        return page("zest.sbtc.vault");
      },
    });

    const { view, last } = harness(client, cache, () => useMarkets());
    assert.equal((last() as MarketsResult).status, "loading");
    await view.settle();

    const result = last() as MarketsResult;
    assert.equal(result.status, "ready");
    assert.deepEqual(
      result.data?.items.map((market) => market.id),
      ["zest.sbtc.vault"],
    );
    assert.equal(calls, 1);
    assert.equal(cache.get(cacheKey({ network: "mainnet", address: "SP1" }, "markets")).status, "ready");
    view.unmount();
  });

  it("reads again when asked to refresh", async () => {
    const cache = createCache();
    let calls = 0;
    const client = fakeClient({
      markets: async () => {
        calls += 1;
        return page(`market_${calls}`);
      },
    });

    const { view, last } = harness(client, cache, () => useMarkets());
    await view.settle();
    await act(async () => {
      await (last() as MarketsResult).refresh();
    });
    assert.equal(calls, 2);
    assert.deepEqual(
      (last() as MarketsResult).data?.items.map((market) => market.id),
      ["market_2"],
    );
    view.unmount();
  });

  it("reports a failed read without losing the last good data", async () => {
    const cache = createCache({ staleMs: 0 });
    let calls = 0;
    const client = fakeClient({
      markets: async () => {
        calls += 1;
        if (calls > 1) throw new Error("provider down");
        return page("zest.sbtc.vault");
      },
    });

    const { view, last } = harness(client, cache, () => useMarkets());
    await view.settle();
    await act(async () => {
      await (last() as MarketsResult).refresh();
    });
    const result = last() as MarketsResult & { error?: Error };
    assert.equal(result.status, "error");
    assert.deepEqual(
      result.data?.items.map((market) => market.id),
      ["zest.sbtc.vault"],
    );
    assert.match(result.error?.message ?? "", /provider down/);
    view.unmount();
  });
});

describe("cache isolation", () => {
  it("gives each address its own entry and forgets the old one on a wallet switch", async () => {
    const cache = createCache();
    const seen: string[] = [];
    const client = fakeClient({
      markets: async () => {
        seen.push("read");
        return page("zest.sbtc.vault");
      },
    });

    const { view } = harness(client, cache, () => useMarkets());
    await view.settle();
    assert.deepEqual(cache.keys(), [cacheKey({ network: "mainnet", address: "SP1" }, "markets")]);

    await view.set("SP2");
    // The new address reads for itself, and the old address's entry is gone.
    assert.deepEqual(cache.keys(), [cacheKey({ network: "mainnet", address: "SP2" }, "markets")]);
    assert.equal(seen.length, 2);
    view.unmount();
  });

  it("drops a quote from the previous wallet", async () => {
    const cache = createCache();
    const quoteKey = cacheKey({ network: "mainnet", address: "SP1" }, "quote", { marketId: "zest.sbtc.vault" });
    cache.set(quoteKey, { id: "quote_for_SP1" });

    const { view } = harness(fakeClient(), cache, () => useMarkets());
    await view.settle();
    assert.equal(cache.get(quoteKey).status, "ready");

    await view.set("SP2");
    assert.equal(cache.get(quoteKey).status, "idle");
    view.unmount();
  });

  it("keeps signed out data separate from a signed in address", async () => {
    const cache = createCache();
    const { view } = harness(fakeClient(), cache, () => useMarkets());
    await view.settle();

    await view.set(null);
    assert.deepEqual(cache.keys(), [cacheKey({ network: "mainnet", address: null }, "markets")]);
    view.unmount();
  });
});

describe("useWorkflow", () => {
  it("waits until there is an id to read", async () => {
    const cache = createCache();
    let calls = 0;
    const client = fakeClient({
      workflow: async (id: string) => {
        calls += 1;
        return { data: { id }, context: page("x").context } as never;
      },
    });

    let id: string | null = null;
    const { view, last } = harness(client, cache, () => useWorkflow(id));
    await view.settle();
    assert.equal((last() as MarketsResult).status, "idle");
    assert.equal(calls, 0);

    id = "wf_1";
    await view.set("SP1");
    assert.equal(calls, 1);
    assert.equal(
      cache.get(cacheKey({ network: "mainnet", address: "SP1" }, "workflow", { id: "wf_1" })).status,
      "ready",
    );
    view.unmount();
  });
});

describe("refresh", () => {
  it("acts on the current key even when called from an earlier render", async () => {
    const cache = createCache({ staleMs: 60_000 });
    const reads: (string | undefined)[] = [];
    const client = fakeClient({
      workflow: async (id: string) => {
        reads.push(id);
        return { data: { id, state: `read ${reads.length}` }, context: page("x").context } as never;
      },
    });

    let id: string | null = null;
    const { view, results } = harness(client, cache, () => useWorkflow(id));
    await view.settle();
    // Keep the refresh from a render where there was no workflow yet, as an async handler would.
    const staleRefresh = (results.at(-1) as MarketsResult).refresh;

    id = "wf_7";
    await view.set("SP1");
    assert.deepEqual(reads, ["wf_7"]);

    await act(async () => {
      await staleRefresh();
    });
    assert.deepEqual(reads, ["wf_7", "wf_7"]);
    view.unmount();
  });
});

describe("provider", () => {
  it("refuses to work outside a provider", () => {
    const Probe = () => {
      useMarkets();
      return null;
    };
    assert.throws(() => mount(() => createElement(Probe, null)), /must be used inside a CapitalProvider/);
  });
});

describe("usePortfolio", () => {
  it("loads portfolio for current address and caches it under portfolio resource", async () => {
    const cache = createCache();
    let calls = 0;
    const client = fakeClient({
      portfolio: async (input) => {
        calls += 1;
        assert.equal(input?.owner, undefined);
        return {
          data: {
            totalAssets: { quantity: "5000", asset: "sbtc" },
            totalDebt: { quantity: "1000", asset: "sbtc" },
            netWorth: { quantity: "4000", asset: "sbtc" },
            categories: [],
            collateralValuations: [],
          },
          context: page("x").context,
        } as never;
      },
    });

    const { view, last } = harness(client, cache, () => usePortfolio());
    await view.settle();

    const result = last() as { status: string; data?: { data: { netWorth: { quantity: string } } } };
    assert.equal(result.status, "ready");
    assert.equal(result.data?.data.netWorth.quantity, "4000");
    assert.equal(calls, 1);
    assert.equal(
      cache.get(cacheKey({ network: "mainnet", address: "SP1" }, RESOURCES.portfolio, { owner: "SP1" })).status,
      "ready",
    );
    view.unmount();
  });

  it("allows custom owner override", async () => {
    const cache = createCache();
    let requestedOwner = "";
    const client = fakeClient({
      portfolio: async (input) => {
        requestedOwner = input?.owner ?? "";
        return {
          data: {
            totalAssets: { quantity: "10000", asset: "sbtc" },
            totalDebt: { quantity: "0", asset: "sbtc" },
            netWorth: { quantity: "10000", asset: "sbtc" },
            categories: [],
            collateralValuations: [],
          },
          context: page("x").context,
        } as never;
      },
    });

    const { view } = harness(client, cache, () => usePortfolio({ owner: "SP_CUSTOM" }));
    await view.settle();

    assert.equal(requestedOwner, "SP_CUSTOM");
    assert.equal(
      cache.get(cacheKey({ network: "mainnet", address: "SP1" }, RESOURCES.portfolio, { owner: "SP_CUSTOM" })).status,
      "ready",
    );
    view.unmount();
  });

  it("stays idle when address is null and no owner is provided", async () => {
    const cache = createCache();
    let calls = 0;
    const client = fakeClient({
      portfolio: async () => {
        calls += 1;
        return {} as never;
      },
    });

    const { view, last } = harness(client, cache, () => usePortfolio(), { address: null });
    await view.settle();

    const result = last() as { status: string };
    assert.equal(result.status, "idle");
    assert.equal(calls, 0);
    view.unmount();
  });
});

describe("useEarnPerformance", () => {
  it("loads earn performance for address and marketId", async () => {
    const cache = createCache();
    let queryInput: { owner?: string; marketId?: string } | undefined;
    const client = fakeClient({
      earnPerformance: async (input) => {
        queryInput = input;
        return {
          data: {
            items: [
              {
                marketId: "zest.sbtc.vault",
                realizedEarnings: { quantity: "75", asset: "sbtc" },
                claimedRewards: [],
                accruedEstimates: [],
              },
            ],
          },
          context: page("x").context,
        } as never;
      },
    });

    const { view, last } = harness(client, cache, () => useEarnPerformance({ marketId: "zest.sbtc.vault" }));
    await view.settle();

    const result = last() as {
      status: string;
      data?: { data: { items: { realizedEarnings: { quantity: string } }[] } };
    };
    assert.equal(result.status, "ready");
    assert.equal(result.data?.data.items[0]?.realizedEarnings.quantity, "75");
    assert.equal(queryInput?.marketId, "zest.sbtc.vault");
    assert.equal(
      cache.get(
        cacheKey({ network: "mainnet", address: "SP1" }, RESOURCES.earnPerformance, {
          owner: "SP1",
          marketId: "zest.sbtc.vault",
        }),
      ).status,
      "ready",
    );
    view.unmount();
  });
});

describe("usePriceValuations", () => {
  it("loads asset price valuations into cache", async () => {
    const cache = createCache();
    let calls = 0;
    const client = fakeClient({
      priceValuations: async () => {
        calls += 1;
        return {
          data: {
            items: [
              {
                asset: "sbtc",
                referencePriceUsd: "65000",
                sources: [],
                spreadBps: "4",
                stale: false,
              },
            ],
          },
          context: page("x").context,
        } as never;
      },
    });

    const { view, last } = harness(client, cache, () => usePriceValuations());
    await view.settle();

    const result = last() as { status: string; data?: { data: { items: { referencePriceUsd: string }[] } } };
    assert.equal(result.status, "ready");
    assert.equal(result.data?.data.items[0]?.referencePriceUsd, "65000");
    assert.equal(calls, 1);
    assert.equal(
      cache.get(cacheKey({ network: "mainnet", address: "SP1" }, RESOURCES.priceValuations)).status,
      "ready",
    );
    view.unmount();
  });
});

describe("useWorkflowResume", () => {
  it("calculates resume hint for active workflow in AWAITING_SIGNATURE", async () => {
    const cache = createCache();
    const client = fakeClient({
      workflow: async (id: string) =>
        ({
          data: {
            id,
            network: "mainnet",
            state: "AWAITING_SIGNATURE",
            nextAction: "SIGN_STEP",
            transitions: [],
            idempotencyKey: "idem_resume_1",
          },
          context: page("x").context,
        }) as never,
    });

    const { view, last } = harness(client, cache, () => useWorkflowResume("wf_active_1"));
    await view.settle();

    const result = last() as ReturnType<typeof useWorkflowResume>;
    assert.equal(result.workflow.status, "ready");
    assert.equal(result.isResuming, true);
    assert.equal(result.canSign, true);
    assert.equal(result.isTerminal, false);
    assert.equal(result.hint?.state, "AWAITING_SIGNATURE");
    assert.equal(result.hint?.nextAction, "SIGN_STEP");
    view.unmount();
  });

  it("identifies terminal state for COMPLETED workflow", async () => {
    const cache = createCache();
    const client = fakeClient({
      workflow: async (id: string) =>
        ({
          data: {
            id,
            network: "mainnet",
            state: "COMPLETED",
            nextAction: "NONE",
            transitions: [],
            idempotencyKey: "idem_done",
          },
          context: page("x").context,
        }) as never,
    });

    const { view, last } = harness(client, cache, () => useWorkflowResume("wf_done_1"));
    await view.settle();

    const result = last() as ReturnType<typeof useWorkflowResume>;
    assert.equal(result.workflow.status, "ready");
    assert.equal(result.isResuming, false);
    assert.equal(result.canSign, false);
    assert.equal(result.isTerminal, true);
    assert.equal(result.hint?.terminal, true);
    view.unmount();
  });

  it("handles null id cleanly", async () => {
    const cache = createCache();
    const client = fakeClient();
    const { view, last } = harness(client, cache, () => useWorkflowResume(null));
    await view.settle();

    const result = last() as ReturnType<typeof useWorkflowResume>;
    assert.equal(result.workflow.status, "idle");
    assert.equal(result.hint, null);
    assert.equal(result.isResuming, false);
    assert.equal(result.canSign, false);
    assert.equal(result.isTerminal, false);
    view.unmount();
  });
});

describe("tenant isolation in hooks", () => {
  it("isolates cache keys by tenantId in CapitalProvider", async () => {
    const cache = createCache();
    const client = fakeClient();

    const { view: viewA } = harness(client, cache, () => useMarkets(), { tenantId: "tenant_alpha" });
    await viewA.settle();

    const { view: viewB } = harness(client, cache, () => useMarkets(), { tenantId: "tenant_beta" });
    await viewB.settle();

    assert.deepEqual(cache.keys().sort(), [
      cacheKey({ network: "mainnet", address: "SP1", tenantId: "tenant_alpha" }, "markets"),
      cacheKey({ network: "mainnet", address: "SP1", tenantId: "tenant_beta" }, "markets"),
    ]);

    viewA.unmount();
    viewB.unmount();
  });

  it("derives tenantId from client.clientId when not passed explicitly", async () => {
    const cache = createCache();
    const client = fakeClient({ clientId: "tenant_from_client" });

    const { view } = harness(client, cache, () => useMarkets());
    await view.settle();

    assert.deepEqual(cache.keys(), [
      cacheKey({ network: "mainnet", address: "SP1", tenantId: "tenant_from_client" }, "markets"),
    ]);

    view.unmount();
  });
});

describe("useSwapMarkets", () => {
  it("loads the live catalog once", async () => {
    const cache = createCache();
    let calls = 0;
    const client = fakeClient({
      swapMarkets: async () => {
        calls += 1;
        return {
          data: {
            items: [
              {
                key: "stx",
                assetId: "stacks:mainnet:native:stx",
                symbol: "STX",
                name: "Stacks",
                decimals: 6,
                providers: ["bitflow"],
              },
            ],
            sources: {
              bitflow: { status: "ok", count: 1, reason: null },
              velar: { status: "ok", count: 0, reason: null },
              alex: { status: "ok", count: 0, reason: null },
            },
          },
          context: page("x").context,
        };
      },
    });

    const { view, last } = harness(client, cache, () => useSwapMarkets());
    await view.settle();
    const result = last() as { status: string; data?: { data: { items: { symbol: string }[] } } };
    assert.equal(result.status, "ready");
    assert.equal(result.data?.data.items[0]?.symbol, "STX");
    assert.equal(calls, 1);
    assert.equal(cache.get(cacheKey({ network: "mainnet", address: "SP1" }, RESOURCES.swapMarkets)).status, "ready");
    view.unmount();
  });
});

describe("useSwapQuotes", () => {
  it("stays idle until the pair, amount and owner are set", async () => {
    const cache = createCache();
    let calls = 0;
    const client = fakeClient({
      swapQuotes: async () => {
        calls += 1;
        return { data: { assets: [], offers: [], unavailable: [] }, context: page("x").context };
      },
    });

    const { view, last } = harness(
      client,
      cache,
      () =>
        useSwapQuotes({
          inputAsset: "stacks:mainnet:native:stx",
          outputAsset: "stacks:mainnet:contract:SM3.sbtc-token:sbtc-token",
          amount: "0",
        }),
      { address: null },
    );
    await view.settle();
    assert.equal((last() as { status: string }).status, "idle");
    assert.equal(calls, 0);
    view.unmount();
  });

  it("compares venues for the selected pair", async () => {
    const cache = createCache();
    let seenOwner: string | undefined;
    const client = fakeClient({
      swapQuotes: async (input) => {
        seenOwner = input.owner;
        return {
          data: {
            assets: [],
            offers: [
              {
                provider: "velar",
                rank: 1,
                status: "quote_only",
                inputAsset: input.inputAsset,
                outputAsset: input.outputAsset,
                amountIn: input.amount,
                amountOut: "370",
                minimumAmountOut: "368",
                fee: null,
                priceImpactBps: null,
                route: ["SP.velar"],
                targetContract: "SP.velar",
                observedAt: "2026-09-24T10:00:00.000Z",
                expiresAt: "2026-09-24T10:00:30.000Z",
                evidenceSource: "velar-fixture",
                executionReason: "fixture",
              },
            ],
            unavailable: [{ provider: "alex", reason: "This pair is not listed" }],
          },
          context: page("x").context,
        };
      },
    });

    const { view, last } = harness(client, cache, () =>
      useSwapQuotes({
        inputAsset: "stacks:mainnet:native:stx",
        outputAsset: "stacks:mainnet:contract:SM3.sbtc-token:sbtc-token",
        amount: "1000000",
        slippageBps: 50,
      }),
    );
    await view.settle();
    const result = last() as { status: string; data?: { data: { offers: { provider: string }[] } } };
    assert.equal(result.status, "ready");
    assert.equal(result.data?.data.offers[0]?.provider, "velar");
    assert.equal(seenOwner, "SP1");
    assert.equal(
      cache.get(
        cacheKey({ network: "mainnet", address: "SP1" }, RESOURCES.swapQuotes, {
          inputAsset: "stacks:mainnet:native:stx",
          outputAsset: "stacks:mainnet:contract:SM3.sbtc-token:sbtc-token",
          amount: "1000000",
          slippageBps: 50,
          owner: "SP1",
        }),
      ).status,
      "ready",
    );
    view.unmount();
  });
});
