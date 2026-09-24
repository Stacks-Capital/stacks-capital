import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALEX_ABTC_ASSET_ID,
  CANONICAL_SBTC_ASSET_ID,
  CANONICAL_USDCX_ASSET_ID,
  MAINNET_SWAP_ASSETS,
  NATIVE_STX_ASSET_ID,
  listMainnetSwapMarkets,
  mergeListings,
  resetSwapMarketCache,
  type ListedSwapAsset,
} from "./swapMarkets.ts";

const BITFLOW_STX = "SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.token-stx-v-1-2";
const VELAR_STX = "SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.wstx";

function asset(
  assetId: string,
  extras: Partial<ListedSwapAsset> & Pick<ListedSwapAsset, "symbol" | "providers" | "providerTokens">,
): ListedSwapAsset {
  return {
    key: extras.key ?? assetId,
    assetId,
    name: extras.name ?? extras.symbol,
    decimals: extras.decimals ?? 6,
    ...extras,
  };
}

describe("mainnet swap market catalog", () => {
  it("keeps the four canonical identities for quotes that do not wait on live catalogs", () => {
    assert.deepEqual(
      MAINNET_SWAP_ASSETS.map((item) => item.assetId),
      [NATIVE_STX_ASSET_ID, CANONICAL_SBTC_ASSET_ID, CANONICAL_USDCX_ASSET_ID, ALEX_ABTC_ASSET_ID],
    );
  });

  it("collapses each venue's STX wrapper onto the native mainnet STX identity", () => {
    const merged = mergeListings([
      asset(NATIVE_STX_ASSET_ID, {
        key: "stx",
        symbol: "STX",
        name: "Stacks",
        providers: ["bitflow"],
        providerTokens: { bitflow: BITFLOW_STX },
      }),
      asset(NATIVE_STX_ASSET_ID, {
        key: "stx",
        symbol: "STX",
        providers: ["velar"],
        providerTokens: { velar: VELAR_STX },
      }),
    ]);
    assert.equal(merged.length, 1);
    assert.deepEqual(merged[0]?.providers, ["bitflow", "velar"]);
    assert.equal(merged[0]?.providerTokens.bitflow, BITFLOW_STX);
    assert.equal(merged[0]?.providerTokens.velar, VELAR_STX);
  });

  it("does not merge listings that disagree on decimals for the same identity", () => {
    const merged = mergeListings([
      asset(CANONICAL_SBTC_ASSET_ID, {
        key: "sbtc",
        symbol: "sBTC",
        decimals: 8,
        providers: ["bitflow"],
        providerTokens: { bitflow: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token" },
      }),
      asset(CANONICAL_SBTC_ASSET_ID, {
        key: "sbtc",
        symbol: "sBTC",
        decimals: 6,
        providers: ["velar"],
        providerTokens: { velar: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token" },
      }),
    ]);
    assert.deepEqual(merged[0]?.providers, ["bitflow"]);
    assert.equal(merged[0]?.decimals, 8);
  });

  it("reads Bitflow, Velar and ALEX catalogs and drops testnet principals", async () => {
    resetSwapMarketCache();
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("bitflow")) {
        return new Response(
          JSON.stringify({
            tokens: [
              {
                contract_address: BITFLOW_STX,
                symbol: "STX",
                name: "Stacks",
                decimals: 6,
                asset_name: "unknown",
              },
              {
                contract_address: "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.fake",
                symbol: "FAKE",
                name: "Fake",
                decimals: 6,
                asset_name: "fake",
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify([
          {
            symbol: "WELSH",
            name: "Welsh",
            contractAddress: "SP3NE50GEXFG9SZGTT51P40X2CKYSZ5CC4ZTZ7A2G.welshcorgicoin-token",
            decimal: "u6",
            assetName: "welshcorgicoin",
          },
        ]),
        { status: 200 },
      );
    };
    const catalog = await listMainnetSwapMarkets({
      fetcher,
      alexFactory: () =>
        ({
          fetchSwappableCurrency: async () => [
            {
              id: "token-wstx",
              name: "STX",
              underlyingToken: ".stx",
              underlyingTokenDecimals: 6,
              wrapToken: "token-wstx",
              wrapTokenDecimals: 8,
            },
            {
              id: "token-alex",
              name: "ALEX",
              underlyingToken: "SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3C0HTGQ.age000-governance-token::alex",
              underlyingTokenDecimals: 8,
              wrapToken: "SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3C0HTGQ.age000-governance-token::alex",
              wrapTokenDecimals: 8,
            },
          ],
        }) as never,
      cache: false,
    });
    assert.equal(catalog.sources.bitflow.status, "ok");
    assert.equal(catalog.sources.velar.status, "ok");
    assert.equal(catalog.sources.alex.status, "ok");
    assert.equal(
      catalog.assets.some((item) => item.assetId.includes("ST1PQHQ")),
      false,
    );
    const stx = catalog.assets.find((item) => item.assetId === NATIVE_STX_ASSET_ID);
    assert.deepEqual(stx?.providers, ["bitflow", "velar", "alex"]);
    assert.equal(
      catalog.assets.some(
        (item) =>
          item.assetId ===
          "stacks:mainnet:contract:SP3NE50GEXFG9SZGTT51P40X2CKYSZ5CC4ZTZ7A2G.welshcorgicoin-token:welshcorgicoin",
      ),
      true,
    );
    assert.equal(
      catalog.assets.some(
        (item) =>
          item.assetId ===
          "stacks:mainnet:contract:SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3C0HTGQ.age000-governance-token:alex",
      ),
      true,
    );
  });

  it("keeps canonical markets when one venue catalog is unavailable", async () => {
    resetSwapMarketCache();
    const catalog = await listMainnetSwapMarkets({
      fetcher: async () => new Response("nope", { status: 503 }),
      alexFactory: () => {
        throw new Error("ALEX catalog offline");
      },
      cache: false,
    });
    assert.equal(catalog.sources.bitflow.status, "unavailable");
    assert.equal(catalog.sources.velar.status, "unavailable");
    assert.equal(catalog.sources.alex.status, "unavailable");
    assert.equal(catalog.assets.length >= 4, true);
    assert.equal(catalog.assets[0]?.assetId, NATIVE_STX_ASSET_ID);
  });
});
