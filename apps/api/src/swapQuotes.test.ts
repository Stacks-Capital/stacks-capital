import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAINNET_SWAP_ASSETS,
  alexProvider,
  bitflowProvider,
  compareSwapQuotes,
  velarProvider,
  type SwapQuoteProvider,
} from "./swapQuotes.ts";

const STX = MAINNET_SWAP_ASSETS.find((asset) => asset.key === "stx")?.assetId ?? "";
const SBTC = MAINNET_SWAP_ASSETS.find((asset) => asset.key === "sbtc")?.assetId ?? "";
const NOW = new Date("2026-09-24T06:00:00.000Z");

function provider(name: SwapQuoteProvider["name"], minimum: string, target = `SP000.${name}`): SwapQuoteProvider {
  return {
    name,
    async quote(request, now) {
      return {
        provider: name,
        inputAsset: request.inputAsset,
        outputAsset: request.outputAsset,
        amountIn: request.amount,
        amountOut: (BigInt(minimum) + 2n).toString(),
        minimumAmountOut: minimum,
        fee: null,
        priceImpactBps: null,
        route: [target],
        targetContract: target,
        observedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 30_000).toISOString(),
        evidenceSource: `${name}-fixture`,
      };
    },
  };
}

describe("swap quote comparison", () => {
  it("uses Bitflow's enforced post-condition floor when its API rounds one unit higher", async () => {
    const bodies = [
      {
        success: true,
        amount_out: "1000",
        min_amount_out: "995",
        input_token_decimals: 8,
        output_token_decimals: 6,
        execution_path: [{ pool_contract: "SP000.pool" }],
        route_path: ["input", "output"],
      },
      {
        success: true,
        swap_contract: "SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.router",
        function_name: "swap-simple-multi",
        swap_parameters_typed: [
          {
            type: "tuple",
            value: {
              amount: { type: "uint", value: "100" },
              "max-steps": { type: "uint", value: "1" },
              "min-received": { type: "uint", value: "994" },
              "pool-trait": { type: "contract", value: "SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.pool" },
              "x-for-y": { type: "true", value: "true" },
              "x-token-trait": { type: "contract", value: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token" },
              "y-token-trait": { type: "contract", value: "SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.token-stx-v-1-2" },
            },
          },
        ],
        post_conditions: [
          {
            condition_code: "greater_than_or_equal_to",
            token_contract: "SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.token-stx-v-1-2",
            post_condition_type: "contract_stx",
            amount: "994",
            sender_address: "SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.pool",
            token_asset_name: "stx",
          },
        ],
      },
    ];
    const fetcher: typeof fetch = async () =>
      new Response(JSON.stringify(bodies.shift()), { status: 200, headers: { "content-type": "application/json" } });
    const offer = await bitflowProvider(fetcher).quote(
      { network: "mainnet", owner: "SP_OWNER", inputAsset: SBTC, outputAsset: STX, amount: "100", slippageBps: 50 },
      NOW,
    );
    assert.equal(offer.amountOut, "1000");
    assert.equal(offer.minimumAmountOut, "994");
    assert.equal(offer.walletCall?.contractId, "SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.router");
    assert.equal(offer.walletCall?.functionName, "swap-simple-multi");
    assert.equal(offer.walletCall?.postConditions[0]?.address, "SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.pool");
  });

  it("accepts a Bitflow contract_fungible receive floor on STX to sBTC", async () => {
    const bodies = [
      {
        success: true,
        amount_out: "366",
        min_amount_out: "364",
        execution_path: [{ pool_contract: "SP000.pool" }],
        route_path: ["stx", "sbtc"],
      },
      {
        success: true,
        swap_contract: "SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.router",
        function_name: "swap-simple-multi",
        swap_parameters_typed: [
          {
            type: "tuple",
            value: {
              amount: { type: "uint", value: "1000000" },
              "max-steps": { type: "uint", value: "1" },
              "min-received": { type: "uint", value: "364" },
              "pool-trait": { type: "contract", value: "SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.pool" },
              "x-for-y": { type: "true", value: "true" },
              "x-token-trait": { type: "contract", value: "SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.token-stx-v-1-2" },
              "y-token-trait": { type: "contract", value: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token" },
            },
          },
        ],
        post_conditions: [
          {
            condition_code: "greater_than_or_equal_to",
            token_contract: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
            post_condition_type: "contract_fungible",
            amount: "364",
            sender_address: "SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.pool",
            token_asset_name: "sbtc-token",
          },
        ],
      },
    ];
    const fetcher: typeof fetch = async () =>
      new Response(JSON.stringify(bodies.shift()), { status: 200, headers: { "content-type": "application/json" } });
    const offer = await bitflowProvider(fetcher).quote(
      { network: "mainnet", owner: "SP_OWNER", inputAsset: STX, outputAsset: SBTC, amount: "1000000", slippageBps: 50 },
      NOW,
    );
    assert.equal(offer.minimumAmountOut, "364");
  });

  it("fails closed when Bitflow's swap builder does not succeed", async () => {
    const bodies = [
      {
        success: true,
        amount_out: "1000",
        min_amount_out: "995",
        execution_path: [{ pool_contract: "SP000.pool" }],
        route_path: ["input", "output"],
      },
      { success: false, error: "no route" },
    ];
    const fetcher: typeof fetch = async () =>
      new Response(JSON.stringify(bodies.shift()), { status: 200, headers: { "content-type": "application/json" } });
    await assert.rejects(
      bitflowProvider(fetcher).quote(
        { network: "mainnet", owner: "SP_OWNER", inputAsset: SBTC, outputAsset: STX, amount: "100", slippageBps: 50 },
        NOW,
      ),
      /successful swap builder/,
    );
  });

  it("maps Velar's missing-route crash to a closed pair error", async () => {
    await assert.rejects(
      velarProvider(
        () =>
          ({
            getSwapInstance: async () => {
              throw new TypeError("Cannot read properties of undefined (reading 'Symbol.asyncIterator')");
            },
          }) as never,
      ).quote(
        {
          network: "mainnet",
          owner: "SP_OWNER",
          inputAsset: STX,
          outputAsset: SBTC,
          amount: "1000000",
          slippageBps: 50,
        },
        NOW,
      ),
      /no route for this pair/,
    );
  });

  it("uses Velar's on-chain post-condition as the guaranteed minimum", async () => {
    const offer = await velarProvider(
      () =>
        ({
          getSwapInstance: async () => ({
            getComputedAmount: async () => ({ valid: true, amountOut: 250.9, route: ["wstx", "sbtc"] }),
            swap: async () => ({
              contractAddress: "SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1",
              contractName: "univ2-path2",
              postConditions: [
                {
                  type: "fungible-postcondition",
                  condition: "gte",
                  asset: `${SBTC.split(":contract:")[1]?.replace(":", "::")}`,
                  amount: "240",
                },
              ],
            }),
          }),
        }) as never,
    ).quote(
      { network: "mainnet", owner: "SP_OWNER", inputAsset: STX, outputAsset: SBTC, amount: "1000000", slippageBps: 50 },
      NOW,
    );
    assert.equal(offer.amountOut, "250");
    assert.equal(offer.minimumAmountOut, "240");
    assert.equal(offer.targetContract, "SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.univ2-path2");
  });

  it("rescales ALEX's 8-decimal units back to the exact receive asset", async () => {
    const offer = await alexProvider(
      () =>
        ({
          fetchSwappableCurrency: async () => [
            { id: "token-wstx", underlyingToken: "token-wstx", wrapToken: "token-wstx" },
            {
              id: "token-sbtc",
              underlyingToken: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token",
              wrapToken: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token",
            },
          ],
          getAmountTo: async () => 12_345_678n,
          runSwap: async () => ({
            contractAddress: "SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3C0HTGQ",
            contractName: "amm-pool-v2-01",
            postConditions: [
              {
                type: "fungible-postcondition",
                condition: "gte",
                asset: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token",
                amount: "12283949",
              },
            ],
          }),
          getRoute: async () => ["token-wstx", "token-sbtc"],
          getWayPoints: async () => [
            { underlyingToken: "token-wstx" },
            { underlyingToken: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token" },
          ],
        }) as never,
    ).quote(
      { network: "mainnet", owner: "SP_OWNER", inputAsset: STX, outputAsset: SBTC, amount: "1000000", slippageBps: 50 },
      NOW,
    );
    // ALEX quotes in 8dp; sBTC is also 8dp so 50 bps is exact integer division.
    assert.equal(offer.amountOut, "12345678");
    assert.equal(offer.minimumAmountOut, "12283949");
  });

  it("ranks by guaranteed minimum output and not optimistic output", async () => {
    const result = await compareSwapQuotes(
      { network: "mainnet", owner: "SP_OWNER", inputAsset: STX, outputAsset: SBTC, amount: "1000000", slippageBps: 50 },
      {
        providers: [provider("bitflow", "360"), provider("velar", "370"), provider("alex", "350")],
        now: () => NOW,
        allowedContracts: ["SP000.velar"],
      },
    );
    assert.deepEqual(
      result.offers.map((offer) => [offer.rank, offer.provider]),
      [
        [1, "velar"],
        [2, "bitflow"],
        [3, "alex"],
      ],
    );
    assert.equal(result.offers[0]?.status, "executable");
    assert.equal(result.offers[1]?.status, "quote_only");
  });

  it("keeps healthy offers when one provider fails", async () => {
    const failed: SwapQuoteProvider = {
      name: "alex",
      async quote() {
        throw new Error("Exact asset identity is not listed by ALEX");
      },
    };
    const result = await compareSwapQuotes(
      { network: "mainnet", owner: "SP_OWNER", inputAsset: STX, outputAsset: SBTC, amount: "1", slippageBps: 10 },
      { providers: [provider("bitflow", "8"), failed], now: () => NOW, allowedContracts: [] },
    );
    assert.equal(result.offers.length, 1);
    assert.deepEqual(result.unavailable, [{ provider: "alex", reason: "This pair is not listed" }]);
  });

  it("fails closed when a provider response is not bound to the request", async () => {
    const mismatched = provider("bitflow", "8");
    const originalQuote = mismatched.quote;
    mismatched.quote = async (request, now) => ({
      ...(await originalQuote(request, now)),
      amountIn: (BigInt(request.amount) + 1n).toString(),
    });
    const result = await compareSwapQuotes(
      { network: "mainnet", owner: "SP_OWNER", inputAsset: STX, outputAsset: SBTC, amount: "1", slippageBps: 10 },
      { providers: [mismatched], now: () => NOW, allowedContracts: [] },
    );
    assert.equal(result.offers.length, 0);
    assert.deepEqual(result.unavailable, [
      { provider: "bitflow", reason: "Provider returned a quote that failed request binding checks" },
    ]);
  });

  it("rejects zero amounts, identical assets and unsafe slippage", async () => {
    await assert.rejects(
      compareSwapQuotes(
        { network: "mainnet", owner: "SP_OWNER", inputAsset: STX, outputAsset: SBTC, amount: "0", slippageBps: 50 },
        { providers: [] },
      ),
      /positive integer/,
    );
    await assert.rejects(
      compareSwapQuotes(
        { network: "mainnet", owner: "SP_OWNER", inputAsset: STX, outputAsset: STX, amount: "1", slippageBps: 50 },
        { providers: [] },
      ),
      /must differ/,
    );
    await assert.rejects(
      compareSwapQuotes(
        { network: "mainnet", owner: "SP_OWNER", inputAsset: STX, outputAsset: SBTC, amount: "1", slippageBps: 301 },
        { providers: [] },
      ),
      /between 0 and 300/,
    );
  });
});
