import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlanWire, QuoteWire } from "@stacks-capital/sdk";
import {
  bitcoinDepositBalanceError,
  bitcoinMinerFeeReserve,
  bitcoinSendVsize,
  BTC_BRIDGE_FEE_RESERVE,
  countConfirmedUtxos,
  parseRecommendedFeeRate,
  CANONICAL_SWAP_ASSETS,
  formatExpiryCountdown,
  formatSpotUsd,
  formatUsdFromBase,
  formatUsdFromDisplay,
  fromBaseUnits,
  hiroTokenKey,
  isQuoteSignable,
  maxBridgePaySats,
  maxSwapQuantity,
  priceImpactCategory,
  reconcileSwapAssets,
  spendableBtcSats,
  spendableHiroQuantity,
  STX_SWAP_FEE_RESERVE,
  type SwapViewLike,
  toBaseUnits,
  tokenUsdFeedKey,
  usdHint,
  verifyMinimumOutputEnforcement,
  walletEntryQuantity,
} from "./swapState.ts";

// Canonical asset identifiers, exactly as the signed registry and formatAssetId produce them.
// scripts/checks/web-registry-assets.test.ts pins these principals against packages/config.
const SBTC_MAINNET = "stacks:mainnet:contract:SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token:sbtc-token";
const USDCX_MAINNET = "stacks:mainnet:contract:SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx:usdcx-token";
const NOW = new Date("2026-09-22T12:00:00.000Z");

function sampleQuoteWire(overrides: Partial<QuoteWire> = {}): QuoteWire {
  return {
    id: "q_bitflow_test",
    action: "swap",
    marketId: "bitflow.sbtc-usdcx",
    network: "mainnet",
    input: [{ asset: SBTC_MAINNET, quantity: "10000000" }], // 0.1 sBTC
    expectedOutput: [{ asset: USDCX_MAINNET, quantity: "6500000000" }], // 6500 USDCx
    minimumOutput: { asset: USDCX_MAINNET, quantity: "6467500000" }, // 50 bps slippage
    fees: [],
    snapshots: [],
    warnings: [],
    executable: true,
    expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
    registryVersion: "0.1.0",
    adapterVersion: "bitflow-swap@0.1.0",
    ...overrides,
  };
}

