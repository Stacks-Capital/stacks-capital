import { BITFLOW_ALLOWED_POOLS, capabilityFor, contract, FUNGIBLE_ASSET_NAME } from "@stacks-capital/config";
import {
  amount,
  assertPositive,
  capitalError,
  formatAssetId,
  integerField,
  minOutFromSpot,
  parseQuantity,
  principalField,
  sip10,
  stringField,
  validatePlan,
  type CanonicalActivity,
  type ClarityValue,
  type Plan,
  type Quote,
  type StacksNetwork,
} from "@stacks-capital/core";
import { amountField, assetForPrincipal, effect } from "../events.ts";
import type { AdapterReads } from "../reads.ts";
import type { AdapterContext, Intent, Market, ProtocolAdapter } from "../types.ts";

export const BITFLOW_SWAP_VERSION = "bitflow-swap@0.1.0";
export const BITFLOW_MARKET_SBTC_USDCX = "bitflow.sbtc-usdcx";
export const DEFAULT_SLIPPAGE_BPS = 50n;
/** Product max — above this the quote is treated as an abusive unprotected swap. */
export const MAX_SLIPPAGE_BPS = 300n;
export const DEFAULT_MAX_STEPS = "8";

function sbtc(network: StacksNetwork) {
  return sip10(network, contract("sbtc", "sbtc-token", network).contractId, FUNGIBLE_ASSET_NAME.sbtc);
}

function usdcx(network: StacksNetwork) {
  return sip10(network, contract("usdcx", "usdcx", network).contractId, FUNGIBLE_ASSET_NAME.usdcx);
}

function swapMarket(ctx: AdapterContext): Market {
  const capability = capabilityFor("swap", ctx.network, "bitflow");
  return {
    id: BITFLOW_MARKET_SBTC_USDCX,
    protocol: "bitflow",
    action: "swap",
    network: ctx.network,
    suppliedAsset: formatAssetId(sbtc(ctx.network)),
    receiptAsset: formatAssetId(usdcx(ctx.network)),
    state: capability?.state ?? "disabled",
    warnings:
      capability?.state === "enabled"
        ? [
            "Allowlisted sBTC↔USDCx only. Live pool principal is not pinned; fixture routes only until a pool is verified.",
          ]
        : [capability?.reason ?? "Bitflow swap is not available"],
  };
}

function payingSbtc(intent: Intent): boolean {
  return intent.inputAsset !== "usdcx" && intent.inputAsset !== FUNGIBLE_ASSET_NAME.usdcx;
}

function routerId(network: StacksNetwork): string {
  return contract("bitflow", "dlmm-swap-router-v-1-2", network).contractId;
}

function assertRoute(
  ctx: AdapterContext,
  intent: Intent,
  reads: AdapterReads,
): { poolId: string; amountOut: bigint; minOut: bigint } {
  const swap = reads.swap;
  if (swap === undefined) throw capitalError("ORACLE_STALE", "Bitflow route snapshot is missing");
  const age = ctx.now.getTime() - Date.parse(swap.observedAt);
  if (swap.stale || !Number.isFinite(age) || age < 0 || age > swap.maxAgeMs) {
    throw capitalError("ORACLE_STALE", "Bitflow ticker/route is stale");
  }
  if (swap.routerId !== routerId(ctx.network)) {
    throw capitalError("CAPABILITY_DISABLED", "Bitflow router is not allowlisted");
  }
  const poolId = intent.routePool ?? swap.poolId;
  if (poolId !== swap.poolId) throw capitalError("PLAN_INVALID", "route pool does not match the quote snapshot");
  if (BITFLOW_ALLOWED_POOLS.length > 0 && !BITFLOW_ALLOWED_POOLS.includes(poolId)) {
    throw capitalError("CAPABILITY_DISABLED", "Bitflow pool is not allowlisted");
  }
  if (BITFLOW_ALLOWED_POOLS.length === 0 && swap.source !== "fixture") {
    throw capitalError("CAPABILITY_DISABLED", "no verified sBTC/USDCx Bitflow pool is pinned");
  }
  if (swap.amountIn !== intent.amount) throw capitalError("QUOTE_EXPIRED", "route amountIn does not match the intent");
  const amountOut = parseQuantity(swap.amountOut);
  const slippage = intent.slippageBps !== undefined ? parseQuantity(intent.slippageBps) : DEFAULT_SLIPPAGE_BPS;
  if (slippage < 0n || slippage > MAX_SLIPPAGE_BPS) {
    throw capitalError("PLAN_INVALID", `slippage must be between 0 and ${MAX_SLIPPAGE_BPS.toString(10)} bps`);
  }
  const quotedMin = minOutFromSpot(amountOut, slippage);
  const floor = minOutFromSpot(amountOut, MAX_SLIPPAGE_BPS);
  const minOut = intent.minOut !== undefined ? parseQuantity(intent.minOut) : quotedMin;
  if (minOut <= 0n && amountOut > 0n) {
    throw capitalError("PLAN_INVALID", "min-out must be greater than zero");
  }
  if (minOut < floor) {
    throw capitalError(
      "PLAN_INVALID",
      `min-out is below the ${MAX_SLIPPAGE_BPS.toString(10)} bps floor for this route`,
    );
  }
  if (minOut > amountOut) throw capitalError("QUOTE_EXPIRED", "min-out is above the quoted amount");
  return { poolId, amountOut, minOut };
}

