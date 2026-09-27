import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchPublicSpotQuotes, pickUsdQuote, scaledPriceFromDecimal, usableUsdQuote } from "./spotPrices.ts";

describe("Public spot dollar quotes", () => {
  it("scales a live decimal price to the same 8-decimal integer the oracle uses", () => {
    assert.equal(scaledPriceFromDecimal("110000.25"), "11000025000000");
    assert.equal(scaledPriceFromDecimal("0"), null);
    assert.equal(scaledPriceFromDecimal("not-a-price"), null);
  });

  it("prefers a usable oracle quote and falls back to the public spot", () => {
    const oracle = [{ feedKey: "BTC/USD", price: null, scale: 8, status: "stale" as const }];
    const spot = [{ feedKey: "BTC/USD", price: "11000000000000", scale: 8, source: "coinbase-spot" }];
    assert.equal(usableUsdQuote(oracle[0]), false);
    assert.equal(pickUsdQuote("BTC/USD", oracle, spot)?.price, "11000000000000");
    assert.equal(
      pickUsdQuote("BTC/USD", [{ feedKey: "BTC/USD", price: "7000000000000", scale: 8 }], spot)?.price,
      "7000000000000",
    );
    assert.equal(pickUsdQuote("ALEX/USD", oracle, spot), undefined);
  });

  it("reads Coinbase spots and maps sBTC onto BTC", async () => {
    const fetchImpl = async (url: string | URL | Request) => {
      const href = String(url);
      const amount = href.includes("BTC-USD") ? "110000.00" : href.includes("STX-USD") ? "0.65" : "1.00";
      return new Response(JSON.stringify({ data: { amount } }), { status: 200 });
    };
    const quotes = await fetchPublicSpotQuotes(fetchImpl as typeof fetch);
    const btc = quotes.find((item) => item.feedKey === "BTC/USD");
    const sbtc = quotes.find((item) => item.feedKey === "sBTC/USD");
    const stx = quotes.find((item) => item.feedKey === "STX/USD");
    assert.equal(btc?.price, "11000000000000");
    assert.equal(sbtc?.price, "11000000000000");
    assert.equal(stx?.price, "65000000");
  });
});
