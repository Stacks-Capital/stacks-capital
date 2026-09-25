import { randomUUID } from "node:crypto";
import { OpenAPIHono } from "@hono/zod-openapi";
import {
  isCapitalError,
  stacksAddressNetwork,
  evaluatePortfolioAccounting,
  normalizeCapitalCategory,
  type AccountingEntry,
  attributeCashFlowYield,
  evaluateForward30dProjection,
  buildPerformanceChartSeries,
  parseQuantity,
  mulDiv,
  type ProjectionRateStatus,
} from "@stacks-capital/core";
import {
  createNonce,
  exchangeNonceForSession,
  findWorkflowForTenant,
  getMarketEvidence,
  isAllowedOrigin,
  latestPositions,
  latestPrices,
  latestPriceValuations,
  latestWalletBalances,
  listCapabilities,
  listEarnOptions,
  listMarketAssets,
  listWorkflowsForTenant,
  listMarkets,
  getEarnPerformanceData,
  createWebhookEndpoint,
  listWebhookEndpoints,
  deleteWebhookEndpoint,
  type Sql,
} from "@stacks-capital/database";
import { cors } from "hono/cors";
import {
  authenticate,
  CLIENT_ID_HEADER,
  enforceRateLimit,
  requireClient,
  requireScope,
  SESSION_TTL_SECONDS,
  signatureMatches,
} from "./auth.ts";
import { decodeCursor, encodeCursor } from "./cursor.ts";
import { advanceSbtcBridgeById, isSbtcBridgeInFlight } from "./sbtcBridgeAdvance.ts";
import {
  createQuote,
  liveReads,
  marketRisk,
  type ReadsLoader,
  attachFoundBroadcast,
  cancelWorkflow,
  recordSignature,
  requireEnabled,
  startWorkflow,
} from "./execution.ts";
import { ApiError, errorBody } from "./errors.ts";
import { DEFAULT_RATE_LIMITS, type RateLimiter, type RateLimits } from "./rateLimit.ts";
import {
  capabilitiesRoute,
  challengeRoute,
  earnOptionsRoute,
  earnPerformanceRoute,
  marketEvidenceRoute,
  marketRiskRoute,
  marketsRoute,
  planRoute,
  portfolioRoute,
  positionsRoute,
  pricesRoute,
  priceValuationsRoute,
  quoteRoute,
  attachBroadcastRoute,
  cancelWorkflowRoute,
  signatureRoute,
  startWorkflowRoute,
  sbtcDepositNotifyRoute,
  sbtcDepositPrepareRoute,
  swapComparisonRoute,
  swapMarketsRoute,
  verifyRoute,
  workflowRoute,
  workflowsRoute,
  createWebhookEndpointRoute,
  listWebhookEndpointsRoute,
  deleteWebhookEndpointRoute,
} from "./routes.ts";
import { intentFromBody, mintPlan, quoteOwner, toQuoteWire } from "./quote.ts";
import { SCHEMA_VERSION } from "./schemas.ts";
import { serializePlan, serializeQuote } from "./serialize.ts";
import {
  CANONICAL_SWAP_ASSETS,
  listMainnetSwapMarkets,
  publicSwapAsset,
  type SwapMarketCatalog,
} from "./swapMarkets.ts";
import { compareSwapQuotes, type SwapQuoteProvider } from "./swapQuotes.ts";
import {
  notifySbtcDeposit,
  prepareSbtcDeposit,
  type NotifySbtcDepositInput,
  type PreparedSbtcDeposit,
  type SbtcDepositBridge,
} from "./sbtcDeposit.ts";
import type { EmilyDeposit } from "@stacks-capital/adapters";

export type AppDependencies = {
  sql: Sql;
  limiter: RateLimiter;
  limits?: RateLimits;
  now?: () => Date;
  /** Where quotes read market state. Defaults to live provider reads with the server's Hiro key. */
  reads?: ReadsLoader;
  /** Test seam for deterministic provider comparison. Production uses all three mainnet providers. */
  swapQuoteProviders?: readonly SwapQuoteProvider[];
  /** Test seam for the live Bitflow/Velar/ALEX token catalog. */
  swapMarkets?: () => Promise<SwapMarketCatalog>;
  /** Test seam for official sBTC/Emily construction. Production uses SbtcApiClientMainnet. */
  sbtcDepositBridge?: SbtcDepositBridge;
};
type Env = { Variables: { requestId: string } };

export const OPENAPI_CONFIG = {
  openapi: "3.1.0",
  info: { title: "Stacks Capital API", version: SCHEMA_VERSION },
} as const;

export { SESSION_TTL_SECONDS } from "./auth.ts";
export const NONCE_TTL_SECONDS = 300;