export function createBitflowSwapAdapter(reads: AdapterReads): ProtocolAdapter {
  return {
    protocol: "bitflow",
    version: BITFLOW_SWAP_VERSION,
    semantics: {
      amountEncoding: "base_10_integer_base_units",
      unsupportedFieldPolicy: "omit",
      positionModel:
        "Swaps reconcile from canonical input and output asset deltas; ticker output is quote evidence only.",
      assets: [
        { unit: "sBTC base unit", decimals: 8, evidence: "sbtc-token SIP-010 deployment" },
        { unit: "USDCx base unit", decimals: 6, evidence: "usdcx SIP-010 deployment" },
      ],
      actions: [
        {
          action: "swap",
          inputUnit: "route input base unit",
          outputUnit: "route output base unit",
          rounding: "down",
          completionEvidence: "canonical swap event and output balance delta at or above min-out",
          postConditionPolicy: "deny_mode",
        },
      ],
    },
    describeCapabilities(ctx) {
      const found = capabilityFor("swap", ctx.network, "bitflow");
      return found ? [found] : [];
    },
    listMarkets(ctx) {
      return [swapMarket(ctx)];
    },
    getMarket(ctx, marketId) {
      if (marketId !== BITFLOW_MARKET_SBTC_USDCX) throw capitalError("UNSUPPORTED_ACTION", marketId);
      return swapMarket(ctx);
    },
    readPositions(ctx, owner) {
      return {
        value: [{ owner, marketId: BITFLOW_MARKET_SBTC_USDCX, kind: "wallet", quantity: reads.balances?.sbtc ?? "0" }],
        observedAt: ctx.now.toISOString(),
        source: reads.swap?.source ?? "fixture",
        stale: reads.swap?.stale ?? true,
        warnings: [],
      };
    },
    quote(ctx, intent) {
      return quoteSwap(ctx, intent, reads);
    },
    buildPlan(ctx, quote, intent) {
      return buildSwapPlan(ctx, quote, intent, reads);
    },
    validatePlan(_ctx, plan, quote, signing) {
      return validatePlan(plan, quote, signing);
    },
    decodeEvents(ctx, events) {
      const activities: CanonicalActivity[] = [];
      for (const event of events) {
        const action = stringField(event, "action");
        if (action !== "swap-x-for-y" && action !== "swap-y-for-x") continue;

        const forward = action === "swap-x-for-y";
        const paid = assetForPrincipal(ctx.network, principalField(event, forward ? "x-token" : "y-token"));
        const received = assetForPrincipal(ctx.network, principalField(event, forward ? "y-token" : "x-token"));

        // `x-amount` and `y-amount` are what the caller put in; `dx` and `dy` are what reached the
        // pool and came back out. The received side is the one a quote's min-out is judged against,
        // so it is read from the delta rather than from the request.
        const spent = amountField(event, forward ? "x-amount" : "y-amount", forward ? "dx" : "dy");
        const gained = integerField(event, forward ? "dy" : "dx");
        const owner = principalField(event, "caller");

        activities.push({
          id: event.id,
          kind: "bitflow_swap",
          blockHash: event.blockHash,
          canonical: true,
          ...(owner === null ? {} : { owner }),
          effects: [...effect("out", paid, spent), ...effect("in", received, gained)],
        });
      }
      return activities;
    },
    reconcile(_ctx, expected, observed) {
      return {
        matched: expected === observed,
        warnings: expected === observed ? [] : ["Swap output does not meet the planned min-out"],
      };
    },
    explainRisk(ctx) {
      const capability = capabilityFor("swap", ctx.network, "bitflow");
      const stale = reads.swap?.stale === true || capability?.state !== "enabled";
      return {
        disclosures: [
          "Only the allowlisted sBTC↔USDCx pair on dlmm-swap-router-v-1-2 is planned.",
          "min-out is enforced onchain. Post conditions are deny-mode send_lte and receive_gte.",
          "A stale Bitflow ticker or unpinned live pool fails closed. v-1-1 is superseded.",
        ],
        stale,
        variables: {
          router: ctx.network === "mainnet" ? routerId(ctx.network) : "disabled",
          slippageBps: DEFAULT_SLIPPAGE_BPS.toString(10),
          maxSteps: DEFAULT_MAX_STEPS,
        },
        alerts: stale ? ["Bitflow route is stale or disabled; quotes fail closed."] : [],
      };
    },
  };
}