function samplePlanWire(quote: QuoteWire, minOut: string = "6467500000"): PlanWire {
  return {
    id: "p_bitflow_test",
    quoteId: quote.id,
    network: "mainnet",
    registryVersion: "0.1.0",
    adapterVersion: "bitflow-swap@0.1.0",
    expiresAt: quote.expiresAt,
    reviewSummary: "Swap 0.1 sBTC for at least 6467.5 USDCx",
    steps: [
      {
        id: "swap-x-for-y-simple-range-multi",
        dependsOn: [],
        expectedAssetEffects: quote.expectedOutput,
        payload: {
          kind: "stacks_contract_call",
          contractId: "SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-swap-router-v-1-2",
          functionName: "swap-x-for-y-simple-range-multi",
          functionArgs: [
            { type: "principal", value: "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.sbtc-usdcx-dlmm-fixture" },
            { type: "principal", value: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token" },
            { type: "principal", value: "SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx" },
            { type: "uint", value: "10000000" },
            { type: "uint", value: minOut },
            { type: "uint", value: "8" },
            { type: "none" },
          ],
          postConditions: [
            {
              principal: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
              mode: "send_lte",
              amount: quote.input[0] ?? { asset: SBTC_MAINNET, quantity: "10000000" },
            },
            {
              principal: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
              mode: "receive_gte",
              amount: { asset: USDCX_MAINNET, quantity: minOut },
            },
          ],
          postConditionMode: "deny",
          network: "mainnet",
        },
      },
    ],
  };
}

describe("Decimal Conversion Precision (I36)", () => {
  it("converts decimal display amounts to exact base units without float errors", () => {
    assert.equal(toBaseUnits("0.1", 8), "10000000");
    assert.equal(toBaseUnits("0.00000001", 8), "1");
    assert.equal(toBaseUnits("1.5", 6), "1500000");
    assert.equal(toBaseUnits("100", 6), "100000000");
    assert.equal(toBaseUnits("0", 8), "0");
  });

  it("converts base units to formatted decimal strings cleanly", () => {
    assert.equal(fromBaseUnits("10000000", 8), "0.1");
    assert.equal(fromBaseUnits("1", 8), "0.00000001");
    assert.equal(fromBaseUnits("1500000", 6), "1.5");
    assert.equal(fromBaseUnits("100000000", 6), "100");
    assert.equal(fromBaseUnits("0", 8), "0");
  });
});

describe("Asset Reconciliation and Decimal Reconciliation (I36 Acceptance Evidence 3)", () => {
  it("reconciles sBTC (8 decimals) and USDCx (6 decimals) canonical assets exactly", () => {
    const quote = sampleQuoteWire();
    const result = reconcileSwapAssets(quote, "mainnet");

    assert.equal(result.reconciled, true);
    assert.equal(result.sentSymbol, "sBTC");
    assert.equal(result.sentDecimals, 8);
    assert.equal(result.receivedSymbol, "USDCx");
    assert.equal(result.receivedDecimals, 6);
  });

  it("rejects mismatched or unverified contract addresses", () => {
    const invalidQuote = sampleQuoteWire({
      input: [{ asset: "SP_MALICIOUS_ADDRESS.fake-btc", quantity: "10000000" }],
    });
    const result = reconcileSwapAssets(invalidQuote, "mainnet");
    assert.equal(result.reconciled, false);
    assert.match(result.reason ?? "", /Unrecognized asset identifier/);
  });
});

describe("Minimum Output Onchain Enforcement (I36 Acceptance Evidence 2)", () => {
  it("verifies minimum output is enforced in contract call args and deny-mode post-conditions", () => {
    const quote = sampleQuoteWire();
    const plan = samplePlanWire(quote, "6467500000");
    const check = verifyMinimumOutputEnforcement(quote, plan);

    assert.equal(check.enforced, true);
    assert.equal(check.minOutQuantity, "6467500000");
    assert.equal(check.onchainArgVerified, true);
    assert.equal(check.postConditionVerified, true);
    assert.equal(check.denyModeVerified, true);
  });

  it("fails closed when router argument does not match quote minimum output floor", () => {
    const quote = sampleQuoteWire();
    // Tampered plan with minOut of 0 (no protection)
    const tamperedPlan = samplePlanWire(quote, "0");
    const check = verifyMinimumOutputEnforcement(quote, tamperedPlan);

    assert.equal(check.enforced, false);
    assert.equal(check.onchainArgVerified, false);
  });

  it("fails closed when quote has no minimum output", () => {
    const quoteWithoutMin = sampleQuoteWire();
    delete (quoteWithoutMin as { minimumOutput?: unknown }).minimumOutput;
    const plan = samplePlanWire(quoteWithoutMin);
    const check = verifyMinimumOutputEnforcement(quoteWithoutMin, plan);

    assert.equal(check.enforced, false);
    assert.match(check.reason ?? "", /lacks guaranteed minimumOutput/);
  });
});

describe("Expiry and Requote Guards (I36 Acceptance Evidence 1)", () => {
  function makeView(expiresInSeconds: number): SwapViewLike {
    return {
      route: [
        {
          contractId: "SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-swap-router-v-1-2",
          functionName: "swap-x-for-y",
        },
      ],
      sending: "0.1 sBTC",
      expectedReceived: "6500 USDCx",
      minimumReceived: "6467.5 USDCx",
      impactBps: "15",
      impactNote: null,
      expiresInSeconds,
      expired: expiresInSeconds <= 0,
      needsRefresh: expiresInSeconds <= 15,
      warnings: [],
    };
  }

  it("permits signing when quote has ample validity (> 15 seconds)", () => {
    const quote = sampleQuoteWire();
    const plan = samplePlanWire(quote);
    const view = makeView(45);
    assert.equal(isQuoteSignable(view, { quote, plan }, NOW), true);
  });

  it("blocks signing when quote is within refresh margin (<= 15 seconds)", () => {
    const quote = sampleQuoteWire();
    const plan = samplePlanWire(quote);
    const view = makeView(10);
    assert.equal(isQuoteSignable(view, { quote, plan }, NOW), false);
  });

  it("blocks signing when quote has expired (<= 0 seconds)", () => {
    const quote = sampleQuoteWire({
      expiresAt: new Date(NOW.getTime() - 5000).toISOString(),
    });
    const plan = samplePlanWire(quote);
    const view = makeView(0);
    assert.equal(isQuoteSignable(view, { quote, plan }, NOW), false);
  });

  it("formats countdown states accurately", () => {
    assert.deepEqual(formatExpiryCountdown(45), { text: "Quote valid for 45s", status: "valid" });
    assert.deepEqual(formatExpiryCountdown(12), {
      text: "Expires in 12s (Requote required)",
      status: "warning",
    });
    assert.deepEqual(formatExpiryCountdown(0), { text: "Quote expired", status: "expired" });
  });
});

describe("Price Impact Tiers (I36)", () => {
  it("categorizes impact into low, medium, and high correctly", () => {
    assert.equal(priceImpactCategory("25"), "low");
    assert.equal(priceImpactCategory("150"), "medium");
    assert.equal(priceImpactCategory("450"), "high");
    assert.equal(priceImpactCategory(null), "unknown");
  });
});

describe("Swap wallet balances and max amount", () => {
  it("maps native STX and SIP-10 asset ids onto Hiro balance keys", () => {
    assert.equal(hiroTokenKey("stacks:mainnet:native:stx"), "stx");
    assert.equal(
      hiroTokenKey("stacks:mainnet:contract:SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token:sbtc-token"),
      "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token",
    );
    assert.equal(hiroTokenKey("not-an-asset"), null);
  });

  it("reads spendable STX after subtracting locked and treats a missing SIP-10 as zero", () => {
    const response = {
      stx: { balance: "1500000", locked: "500000" },
      fungible_tokens: {
        "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token": { balance: "250000" },
      },
    };
    assert.equal(spendableHiroQuantity("stacks:mainnet:native:stx", response), "1000000");
    assert.equal(
      spendableHiroQuantity(
        "stacks:mainnet:contract:SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token:sbtc-token",
        response,
      ),
      "250000",
    );
    assert.equal(
      spendableHiroQuantity(
        "stacks:mainnet:contract:SP1AY6K3PQV5MRT6R4S671NWW2FRVPKM0BR162CT6.leo-token:leo",
        response,
      ),
      "0",
    );
  });

  it("uses the full SIP-10 balance for Max and leaves a Stacks fee on native STX", () => {
    assert.equal(maxSwapQuantity("stacks:mainnet:native:stx", "15000"), "5000");
    assert.equal(maxSwapQuantity("stacks:mainnet:native:stx", STX_SWAP_FEE_RESERVE), STX_SWAP_FEE_RESERVE);
    assert.equal(
      maxSwapQuantity(
        "stacks:mainnet:contract:SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token:sbtc-token",
        "250000",
      ),
      "250000",
    );
  });

  it("reads a wallet entry from portfolio accounting and ignores receipts", () => {
    assert.equal(
      walletEntryQuantity(
        [
          { category: "supplied", assetId: "stacks:mainnet:native:stx", quantity: "9", isReceipt: false },
          { category: "wallet", assetId: "stacks:mainnet:native:stx", quantity: "42", isReceipt: false },
          { category: "wallet", assetId: "stacks:mainnet:native:stx", quantity: "1", isReceipt: true },
        ],
        "stacks:mainnet:native:stx",
      ),
      "42",
    );
    assert.equal(walletEntryQuantity([], "stacks:mainnet:native:stx"), null);
  });
});

describe("Bridge wallet balances and max amount", () => {
  it("sums confirmed Bitcoin UTXOs and ignores unconfirmed ones", () => {
    assert.equal(
      spendableBtcSats([
        { value: "2000", status: { confirmed: true } },
        { value: 840, status: { confirmed: true } },
        { value: "5000", status: { confirmed: false } },
      ]),
      "2840",
    );
    assert.equal(spendableBtcSats([]), "0");
  });

  it("leaves a miner-fee reserve on deposit Max and a signer-fee reserve on withdraw Max", () => {
    assert.equal(maxBridgePaySats("deposit", "2840", "1000"), "2640");
    assert.equal(maxBridgePaySats("deposit", BTC_BRIDGE_FEE_RESERVE, "1000"), "0");
    assert.equal(maxBridgePaySats("withdraw", "3840", "1000"), "2840");
    assert.equal(maxBridgePaySats("withdraw", "1000", "1000"), "0");
    assert.equal(maxBridgePaySats("deposit", "1404", "200", "1000", "386"), "1018");
    assert.equal(maxBridgePaySats("deposit", "1199", "200", "1000", "386"), "0");
  });

  it("sizes Leather sendTransfer as a 2-output fee and never under-reserves 200 sats", () => {
    assert.equal(bitcoinSendVsize(1, true), 193);
    assert.equal(parseRecommendedFeeRate({ fastestFee: 1 }), 2);
    assert.equal(parseRecommendedFeeRate({ fastestFee: 5 }), 5);
    assert.equal(bitcoinMinerFeeReserve(2, 1), "386");
    assert.equal(bitcoinMinerFeeReserve(1, 1), "200");
    assert.equal(
      countConfirmedUtxos([
        { value: "1404", status: { confirmed: true } },
        { value: "10", status: { confirmed: false } },
      ]),
      1,
    );
  });

  it("blocks a deposit that spends the whole Bitcoin balance and leaves no miner fee", () => {
    assert.match(bitcoinDepositBalanceError("1404", "1404") ?? "", /miner fee/);
    assert.match(bitcoinDepositBalanceError("1204", "1404", "386") ?? "", /miner fee/);
    assert.match(bitcoinDepositBalanceError("2001", "1404") ?? "", /more than your Bitcoin balance/);
    assert.equal(bitcoinDepositBalanceError("1018", "1404", "386"), null);
    assert.equal(bitcoinDepositBalanceError("1000", "2500"), null);
  });
});

describe("Token dollar equivalents", () => {
  const btc = { feedKey: "BTC/USD", price: "7000000000000", scale: 8 };
  const stx = { feedKey: "STX/USD", price: "65000000", scale: 8 };
  const usdc = { feedKey: "USDC/USD", price: "100000000", scale: 8 };

  it("maps known tokens onto oracle feeds and leaves unknown tokens unpriced", () => {
    assert.equal(tokenUsdFeedKey("sBTC"), "BTC/USD");
    assert.equal(tokenUsdFeedKey("STX", "stacks:mainnet:native:stx"), "STX/USD");
    assert.equal(tokenUsdFeedKey("USDCx"), "USDC/USD");
    assert.equal(tokenUsdFeedKey("ALEX"), null);
  });

  it("converts base units through the oracle scale without inventing prices", () => {
    assert.equal(formatUsdFromBase("10000000", 8, btc), "$7,000.00");
    assert.equal(formatUsdFromDisplay("1.5", 6, stx), "$0.97");
    assert.equal(formatUsdFromBase("2500000", 6, usdc), "$2.50");
    assert.equal(formatUsdFromBase("10000000", 8, { ...btc, stale: true }), "$7,000.00 · stale");
    assert.equal(formatUsdFromBase("10000000", 8, { ...btc, price: null }), null);
    assert.equal(formatSpotUsd(btc), "$70,000.00");
    assert.equal(usdHint(formatUsdFromBase("10000000", 8, btc)), "≈ $7,000.00");
    assert.equal(usdHint(null), "USD unavailable");
    assert.equal(usdHint(null, true), "USD loading…");
    assert.equal(formatUsdFromDisplay("1.5.", 6, stx), null);
  });
});