export function createApp(deps: AppDependencies) {
  const now = deps.now ?? (() => new Date());
  const limits = deps.limits ?? DEFAULT_RATE_LIMITS;
  const reads = deps.reads ?? liveReads(process.env.HIRO_API_KEY);
  const context = () => ({ observedAt: now().toISOString(), stale: false, warnings: [] });

  const app = new OpenAPIHono<Env>({
    defaultHook: (result, c) => {
      if (!result.success) {
        const message = result.error.issues
          .map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`)
          .join("; ");
        return c.json(errorBody(c.get("requestId"), "INVALID_REQUEST", message), 400);
      }
      return undefined;
    },
  });

  app.openAPIRegistry.registerComponent("securitySchemes", "apiKey", {
    type: "http",
    scheme: "bearer",
    description: "Server side API key, `key_<id>.<secret>`. Never sent from a browser.",
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "walletSession", {
    type: "http",
    scheme: "bearer",
    description: "Wallet session token, `ses_<id>.<secret>`, from POST /v1/auth/verify.",
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "clientId", {
    type: "apiKey",
    in: "header",
    name: CLIENT_ID_HEADER,
    description: "Publishable client id. Accepted only with an Origin header the app allows.",
  });

  app.use("*", async (c, next) => {
    const requestId = `req_${randomUUID()}`;
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);
    await next();
  });

  app.use(
    "*",
    cors({
      origin: async (origin) => (origin !== "" && (await isAllowedOrigin(deps.sql, origin)) ? origin : null),
      allowMethods: ["GET", "POST", "DELETE"],
      allowHeaders: ["authorization", "content-type", CLIENT_ID_HEADER],
      exposeHeaders: ["x-request-id", "ratelimit-limit", "ratelimit-remaining", "ratelimit-reset", "retry-after"],
      maxAge: 600,
    }),
  );

  app.notFound((c) => c.json(errorBody(c.get("requestId"), "NOT_FOUND", "No such route"), 404));

  // Unexpected errors never expose internals to the client.
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json(errorBody(c.get("requestId"), error.code, error.message, error.retryAfter), error.status);
    }
    if (isCapitalError(error)) {
      const mapped = new ApiError(error.code, error.message);
      return c.json(errorBody(c.get("requestId"), mapped.code, mapped.message), mapped.status);
    }
    return c.json(errorBody(c.get("requestId"), "INTERNAL", "Unexpected error"), 500);
  });

  const admit = async (c: Parameters<typeof authenticate>[0]) => {
    const at = now();
    const principal = await authenticate(c, deps.sql, at);
    await enforceRateLimit(c, deps.limiter, limits, principal, at);
    return principal;
  };

  app.openapi(marketsRoute, async (c) => {
    const { network, limit, cursor } = c.req.valid("query");
    const after = decodeCursor("markets", cursor, 1);
    requireScope(await admit(c), "markets:read");
    const page = await listMarkets(deps.sql, { network, afterId: after?.[0] ?? null, limit });
    const last = page.items.at(-1);
    return c.json(
      {
        schemaVersion: SCHEMA_VERSION,
        requestId: c.get("requestId"),
        network: `stacks:${network}` as const,
        data: {
          items: page.items,
          nextCursor: page.hasMore && last ? encodeCursor("markets", [last.id]) : null,
        },
        context: context(),
      },
      200,
    );
  });

  app.openapi(capabilitiesRoute, async (c) => {
    const { network, limit, cursor } = c.req.valid("query");
    const after = decodeCursor("capabilities", cursor, 2);
    requireScope(await admit(c), "markets:read");
    const page = await listCapabilities(deps.sql, {
      network,
      after: after ? { marketId: after[0] ?? "", action: after[1] ?? "" } : null,
      limit,
    });
    const last = page.items.at(-1);
    return c.json(
      {
        schemaVersion: SCHEMA_VERSION,
        requestId: c.get("requestId"),
        network: `stacks:${network}` as const,
        data: {
          items: page.items,
          nextCursor: page.hasMore && last ? encodeCursor("capabilities", [last.marketId, last.action]) : null,
        },
        context: context(),
      },
      200,
    );
  });

  app.openapi(earnOptionsRoute, async (c) => {
    const { network } = c.req.valid("query");
    requireScope(await admit(c), "markets:read");
    const options = await listEarnOptions(deps.sql, network);
    return c.json(
      {
        schemaVersion: SCHEMA_VERSION,
        requestId: c.get("requestId"),
        network: `stacks:${network}` as const,
        data: {
          items: options.map((option) => ({
            marketId: option.marketId,
            protocol: option.protocol,
            suppliedAssetId: option.suppliedAssetId,
            receiptAssetId: option.receiptAssetId,
            supply: { state: option.supplyState, reason: option.supplyReason },
            withdrawal:
              option.withdrawState === null
                ? null
                : { state: option.withdrawState, reason: option.withdrawReason ?? "" },
            baseRate: option.baseRate,
            baseRateScale: option.baseRateScale,
            incentiveRate: option.incentiveRate,
            incentiveRateScale: option.incentiveRateScale,
            availableLiquidity: option.availableLiquidity,
            capacity: option.capacity,
            paused: option.paused,
            stale: option.stale,
            warnings: option.warnings,
            observedAt: option.observedAt === null ? null : option.observedAt.toISOString(),
            adapterVersion: option.adapterVersion,
            evidence: {
              ageSeconds:
                option.observedAt === null
                  ? null
                  : Math.max(0, Math.round((now().getTime() - option.observedAt.getTime()) / 1000)),
              blockHeight: option.blockHeight,
              blockHash: option.blockHash,
              confidence: option.confidence,
              source: option.source,
              disagreement: option.disagreement,
              isIndependentRead: option.isIndependentRead,
            },
          })),
        },
        context: context(),
      },
      200,
    );
  });

  app.openapi(earnPerformanceRoute, async (c) => {
    const { network, owner, marketId } = c.req.valid("query");
    const principal = await admit(c);
    if (principal.kind === "client")
      throw new ApiError("FORBIDDEN", "Performance needs an API key or a wallet session");
    requireScope(principal, "positions:read");
    const address = principal.kind === "session" ? principal.address : owner;
    if (address === undefined) throw new ApiError("INVALID_REQUEST", "owner is required for an API key");
    if (principal.kind === "session" && principal.network !== network) {
      throw new ApiError("NETWORK_MISMATCH", `Session is for ${principal.network}`);
    }

    const feeds = ["BTC/USD", "STX/USD", "sBTC/USD", "USDC/USD"];
    const [marketDataList, valuations] = await Promise.all([
      getEarnPerformanceData(deps.sql, network, address, marketId),
      latestPriceValuations(deps.sql, network, feeds, { now: now() }),
    ]);

    const items = marketDataList.map((m) => {
      const currentUnderlying = m.currentUnderlyingUnits ?? "0";
      const oracleVal = valuations.find((v) => v.assetId.includes(m.assetId) || m.assetId.includes(v.assetId));
      const oraclePrice = oracleVal?.price ? { price: oracleVal.price, scale: oracleVal.scale } : null;

      const { attribution, realizedEarnings, accruedEstimate } = attributeCashFlowYield({
        assetId: m.assetId,
        currentUnderlyingValue: currentUnderlying,
        currentShares: m.currentPositionShares,
        currentShareRate: m.currentShareRate,
        initialShareRate: m.initialShareRate,
        cashFlows: m.cashFlows,
        unclaimedRewards: m.unclaimedRewards,
        oraclePrice,
      });

      let rateStatus: ProjectionRateStatus = "verified";
      if (m.marketSupplyRateBps === null) {
        rateStatus = "missing";
      } else if (m.marketRateStale) {
        rateStatus = "stale";
      } else if (m.reconciliationStatus === "mismatch") {
        rateStatus = "disputed";
      } else if (m.reconciliationStatus === "unavailable") {
        rateStatus = "unverified";
      }

      let principalUsd: string | null = null;
      if (oraclePrice && currentUnderlying !== "0") {
        principalUsd = mulDiv(
          parseQuantity(currentUnderlying),
          parseQuantity(oraclePrice.price),
          BigInt(10 ** oraclePrice.scale),
          "down",
        ).toString(10);
      }

      const forward30dProjection = evaluateForward30dProjection({
        principalAmount: currentUnderlying,
        principalUsd,
        rateBps: m.marketSupplyRateBps,
        rateStatus,
        rateDisagreement: m.reconciliationStatus,
        isStale: m.marketRateStale,
      });

      const chart = buildPerformanceChartSeries(m.observations, attribution.costBasis);

      return {
        marketId: m.marketId,
        assetId: m.assetId,
        attribution,
        realizedEarnings,
        accruedEstimate,
        forward30dProjection,
        chart,
      };
    });

    return c.json(
      {
        schemaVersion: SCHEMA_VERSION,
        requestId: c.get("requestId"),
        network: `stacks:${network}` as const,
        data: { items },
        context: context(),
      },
      200,
    );
  });

  app.openapi(marketEvidenceRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { network } = c.req.valid("query");
    requireScope(await admit(c), "markets:read");
    const evidence = await getMarketEvidence(deps.sql, network, id, now());
    if (!evidence) {
      throw new ApiError("NOT_FOUND", `Market ${id} not found`);
    }
    return c.json(
      {
        schemaVersion: SCHEMA_VERSION,
        requestId: c.get("requestId"),
        network: `stacks:${network}` as const,
        data: {
          marketId: evidence.marketId,
          network: evidence.network,
          protocol: evidence.protocol,
          source: evidence.source,
          blockHeight: evidence.blockHeight,
          blockHash: evidence.blockHash,
          observedAt: evidence.observedAt === null ? null : evidence.observedAt.toISOString(),
          evidenceAgeSeconds: evidence.evidenceAgeSeconds,
          confidence: evidence.confidence,
          disagreement: evidence.disagreement,
          disagreementDetail: evidence.disagreementDetail,
          isIndependentRead: evidence.isIndependentRead,
          rate: evidence.rate,
          liquidity: evidence.liquidity,
          warnings: evidence.warnings,
          observations: evidence.observations.map((obs) => ({
            source: obs.source,
            sourceType: obs.sourceType,
            isIndependentRead: obs.isIndependentRead,
            availableLiquidity: obs.availableLiquidity,
            capacity: obs.capacity,
            supplyRate: obs.supplyRate,
            borrowRate: obs.borrowRate,
            rateScale: obs.rateScale,
            paused: obs.paused,
            stale: obs.stale,
            warnings: obs.warnings,
            observedAt: obs.observedAt.toISOString(),
            blockHeight: obs.blockHeight,
            blockHash: obs.blockHash,
          })),
        },
        context: context(),
      },
      200,
    );
  });

  app.openapi(pricesRoute, async (c) => {
    const { network } = c.req.valid("query");
    requireScope(await admit(c), "markets:read");
    const feeds = ["BTC/USD", "STX/USD", "sBTC/USD", "USDC/USD"];
    const [prices, valuations] = await Promise.all([
      latestPrices(deps.sql, network, feeds),
      latestPriceValuations(deps.sql, network, feeds, { now: now() }),
    ]);
    const valByFeed = new Map(valuations.map((v) => [v.assetId, v]));

    return c.json(
      {
        schemaVersion: SCHEMA_VERSION,
        requestId: c.get("requestId"),
        network: `stacks:${network}` as const,
        data: {
          items: prices.map((price) => {
            const val = valByFeed.get(price.feedKey);
            return {
              feedKey: price.feedKey,
              price: price.price,
              scale: price.priceScale,
              publishedAt: price.publishedAt === null ? null : price.publishedAt.toISOString(),
              observedAt: price.observedAt.toISOString(),
              source: price.source,
              stale: price.stale,
              warnings: price.warnings,
              assetId: val?.assetId ?? price.feedKey,
              sourceSet: val?.sourceSet ?? [price.source],
              disagreement: val?.disagreement ?? false,
              status: val?.status ?? (price.stale ? "stale" : "verified"),
            };
          }),
        },
        context: context(),
      },
      200,
    );
  });

  app.openapi(priceValuationsRoute, async (c) => {
    const { network } = c.req.valid("query");
    requireScope(await admit(c), "markets:read");
    const feeds = ["BTC/USD", "STX/USD", "sBTC/USD", "USDC/USD"];
    const valuations = await latestPriceValuations(deps.sql, network, feeds, { now: now() });
    return c.json(
      {
        schemaVersion: SCHEMA_VERSION,
        requestId: c.get("requestId"),
        network: `stacks:${network}` as const,
        data: {
          items: valuations.map((v) => ({
            assetId: v.assetId,
            price: v.price,
            scale: v.scale,
            sourceSet: v.sourceSet,
            timestamp: v.timestamp,
            status: v.status,
            disagreement: v.disagreement,
            spreadBps: v.spreadBps,
            warnings: v.warnings,
          })),
        },
        context: context(),
      },
      200,
    );
  });

  app.openapi(marketRiskRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { network, owner } = c.req.valid("query");
    const principal = await admit(c);
    if (principal.kind === "client") throw new ApiError("FORBIDDEN", "Risk needs an API key or a wallet session");
    requireScope(principal, "positions:read");
    const address = principal.kind === "session" ? principal.address : (owner ?? null);

    const known = await listMarkets(deps.sql, { network, afterId: null, limit: 100 });
    if (!known.items.some((market) => market.id === id)) throw new ApiError("NOT_FOUND", "No such market");

    const risk = await marketRisk({ sql: deps.sql, reads, now }, { network, marketId: id, owner: address });
    return c.json(
      {
        schemaVersion: SCHEMA_VERSION,
        requestId: c.get("requestId"),
        network: `stacks:${network}` as const,
        data: risk,
        context: context(),
      },
      200,
    );
  });

  app.openapi(positionsRoute, async (c) => {
    const { network, owner } = c.req.valid("query");
    const principal = await admit(c);
    if (principal.kind === "client") throw new ApiError("FORBIDDEN", "Positions need an API key or a wallet session");
    requireScope(principal, "positions:read");
    // A session only ever reads its own address; a key must name whose positions it wants.
    const address = principal.kind === "session" ? principal.address : owner;
    if (address === undefined) throw new ApiError("INVALID_REQUEST", "owner is required for an API key");
    if (principal.kind === "session" && principal.network !== network) {
      throw new ApiError("NETWORK_MISMATCH", `Session is for ${principal.network}`);
    }

    const items = await latestPositions(deps.sql, { network, owner: address });
    const collateralByMarket = new Map<string, (typeof items)[0]>();
    for (const item of items) {
      if (item.kind === "collateral") {
        collateralByMarket.set(item.marketId, item);
      }
    }

    return c.json(
      {
        schemaVersion: SCHEMA_VERSION,
        requestId: c.get("requestId"),
        network: `stacks:${network}` as const,
        data: {
          items: items.map((position) => {
            let linkedCollateral = null;
            if (position.kind === "debt") {
              const backing = collateralByMarket.get(position.marketId);
              if (backing) {
                linkedCollateral = {
                  marketId: backing.marketId,
                  assetId: backing.assetId,
                  protocolKey: backing.protocolKey,
                  quantity: backing.quantity,
                };
              }
            }
            return {
              marketId: position.marketId,
              kind: position.kind,
              protocolKey: position.protocolKey,
              assetId: position.assetId,
              quantity: position.quantity,
              stale: position.stale,
              warnings: position.warnings,
              observedAt: position.observedAt.toISOString(),
              blockHeight: position.blockHeight,
              rewardRate: position.rewardRate,
              rewardScale: position.rewardScale,
              adapterVersion: position.adapterVersion,
              calculationVersion: position.calculationVersion,
              linkedCollateral,
            };
          }),
        },
        context: context(),
      },
      200,
    );
  });

  app.openapi(portfolioRoute, async (c) => {
    const { network, owner } = c.req.valid("query");
    const principal = await admit(c);
    if (principal.kind === "client") throw new ApiError("FORBIDDEN", "Portfolio needs an API key or a wallet session");
    requireScope(principal, "positions:read");
    const address = principal.kind === "session" ? principal.address : owner;
    if (address === undefined) throw new ApiError("INVALID_REQUEST", "owner is required for an API key");
    if (principal.kind === "session" && principal.network !== network) {
      throw new ApiError("NETWORK_MISMATCH", `Session is for ${principal.network}`);
    }

    const feeds = ["BTC/USD", "STX/USD", "sBTC/USD", "USDC/USD"];
    const [positions, balances, markets, valuations] = await Promise.all([
      latestPositions(deps.sql, { network, owner: address }),
      latestWalletBalances(deps.sql, { network, address }),
      listMarketAssets(deps.sql, network),
      latestPriceValuations(deps.sql, network, feeds, { now: now() }),
    ]);

    const receiptMarkets = new Map<string, string>();
    for (const m of markets) {
      if (m.receiptAssetId) receiptMarkets.set(m.receiptAssetId, m.marketId);
    }

    const collateralByMarket = new Map<string, (typeof positions)[0]>();
    for (const pos of positions) {
      if (pos.kind === "collateral") collateralByMarket.set(pos.marketId, pos);
    }

    const entries: AccountingEntry[] = [];

    // 1. Wallet balances
    for (const b of balances) {
      const receiptMarketId = receiptMarkets.get(b.assetId);
      const isReceipt = receiptMarketId !== undefined;
      entries.push({
        id: `wallet:${b.assetId}`,
        category: "wallet",
        assetId: b.assetId,
        quantity: b.quantity,
        marketId: receiptMarketId ?? null,
        protocolKey: null,
        isReceipt,
        countsTowardTotal: !isReceipt,
        linkedCollateral: null,
        stale: b.stale,
        warnings: isReceipt
          ? [...b.warnings, `Receipt for ${receiptMarketId}. Represented by protocol position; not double-counted`]
          : b.warnings,
      });
    }

    // 2. Positions
    for (const pos of positions) {
      const category = normalizeCapitalCategory(pos.kind) ?? "supplied";
      let linkedCollateral = null;
      const warnings = [...pos.warnings];

      if (category === "debt") {
        const backing = collateralByMarket.get(pos.marketId);
        if (backing) {
          linkedCollateral = {
            marketId: backing.marketId,
            assetId: backing.assetId,
            protocolKey: backing.protocolKey,
            quantity: backing.quantity,
          };
        } else {
          warnings.push(`Debt in ${pos.marketId} has no visible collateral position`);
        }
      }

      entries.push({
        id: `${pos.kind}:${pos.marketId}:${pos.protocolKey}:${pos.assetId}`,
        category,
        assetId: pos.assetId,
        quantity: pos.quantity,
        marketId: pos.marketId,
        protocolKey: pos.protocolKey,
        isReceipt: false,
        countsTowardTotal: true,
        linkedCollateral,
        stale: pos.stale,
        warnings,
      });
    }

    const valByAsset = new Map<string, (typeof valuations)[0]>();
    for (const val of valuations) {
      valByAsset.set(val.assetId, val);
      const mapFeedTo = (targetAssetId: string) => {
        const current = valByAsset.get(targetAssetId);
        if (!current || (current.status !== "verified" && val.status === "verified")) {
          valByAsset.set(targetAssetId, val);
        }
      };

      if (val.assetId === "BTC/USD" || val.assetId === "sBTC/USD") {
        mapFeedTo("stacks:mainnet:native:btc");
        mapFeedTo("bitcoin:mainnet:native:btc");
        mapFeedTo("stacks:mainnet:contract:SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token:sbtc-token");
      } else if (val.assetId === "STX/USD") {
        mapFeedTo("stacks:mainnet:native:stx");
      } else if (val.assetId === "USDC/USD") {
        mapFeedTo("stacks:mainnet:contract:SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx:usdcx-token");
        mapFeedTo("stacks:mainnet:sip10:usdc");
      }
    }

    const summary = evaluatePortfolioAccounting(entries, valByAsset);

    return c.json(
      {
        schemaVersion: SCHEMA_VERSION,
        requestId: c.get("requestId"),
        network: `stacks:${network}` as const,
        data: {
          grossAssetsUsd: summary.grossAssetsUsd,
          grossDebtUsd: summary.grossDebtUsd,
          netWorthUsd: summary.netWorthUsd,
          coverage: summary.coverage,
          entries: entries.map((e) => ({
            id: e.id,
            category: e.category,
            assetId: e.assetId,
            quantity: e.quantity,
            marketId: e.marketId,
            protocolKey: e.protocolKey,
            isReceipt: e.isReceipt,
            countsTowardTotal: e.countsTowardTotal,
            linkedCollateral: e.linkedCollateral,
            stale: e.stale,
            warnings: e.warnings,
          })),
          byCategory: summary.byCategory,
          incomplete: summary.incomplete,
          warnings: summary.warnings,
        },
        context: context(),
      },
      200,
    );
  });

  app.openapi(challengeRoute, async (c) => {
    const { network, address } = c.req.valid("json");
    const client = requireClient(await admit(c));
    if (stacksAddressNetwork(address) !== network) {
      throw new ApiError("NETWORK_MISMATCH", `Address is not a Stacks ${network} address`);
    }
    const nonce = await createNonce(deps.sql, {
      appId: client.appId,
      origin: client.origin,
      address,
      network,
      now: now(),
      ttlSeconds: NONCE_TTL_SECONDS,
    });
    return c.json(
      {
        schemaVersion: SCHEMA_VERSION,
        requestId: c.get("requestId"),
        network: `stacks:${network}` as const,
        data: { nonceId: nonce.nonceId, message: nonce.message, expiresAt: nonce.expiresAt.toISOString() },
        context: context(),
      },
      200,
    );
  });

  app.openapi(verifyRoute, async (c) => {
    const { network, nonceId, publicKey, signature } = c.req.valid("json");
    const client = requireClient(await admit(c));
    const session = await exchangeNonceForSession(deps.sql, {
      nonceId,
      appId: client.appId,
      now: now(),
      ttlSeconds: SESSION_TTL_SECONDS,
      accept: (nonce) => nonce.network === network && signatureMatches(nonce, client.origin, { publicKey, signature }),
    });
    // One answer for every failure, so the response never reveals which check failed.
    if (session === null) throw new ApiError("UNAUTHORIZED", "Sign in failed. Request a new challenge");
    c.header("cache-control", "no-store");
    return c.json(
      {
        schemaVersion: SCHEMA_VERSION,
        requestId: c.get("requestId"),
        network: `stacks:${network}` as const,
        data: {
          token: session.token,
          sessionId: session.sessionId,
          address: session.address,
          expiresAt: session.expiresAt.toISOString(),
        },
        context: context(),
      },
      200,
    );
  });

  app.openapi(workflowsRoute, async (c) => {
    const { network, owner, limit, cursor } = c.req.valid("query");
    const after = decodeCursor("workflows", cursor, 2);
    const principal = await admit(c);
    if (principal.kind === "client") throw new ApiError("FORBIDDEN", "Workflows need an API key or a wallet session");
    requireScope(principal, "workflows:write");
    // A session lists only its own; a key lists its app, or one address within it.
    const ownerAddress = principal.kind === "session" ? principal.address : (owner ?? null);

    const listQuery = {
      appId: principal.appId,
      ownerAddress,
      network,
      limit,
      before: after === null ? undefined : { createdAt: new Date(after[0] ?? ""), id: after[1] ?? "" },
    };
    let page = await listWorkflowsForTenant(deps.sql, listQuery);
    const pendingBridge = page.items.filter((workflow) => isSbtcBridgeInFlight(workflow.action, workflow.state));
    if (pendingBridge.length > 0) {
      await Promise.all(
        pendingBridge.slice(0, 8).map((workflow) =>
          advanceSbtcBridgeById(deps.sql, {
            id: workflow.id,
            appId: principal.appId,
            ownerAddress,
            now: now(),
          }),
        ),
      );
      page = await listWorkflowsForTenant(deps.sql, listQuery);
    }
    const last = page.items.at(-1);
    return c.json(
      {
        schemaVersion: SCHEMA_VERSION,
        requestId: c.get("requestId"),
        network: `stacks:${network}` as const,
        data: {
          items: page.items.map((workflow) => ({
            ...workflow,
            createdAt: workflow.createdAt.toISOString(),
            updatedAt: workflow.updatedAt.toISOString(),
          })),
          nextCursor: page.hasMore && last ? encodeCursor("workflows", [last.createdAt.toISOString(), last.id]) : null,
        },
        context: context(),
      },
      200,
    );
  });

  app.openapi(workflowRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { network } = c.req.valid("query");
    const principal = await admit(c);
    if (principal.kind === "client") throw new ApiError("FORBIDDEN", "Workflows need an API key or a wallet session");
    requireScope(principal, "workflows:write");
    if (principal.kind === "session" && principal.network !== network) {
      throw new ApiError("NETWORK_MISMATCH", `Session is for ${principal.network}`);
    }
    const workflow = await advanceSbtcBridgeById(deps.sql, {
      id,
      appId: principal.appId,
      ownerAddress: principal.kind === "session" ? principal.address : null,
      now: now(),
    });
    if (workflow === null) throw new ApiError("NOT_FOUND", "No such workflow");
    if (workflow.network !== network) throw new ApiError("NETWORK_MISMATCH", `Workflow is on ${workflow.network}`);
    return c.json(
      {
        schemaVersion: SCHEMA_VERSION,
        requestId: c.get("requestId"),
        network: `stacks:${network}` as const,
        data: {
          ...workflow,
          createdAt: workflow.createdAt.toISOString(),
          updatedAt: workflow.updatedAt.toISOString(),
          transitions: workflow.transitions.map((move) => ({ ...move, at: new Date(move.at).toISOString() })),
          attempts: workflow.attempts.map((attempt) => ({
            ...attempt,
            recordedAt: new Date(attempt.recordedAt).toISOString(),
          })),
        },
        context: context(),
      },
      200,
    );
  });

  const writer = (principal: Awaited<ReturnType<typeof admit>>, scope: "quotes:write" | "workflows:write") => {
    if (principal.kind === "client") throw new ApiError("FORBIDDEN", "This needs an API key or a wallet session");
    requireScope(principal, scope);
    return principal;
  };

  app.openapi(quoteRoute, async (c) => {
    const input = c.req.valid("json");
    const principal = writer(await admit(c), "quotes:write");
    if (principal.kind === "session" && principal.network !== input.network) {
      throw new ApiError("NETWORK_MISMATCH", `Session is for ${principal.network}`);
    }
    const owner = quoteOwner(principal, input.owner);
    const quoted = await createQuote(
      { sql: deps.sql, reads, now },
      {
        network: input.network,
        marketId: input.marketId,
        action: input.action,
        amount: input.amount,
        owner,
        recipient: input.recipient,
        slippageBps: input.slippageBps,
        maxFee: input.maxFee,
      },
    );
    return c.json(
      {
        schemaVersion: SCHEMA_VERSION,
        requestId: c.get("requestId"),
        network: `stacks:${input.network}` as const,
        data: { quote: serializeQuote(quoted.quote), plan: serializePlan(quoted.plan) },
        context: context(),
      },
      200,
    );
  });

  const loadSwapMarkets =
    deps.swapMarkets ??
    (deps.swapQuoteProviders === undefined
      ? () => listMainnetSwapMarkets({ now })
      : async () => ({
          assets: [...CANONICAL_SWAP_ASSETS],
          sources: {
            bitflow: { status: "ok" as const, count: 4, reason: null },
            velar: { status: "ok" as const, count: 4, reason: null },
            alex: { status: "ok" as const, count: 4, reason: null },
          },
          observedAt: now().toISOString(),
        }));

  app.openapi(swapMarketsRoute, async (c) => {
    requireScope(await admit(c), "markets:read");
    const catalog = await loadSwapMarkets();
    const warnings = (["bitflow", "velar", "alex"] as const)
      .filter((provider) => catalog.sources[provider].status === "unavailable")
      .map((provider) => `${provider} token catalog is unavailable`);
    return c.json(
      {
        schemaVersion: SCHEMA_VERSION,
        requestId: c.get("requestId"),
        network: "stacks:mainnet" as const,
        data: {
          items: catalog.assets.map(publicSwapAsset),
          sources: catalog.sources,
        },
        context: { ...context(), warnings },
      },
      200,
    );
  });

  app.openapi(swapComparisonRoute, async (c) => {
    const input = c.req.valid("json");
    const principal = writer(await admit(c), "quotes:write");
    if (principal.kind === "session" && principal.network !== input.network) {
      throw new ApiError("NETWORK_MISMATCH", `Session is for ${principal.network}`);
    }
    const owner = quoteOwner(principal, input.owner);
    const catalog = await loadSwapMarkets();
    try {
      const comparison = await compareSwapQuotes(
        {
          network: input.network,
          owner,
          inputAsset: input.inputAsset,
          outputAsset: input.outputAsset,
          amount: input.amount,
          slippageBps: input.slippageBps,
        },
        {
          catalog: catalog.assets,
          ...(deps.swapQuoteProviders === undefined ? {} : { providers: deps.swapQuoteProviders }),
          now,
        },
      );
      return c.json(
        {
          schemaVersion: SCHEMA_VERSION,
          requestId: c.get("requestId"),
          network: "stacks:mainnet" as const,
          data: comparison,
          context: context(),
        },
        200,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid swap request";
      if (/Unsupported exact asset|must differ|positive integer|Slippage/.test(message)) {
        throw new ApiError("INVALID_REQUEST", message);
      }
      throw error;
    }
  });

  const sbtcBridge = deps.sbtcDepositBridge;

  app.openapi(sbtcDepositPrepareRoute, async (c) => {
    const input = c.req.valid("json");
    writer(await admit(c), "quotes:write");
    try {
      const prepareInput = {
        network: input.network,
        stacksRecipient: input.stacksRecipient,
        amountSats: input.amountSats,
        maxSignerFeeSats: input.maxSignerFeeSats,
        reclaimPublicKey: input.reclaimPublicKey,
        ...(input.reclaimLockTime === undefined ? {} : { reclaimLockTime: input.reclaimLockTime }),
      };
      const prepared: PreparedSbtcDeposit =
        sbtcBridge === undefined
          ? await prepareSbtcDeposit(prepareInput)
          : await prepareSbtcDeposit(prepareInput, sbtcBridge);
      return c.json(
        {
          schemaVersion: SCHEMA_VERSION,
          requestId: c.get("requestId"),
          network: "stacks:mainnet" as const,
          data: prepared,
          context: context(),
        },
        200,
      );
    } catch (error) {
      throw new ApiError("INVALID_REQUEST", error instanceof Error ? error.message : "Could not prepare the deposit");
    }
  });

  app.openapi(sbtcDepositNotifyRoute, async (c) => {
    const input = c.req.valid("json");
    writer(await admit(c), "workflows:write");
    try {
      const notifyInput: NotifySbtcDepositInput = {
        network: input.network,
        bitcoinTxid: input.bitcoinTxid,
        depositScript: input.depositScript,
        reclaimScript: input.reclaimScript,
        stacksRecipient: input.stacksRecipient,
        amountSats: input.amountSats,
        maxSignerFeeSats: input.maxSignerFeeSats,
        ...(input.bitcoinTxOutputIndex === undefined ? {} : { bitcoinTxOutputIndex: input.bitcoinTxOutputIndex }),
        ...(input.transactionHex === undefined ? {} : { transactionHex: input.transactionHex }),
      };
      const emily: EmilyDeposit =
        sbtcBridge === undefined
          ? await notifySbtcDeposit(notifyInput)
          : await notifySbtcDeposit(notifyInput, sbtcBridge);
      return c.json(
        {
          schemaVersion: SCHEMA_VERSION,
          requestId: c.get("requestId"),
          network: "stacks:mainnet" as const,
          data: {
            bitcoinTxid: emily.bitcoinTxid,
            bitcoinTxOutputIndex: emily.bitcoinTxOutputIndex,
            recipient: emily.recipient,
            amount: emily.amount,
            status: emily.status,
            statusMessage: emily.statusMessage,
            complete: false as const,
            parameters: emily.parameters,
          },
          context: {
            ...context(),
            warnings: ["Emily accepted the deposit for tracking. A Bitcoin txid is not an sBTC mint."],
          },
        },
        200,
      );
    } catch (error) {
      throw new ApiError(
        "INVALID_REQUEST",
        error instanceof Error ? error.message : "Emily did not accept the deposit",
      );
    }
  });

  app.openapi(planRoute, async (c) => {
    const body = c.req.valid("json");
    const principal = writer(await admit(c), "quotes:write");
    if (principal.kind === "session" && principal.network !== body.network) {
      throw new ApiError("NETWORK_MISMATCH", `Session is for ${principal.network}`);
    }
    if (body.quote.network !== body.network || body.intent.action !== body.quote.action) {
      throw new ApiError("INVALID_REQUEST", "plan quote does not match the request network or action");
    }
    await requireEnabled(deps.sql, {
      network: body.network,
      marketId: body.quote.marketId,
      action: body.quote.action,
    });
    const owner = quoteOwner(principal, body.owner);
    const at = now();
    const plan = await mintPlan({
      network: body.network,
      owner,
      now: at,
      intent: intentFromBody(body.intent),
      quote: toQuoteWire(body.quote),
      reads,
    });
    return c.json(
      {
        schemaVersion: SCHEMA_VERSION,
        requestId: c.get("requestId"),
        network: `stacks:${body.network}` as const,
        data: plan,
        context: context(),
      },
      200,
    );
  });

  app.openapi(startWorkflowRoute, async (c) => {
    const input = c.req.valid("json");
    const principal = writer(await admit(c), "workflows:write");
    if (principal.kind === "session" && principal.network !== input.network) {
      throw new ApiError("NETWORK_MISMATCH", `Session is for ${principal.network}`);
    }
    const ownerAddress = principal.kind === "session" ? principal.address : input.ownerAddress;
    if (ownerAddress === undefined) throw new ApiError("INVALID_REQUEST", "ownerAddress is required for an API key");

    const started = await startWorkflow(
      { sql: deps.sql, now },
      {
        network: input.network,
        quoteId: input.quoteId,
        idempotencyKey: input.idempotencyKey,
        appId: principal.appId,
        ownerAddress,
      },
    );
    return c.json(
      {
        schemaVersion: SCHEMA_VERSION,
        requestId: c.get("requestId"),
        network: `stacks:${input.network}` as const,
        data: {
          workflowId: started.workflow.id,
          state: started.workflow.state,
          nextAction: started.workflow.nextAction,
          plan: serializePlan(started.plan),
        },
        context: context(),
      },
      200,
    );
  });

  app.openapi(signatureRoute, async (c) => {
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");
    const principal = writer(await admit(c), "workflows:write");
    const outcome = await recordSignature(
      { sql: deps.sql, now },
      {
        network: input.network,
        workflowId: id,
        stepId: input.stepId,
        appId: principal.appId,
        ownerAddress: principal.kind === "session" ? principal.address : null,
        walletResult: input.walletResult,
      },
    );
    return c.json(
      {
        schemaVersion: SCHEMA_VERSION,
        requestId: c.get("requestId"),
        network: `stacks:${input.network}` as const,
        data: outcome,
        context: context(),
      },
      200,
    );
  });

  app.openapi(attachBroadcastRoute, async (c) => {
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");
    const principal = writer(await admit(c), "workflows:write");
    const attached = await attachFoundBroadcast(
      { sql: deps.sql, now },
      {
        network: input.network,
        workflowId: id,
        appId: principal.appId,
        ownerAddress: principal.kind === "session" ? principal.address : null,
        txid: input.txid,
        ...(input.reclaimPublicKey === undefined ? {} : { reclaimPublicKey: input.reclaimPublicKey }),
      },
    );
    return c.json(
      {
        schemaVersion: SCHEMA_VERSION,
        requestId: c.get("requestId"),
        network: `stacks:${input.network}` as const,
        data: attached,
        context: context(),
      },
      200,
    );
  });

  app.openapi(cancelWorkflowRoute, async (c) => {
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");
    const principal = writer(await admit(c), "workflows:write");
    const cancelled = await cancelWorkflow(
      { sql: deps.sql, now },
      {
        network: input.network,
        workflowId: id,
        appId: principal.appId,
        ownerAddress: principal.kind === "session" ? principal.address : null,
      },
    );
    return c.json(
      {
        schemaVersion: SCHEMA_VERSION,
        requestId: c.get("requestId"),
        network: `stacks:${input.network}` as const,
        data: cancelled,
        context: context(),
      },
      200,
    );
  });

  app.openapi(createWebhookEndpointRoute, async (c) => {
    const input = c.req.valid("json");
    const principal = await admit(c);
    if (principal.kind !== "key") throw new ApiError("FORBIDDEN", "API key is required to manage webhooks");
    requireScope(principal, "webhooks:manage");

    const endpoint = await createWebhookEndpoint(deps.sql, {
      appId: principal.appId,
      url: input.url,
      events: input.events,
    });

    return c.json(
      {
        schemaVersion: SCHEMA_VERSION,
        requestId: c.get("requestId"),
        network: "stacks:mainnet" as const,
        data: {
          id: endpoint.id,
          url: endpoint.url,
          events: endpoint.events,
          active: endpoint.active,
          createdAt: endpoint.createdAt.toISOString(),
          secret: endpoint.secret,
        },
        context: context(),
      },
      201,
    );
  });

  app.openapi(listWebhookEndpointsRoute, async (c) => {
    const principal = await admit(c);
    if (principal.kind !== "key") throw new ApiError("FORBIDDEN", "API key is required to manage webhooks");
    requireScope(principal, "webhooks:manage");

    const items = await listWebhookEndpoints(deps.sql, principal.appId);
    return c.json(
      {
        schemaVersion: SCHEMA_VERSION,
        requestId: c.get("requestId"),
        network: "stacks:mainnet" as const,
        data: {
          items: items.map((item) => ({
            id: item.id,
            url: item.url,
            events: item.events,
            active: item.active,
            createdAt: item.createdAt.toISOString(),
          })),
        },
        context: context(),
      },
      200,
    );
  });

  app.openapi(deleteWebhookEndpointRoute, async (c) => {
    const { id } = c.req.valid("param");
    const principal = await admit(c);
    if (principal.kind !== "key") throw new ApiError("FORBIDDEN", "API key is required to manage webhooks");
    requireScope(principal, "webhooks:manage");

    const deleted = await deleteWebhookEndpoint(deps.sql, principal.appId, id);
    if (!deleted) {
      throw new ApiError("NOT_FOUND", `Webhook endpoint ${id} not found`);
    }

    return c.json(
      {
        schemaVersion: SCHEMA_VERSION,
        requestId: c.get("requestId"),
        network: "stacks:mainnet" as const,
        data: { deleted: true },
        context: context(),
      },
      200,
    );
  });

  app.doc31("/v1/openapi.json", OPENAPI_CONFIG);
  return app;
}
