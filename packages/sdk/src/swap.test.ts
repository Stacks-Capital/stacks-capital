import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CapitalClient, Result, SwapMarketCatalog, SwapOffer, SwapQuoteComparison } from "@stacks-capital/client";
import {
  assertSwapWalletCall,
  compareSwaps,
  recommendedSwapOffer,
  selectSwapOffer,
  swapMarketRows,
  swapOfferExpired,
} from "./swap.ts";

const NOW = new Date("2026-09-24T10:00:00.000Z");

function offer(provider: SwapOffer["provider"], rank: number, extras: Partial<SwapOffer> = {}): SwapOffer {
  return {
    provider,
    rank,
    status: "quote_only",
    inputAsset: "stacks:mainnet:native:stx",
    outputAsset: "stacks:mainnet:contract:SM3.sbtc-token:sbtc-token",
    amountIn: "1000000",
    amountOut: "370",
    minimumAmountOut: "368",
    fee: null,
    priceImpactBps: null,
    route: [`SP.${provider}`],
    targetContract: `SP.${provider}`,
    observedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 30_000).toISOString(),
    evidenceSource: `${provider}-fixture`,
    executionReason: "fixture",
    ...extras,
  };
}

const comparison: SwapQuoteComparison = {
  assets: [],
  offers: [offer("velar", 1, { amountOut: "370", minimumAmountOut: "368" }), offer("bitflow", 2)],
  unavailable: [{ provider: "alex", reason: "This pair is not listed" }],
};

describe("swap comparison helpers", () => {
  it("recommends the first ranked offer and keeps an optional override", () => {
    assert.equal(recommendedSwapOffer(comparison)?.provider, "velar");
    assert.equal(selectSwapOffer(comparison)?.provider, "velar");
    assert.equal(selectSwapOffer(comparison, "bitflow")?.provider, "bitflow");
    assert.equal(selectSwapOffer(comparison, "alex")?.provider, "velar");
  });

  it("lists recommended quotes before unavailable venues", () => {
    const rows = swapMarketRows(comparison);
    assert.deepEqual(
      rows.map((row) => (row.kind === "offer" ? [row.offer.provider, row.recommended] : [row.provider, false])),
      [
        ["velar", true],
        ["bitflow", false],
        ["alex", false],
      ],
    );
  });

  it("treats a quote at or past expiry as expired", () => {
    const live = offer("velar", 1);
    assert.equal(swapOfferExpired(live, NOW), false);
    assert.equal(swapOfferExpired(live, new Date(NOW.getTime() + 30_000)), true);
  });

  it("refuses to expose a wallet call that is not on the offer", () => {
    assert.throws(() => assertSwapWalletCall(offer("velar", 1)), /signable swap call/);
    const call = {
      contractId: "SP.router",
      functionName: "swap-simple-multi",
      functionArgs: ["0x0b"],
      postConditions: [{ type: "stx-postcondition" as const, address: "SP1", condition: "lte" as const, amount: "1" }],
      postConditionMode: "deny" as const,
      network: "mainnet" as const,
    };
    assert.equal(assertSwapWalletCall(offer("bitflow", 2, { walletCall: call })), call);
  });

  it("loads the catalog and comparison through the HTTP client", async () => {
    const catalog: Result<SwapMarketCatalog> = {
      data: {
        items: [
          {
            key: "stx",
            assetId: "stacks:mainnet:native:stx",
            symbol: "STX",
            name: "Stacks",
            decimals: 6,
            providers: ["bitflow", "velar"],
          },
        ],
        sources: {
          bitflow: { status: "ok", count: 1, reason: null },
          velar: { status: "ok", count: 1, reason: null },
          alex: { status: "unavailable", count: 0, reason: "timeout" },
        },
      },
      context: {
        requestId: "req_1",
        network: "mainnet",
        observedAt: NOW.toISOString(),
        stale: false,
        warnings: [],
      },
    };
    const quoted: Result<SwapQuoteComparison> = { data: comparison, context: catalog.context };
    const client = {
      swapMarkets: async () => catalog,
      swapQuotes: async (input: { owner?: string; slippageBps?: number }) => {
        assert.equal(input.owner, "SP1");
        assert.equal(input.slippageBps, 50);
        return quoted;
      },
    } as unknown as CapitalClient;

    const result = await compareSwaps({
      client,
      inputAsset: "stacks:mainnet:native:stx",
      outputAsset: "stacks:mainnet:contract:SM3.sbtc-token:sbtc-token",
      amount: "1000000",
      slippageBps: 50,
      owner: "SP1",
      provider: "bitflow",
    });
    assert.equal(result.catalog.data.items[0]?.symbol, "STX");
    assert.equal(result.recommended?.provider, "velar");
    assert.equal(result.selected?.provider, "bitflow");
    assert.equal(result.rows.length, 3);
  });
});