function quoteSwap(ctx: AdapterContext, intent: Intent, reads: AdapterReads): Quote {
  if (intent.action !== "swap") throw capitalError("UNSUPPORTED_ACTION", intent.action);
  if (intent.marketId !== BITFLOW_MARKET_SBTC_USDCX) throw capitalError("UNSUPPORTED_ACTION", intent.marketId);
  const capability = capabilityFor("swap", ctx.network, "bitflow");
  if (ctx.network !== "mainnet") {
    throw capitalError("CAPABILITY_DISABLED", capability?.reason ?? "Bitflow has no public testnet ticker or router");
  }
  const paySbtc = payingSbtc(intent);
  const inputAsset = paySbtc ? sbtc(ctx.network) : usdcx(ctx.network);
  const outputAsset = paySbtc ? usdcx(ctx.network) : sbtc(ctx.network);
  const inputQty = parseQuantity(intent.amount);
  assertPositive(amount(inputAsset, inputQty), "swap amount");
  const route = assertRoute(ctx, intent, reads);
  const executable = capability?.state === "enabled";
  return {
    id: `q_bitflow_swap_${ctx.now.getTime()}`,
    action: "swap",
    marketId: BITFLOW_MARKET_SBTC_USDCX,
    network: ctx.network,
    input: [amount(inputAsset, inputQty)],
    expectedOutput: [amount(outputAsset, route.amountOut)],
    fees: [],
    snapshots: [`router:${routerId(ctx.network)}`, `pool:${route.poolId}`, `minOut:${route.minOut.toString(10)}`],
    expiresAt: new Date(ctx.now.getTime() + 2 * 60_000).toISOString(),
    executable,
    warnings: executable ? [] : [capability?.reason ?? "disabled"],
    registryVersion: ctx.registryVersion,
    adapterVersion: BITFLOW_SWAP_VERSION,
    minimumOutput: amount(outputAsset, route.minOut),
  };
}

function buildSwapPlan(ctx: AdapterContext, quote: Quote, intent: Intent, reads: AdapterReads): Plan {
  if (!quote.executable)
    throw capitalError("CAPABILITY_DISABLED", quote.warnings.join("; ") || "swap is not executable");
  const sender = ctx.owner;
  if (sender === undefined) throw capitalError("PLAN_INVALID", "owner is required to set post conditions");
  const route = assertRoute(ctx, intent, reads);
  const paySbtc = payingSbtc(intent);
  const xIsSbtc = reads.swap?.xAsset !== "usdcx";
  const xForY = (paySbtc && xIsSbtc) || (!paySbtc && !xIsSbtc);
  const functionName = xForY ? "swap-x-for-y-simple-range-multi" : "swap-y-for-x-simple-range-multi";
  const xToken = xIsSbtc
    ? contract("sbtc", "sbtc-token", ctx.network).contractId
    : contract("usdcx", "usdcx", ctx.network).contractId;
  const yToken = xIsSbtc
    ? contract("usdcx", "usdcx", ctx.network).contractId
    : contract("sbtc", "sbtc-token", ctx.network).contractId;
  const input = quote.input[0];
  const output = quote.minimumOutput ?? quote.expectedOutput[0];
  if (input === undefined || output === undefined) throw capitalError("PLAN_INVALID", "swap quote is missing amounts");
  const args: ClarityValue[] = [
    { type: "principal", value: route.poolId },
    { type: "principal", value: xToken },
    { type: "principal", value: yToken },
    { type: "uint", value: intent.amount },
    { type: "uint", value: route.minOut.toString(10) },
    { type: "uint", value: DEFAULT_MAX_STEPS },
    { type: "none" },
  ];
  return {
    id: `p_bitflow_${quote.id}`,
    quoteId: quote.id,
    network: ctx.network,
    registryVersion: ctx.registryVersion,
    adapterVersion: BITFLOW_SWAP_VERSION,
    expiresAt: quote.expiresAt,
    reviewSummary: `Swap ${intent.amount} ${paySbtc ? "sBTC" : "USDCx"} for at least ${route.minOut.toString(10)} ${paySbtc ? "USDCx" : "sBTC"} on Bitflow ${functionName}. min-out is onchain.`,
    steps: [
      {
        id: functionName,
        dependsOn: [],
        expectedAssetEffects: quote.expectedOutput,
        payload: {
          kind: "stacks_contract_call",
          contractId: routerId(ctx.network),
          functionName,
          functionArgs: args,
          postConditions: [
            { principal: sender, mode: "send_lte", amount: input },
            { principal: sender, mode: "receive_gte", amount: output },
          ],
          postConditionMode: "deny",
          network: ctx.network,
        },
      },
    ],
  };
}
