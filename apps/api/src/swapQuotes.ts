import { executableContractIds } from "@stacks-capital/config";
import { AlexSDK, type TokenInfo } from "alex-sdk";
import { VelarSDK } from "@velarprotocol/velar-sdk";
import {
  CANONICAL_SWAP_ASSETS,
  isNativeStx,
  providerToken,
  publicSwapAsset,
  resolveListedAsset,
  type ListedSwapAsset,
  type SwapAsset,
  type SwapProvider,
} from "./swapMarkets.ts";
import { bitflowWalletCall, sdkWalletCall, type SwapWalletCall } from "./swapWalletCall.ts";

export type { ListedSwapAsset, SwapAsset, SwapProvider } from "./swapMarkets.ts";
export { MAINNET_SWAP_ASSETS } from "./swapMarkets.ts";
export type SwapOfferStatus = "executable" | "quote_only";

export type SwapQuoteRequest = {
  network: "mainnet";
  owner: string;
  inputAsset: string;
  outputAsset: string;
  amount: string;
  slippageBps: number;
};

export type SwapOffer = {
  provider: SwapProvider;
  rank: number;
  status: SwapOfferStatus;
  inputAsset: string;
  outputAsset: string;
  amountIn: string;
  amountOut: string;
  minimumAmountOut: string;
  fee: { asset: string; quantity: string } | null;
  priceImpactBps: number | null;
  route: string[];
  targetContract: string;
  observedAt: string;
  expiresAt: string;
  evidenceSource: string;
  executionReason: string;
  walletCall?: SwapWalletCall;
};

export type SwapProviderFailure = { provider: SwapProvider; reason: string };
export type SwapQuoteComparison = {
  assets: SwapAsset[];
  offers: SwapOffer[];
  unavailable: SwapProviderFailure[];
};

export type SwapQuoteProvider = {
  readonly name: SwapProvider;
  quote(request: SwapQuoteRequest, now: Date): Promise<Omit<SwapOffer, "rank" | "status" | "executionReason">>;
};

const BITFLOW_BASE = "https://bff.bitflowapis.finance/api/quotes/v1";

function asset(value: string, catalog: readonly ListedSwapAsset[] = CANONICAL_SWAP_ASSETS): ListedSwapAsset {
  return resolveListedAsset(value, catalog);
}

function integer(value: unknown, label: string): string {
  const text = typeof value === "number" ? String(Math.trunc(value)) : String(value);
  if (!/^\d+$/.test(text)) throw new Error(`${label} was not a non-negative integer`);
  return BigInt(text).toString();
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} was malformed`);
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} was missing`);
  return value;
}

function applySlippage(amount: string, slippageBps: number): string {
  return ((BigInt(amount) * BigInt(10_000 - slippageBps)) / 10_000n).toString();
}

function rescale(quantity: string, fromDecimals: number, toDecimals: number): string {
  const value = BigInt(quantity);
  if (fromDecimals === toDecimals) return value.toString();
  if (fromDecimals < toDecimals) return (value * 10n ** BigInt(toDecimals - fromDecimals)).toString();
  return (value / 10n ** BigInt(fromDecimals - toDecimals)).toString();
}

function toDisplayAmount(quantity: string, decimals: number): number {
  const whole = quantity.length > decimals ? quantity.slice(0, -decimals) : "0";
  const fraction = quantity.padStart(decimals + 1, "0").slice(-decimals);
  const result = Number(`${whole}.${fraction}`);
  if (!Number.isFinite(result) || result <= 0) throw new Error("Amount is outside the provider SDK's safe range");
  return result;
}

function floorProviderNumber(value: unknown, label: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > Number.MAX_SAFE_INTEGER) {
    throw new Error(`${label} was outside the safe integer range`);
  }
  return BigInt(Math.floor(numeric)).toString();
}

function sdkMinimumOutput(postConditions: readonly unknown[], output: SwapAsset, provider: "ALEX" | "Velar"): string {
  const contractAsset = output.assetId.split(":contract:")[1]?.replace(":", "::") ?? null;
  for (const item of postConditions) {
    const condition = record(item, `${provider} post-condition`);
    if (condition.condition !== "gte") continue;
    const isOutput = isNativeStx(output)
      ? condition.type === "stx-postcondition"
      : typeof condition.asset === "string" && condition.asset === contractAsset;
    if (isOutput) return integer(condition.amount, `${provider} minimum output post-condition`);
  }
  throw new Error(`${provider} transaction did not enforce a minimum output for the exact receive asset`);
}

function expiry(now: Date): string {
  return new Date(now.getTime() + 30_000).toISOString();
}

async function json(response: Response, provider: SwapProvider): Promise<Record<string, unknown>> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof body === "object" && body !== null ? JSON.stringify(body).slice(0, 240) : response.statusText;
    throw new Error(`${provider} returned HTTP ${response.status}: ${detail}`);
  }
  return record(body, `${provider} response`);
}

export function bitflowProvider(
  fetcher: typeof fetch = globalThis.fetch,
  catalog: readonly ListedSwapAsset[] = CANONICAL_SWAP_ASSETS,
): SwapQuoteProvider {
  return {
    name: "bitflow",
    async quote(request, now) {
      const input = asset(request.inputAsset, catalog);
      const output = asset(request.outputAsset, catalog);
      const inputToken = providerToken(input, "bitflow");
      const outputToken = providerToken(output, "bitflow");
      const quote = await json(
        await fetcher(`${BITFLOW_BASE}/quote`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            input_token: inputToken,
            output_token: outputToken,
            amount_in: request.amount,
            amm_strategy: "best",
            slippage_tolerance: request.slippageBps / 100,
            allow_split: false,
          }),
        }),
        "bitflow",
      );
      if (quote.success !== true) throw new Error("Bitflow did not return a successful quote");
      const amountOut = integer(quote.amount_out, "Bitflow amount_out");
      const minimumAmountOut = integer(quote.min_amount_out, "Bitflow min_amount_out");
      const executionPath = quote.execution_path;
      if (!Array.isArray(executionPath) || executionPath.length === 0)
        throw new Error("Bitflow execution path was missing");
      const swap = await json(
        await fetcher(`${BITFLOW_BASE}/swap`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            execution_path: executionPath,
            amount_in: request.amount,
            amount_out: amountOut,
            input_token: inputToken,
            output_token: outputToken,
            input_token_decimals: quote.input_token_decimals,
            output_token_decimals: quote.output_token_decimals,
            slippage_tolerance: request.slippageBps / 100,
            swap_parameters_type: "simple",
          }),
        }),
        "bitflow",
      );
      if (swap.success !== true) throw new Error("Bitflow did not return a successful swap builder payload");
      const targetContract = nonEmptyString(swap.swap_contract, "Bitflow swap contract");
      const postConditions = swap.post_conditions;
      if (!Array.isArray(postConditions)) throw new Error("Bitflow transaction post-conditions were missing");
      const outputCondition = postConditions.find((item) => {
        const condition = record(item, "Bitflow post-condition");
        if (condition.condition_code !== "greater_than_or_equal_to" || condition.token_contract !== outputToken) {
          return false;
        }
        // Bitflow emits contract_* when the pool sends the receive asset, and
        // standard_* when the user principal is the protected party.
        return isNativeStx(output)
          ? condition.post_condition_type === "contract_stx" || condition.post_condition_type === "standard_stx"
          : condition.post_condition_type === "standard_fungible" ||
              condition.post_condition_type === "contract_fungible";
      });
      if (outputCondition === undefined)
        throw new Error("Bitflow transaction did not enforce a minimum output for the exact receive asset");
      const enforcedMinimum = integer(
        record(outputCondition, "Bitflow output post-condition").amount,
        "Bitflow minimum output post-condition",
      );
      const quotedMinimum = BigInt(minimumAmountOut);
      const enforced = BigInt(enforcedMinimum);
      // Bitflow's builder can round its floating slippage conversion down by one
      // base unit. Display and rank the actual onchain floor, never the higher API value.
      if (enforced <= 0n || enforced > quotedMinimum || quotedMinimum - enforced > 1n) {
        throw new Error("Bitflow transaction minimum did not match the quote within one base unit");
      }
      const routePath = quote.route_path;
      const route = Array.isArray(routePath)
        ? routePath.map((item) => nonEmptyString(item, "Bitflow route leg"))
        : executionPath.map((item) =>
            nonEmptyString(record(item, "Bitflow execution leg").pool_contract, "Bitflow pool contract"),
          );
      const feeQuantity = quote.fee === undefined || quote.fee === null ? null : integer(quote.fee, "Bitflow fee");
      const impact = quote.price_impact_bps;
      const priceImpactBps = impact === undefined || impact === null ? null : Number(impact);
      if (priceImpactBps !== null && (!Number.isFinite(priceImpactBps) || priceImpactBps < 0)) {
        throw new Error("Bitflow price impact was invalid");
      }
      return {
        provider: "bitflow",
        inputAsset: input.assetId,
        outputAsset: output.assetId,
        amountIn: request.amount,
        amountOut,
        minimumAmountOut: enforcedMinimum,
        fee: feeQuantity === null ? null : { asset: input.assetId, quantity: feeQuantity },
        priceImpactBps,
        route,
        targetContract,
        observedAt: now.toISOString(),
        expiresAt: expiry(now),
        evidenceSource: `${BITFLOW_BASE}/quote`,
        walletCall: bitflowWalletCall(swap, request.owner),
      };
    },
  };
}

function alexCurrency(tokens: TokenInfo[], selected: ListedSwapAsset): TokenInfo["id"] {
  const configured = selected.providerTokens.alex;
  if (configured !== undefined) {
    const match = tokens.find((token) => token.id === configured);
    if (match !== undefined) return match.id;
  }
  if (isNativeStx(selected)) {
    const stx = tokens.find((token) => token.id === "token-wstx");
    if (stx !== undefined) return stx.id;
  }
  const contractAsset = selected.assetId.split(":contract:")[1]?.replace(":", "::");
  const found = tokens.find((token) => token.underlyingToken === contractAsset || token.wrapToken === contractAsset);
  if (found === undefined) throw new Error("ALEX does not list this pair");
  return found.id;
}

export function alexProvider(
  factory: () => AlexSDK = () => new AlexSDK(),
  catalog: readonly ListedSwapAsset[] = CANONICAL_SWAP_ASSETS,
): SwapQuoteProvider {
  return {
    name: "alex",
    async quote(request, now) {
      const input = asset(request.inputAsset, catalog);
      const output = asset(request.outputAsset, catalog);
      const sdk = factory();
      const tokens = await sdk.fetchSwappableCurrency();
      const from = alexCurrency(tokens, input);
      const to = alexCurrency(tokens, output);
      // ALEX's public SDK contract uses a uniform 8-decimal unit for every token,
      // even when the underlying asset (notably STX) has a different precision.
      const alexAmountIn = rescale(request.amount, input.decimals, 8);
      const alexAmountOut = (await sdk.getAmountTo(from, BigInt(alexAmountIn), to)).toString();
      if (BigInt(alexAmountOut) <= 0n) throw new Error("ALEX returned zero output for this exact pair");
      const alexMinimumOut = applySlippage(alexAmountOut, request.slippageBps);
      const amountOut = rescale(alexAmountOut, 8, output.decimals);
      const minimumAmountOut = rescale(alexMinimumOut, 8, output.decimals);
      const transaction = await sdk.runSwap(request.owner, from, to, BigInt(alexAmountIn), BigInt(alexMinimumOut));
      const enforcedMinimum = sdkMinimumOutput(transaction.postConditions as unknown[], output, "ALEX");
      if (enforcedMinimum !== minimumAmountOut) {
        throw new Error(
          `ALEX transaction minimum ${enforcedMinimum} did not match normalized quote minimum ${minimumAmountOut}`,
        );
      }
      const targetContract = `${transaction.contractAddress}.${transaction.contractName}`;
      const waypoints = await sdk.getWayPoints(await sdk.getRoute(from, to));
      const walletCall = sdkWalletCall(transaction as unknown as Record<string, unknown>, request.owner);
      return {
        provider: "alex",
        inputAsset: input.assetId,
        outputAsset: output.assetId,
        amountIn: request.amount,
        amountOut,
        minimumAmountOut,
        fee: null,
        priceImpactBps: null,
        route: waypoints.map((token) => token.underlyingToken),
        targetContract,
        observedAt: now.toISOString(),
        expiresAt: expiry(now),
        evidenceSource: "alex-sdk@3.2.1 mainnet pool reads",
        ...(walletCall === undefined ? {} : { walletCall }),
      };
    },
  };
}

export function velarProvider(
  factory: () => VelarSDK = () => new VelarSDK({ headless: true }),
  catalog: readonly ListedSwapAsset[] = CANONICAL_SWAP_ASSETS,
): SwapQuoteProvider {
  return {
    name: "velar",
    async quote(request, now) {
      const input = asset(request.inputAsset, catalog);
      const output = asset(request.outputAsset, catalog);
      const inputToken = providerToken(input, "velar");
      const outputToken = providerToken(output, "velar");
      let swap: Awaited<ReturnType<VelarSDK["getSwapInstance"]>>;
      try {
        swap = await factory().getSwapInstance({
          account: request.owner,
          inToken: inputToken,
          outToken: outputToken,
        });
      } catch (error) {
        throw velarRouteError(error);
      }
      const displayAmount = toDisplayAmount(request.amount, input.decimals);
      let quote: Awaited<ReturnType<typeof swap.getComputedAmount>>;
      try {
        quote = await swap.getComputedAmount({ amount: displayAmount, slippage: request.slippageBps / 100 });
      } catch (error) {
        throw velarRouteError(error);
      }
      if (quote.valid !== true) throw new Error(quote.errorMessage || "Velar did not return a valid route");
      const quoteRecord = quote as typeof quote & { amountOut?: unknown; route?: string[] };
      const amountOut = floorProviderNumber(quoteRecord.amountOut, "Velar amountOut");
      let transaction: Awaited<ReturnType<typeof swap.swap>>;
      try {
        transaction = await swap.swap({ amount: displayAmount, slippage: request.slippageBps / 100 });
      } catch (error) {
        throw velarRouteError(error);
      }
      const minimumAmountOut = sdkMinimumOutput(transaction.postConditions as unknown[], output, "Velar");
      const walletCall = sdkWalletCall(transaction as unknown as Record<string, unknown>, request.owner);
      return {
        provider: "velar",
        inputAsset: input.assetId,
        outputAsset: output.assetId,
        amountIn: request.amount,
        amountOut,
        minimumAmountOut,
        fee: null,
        priceImpactBps: null,
        route: quoteRecord.route ?? [inputToken, outputToken],
        targetContract: `${transaction.contractAddress}.${transaction.contractName}`,
        observedAt: now.toISOString(),
        expiresAt: expiry(now),
        evidenceSource: "@velarprotocol/velar-sdk@0.7.6 pinned mainnet pool reads",
        ...(walletCall === undefined ? {} : { walletCall }),
      };
    },
  };
}

function velarRouteError(error: unknown): Error {
  const text = error instanceof Error ? error.message : String(error);
  if (/asyncIterator|Path not found|Pool routes are not available|routes are not/i.test(text)) {
    return new Error("Velar has no route for this pair");
  }
  return error instanceof Error ? error : new Error(text);
}

function errorMessage(error: unknown): string {
  const text = error instanceof Error && error.message.length > 0 ? error.message : "";
  if (/asyncIterator/i.test(text)) return "No route for this pair";
  if (/Exact asset identity is not listed|does not list this pair/i.test(text)) return "This pair is not listed";
  if (text.length > 0) return text.slice(0, 300);
  return "Provider quote failed without a usable error";
}

async function within<T>(promise: Promise<T>, timeoutMs: number, provider: SwapProvider): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${provider} quote timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function compareSwapQuotes(
  request: SwapQuoteRequest,
  options: {
    providers?: readonly SwapQuoteProvider[];
    catalog?: readonly ListedSwapAsset[];
    now?: () => Date;
    timeoutMs?: number;
    allowedContracts?: readonly string[];
  } = {},
): Promise<SwapQuoteComparison> {
  if (request.inputAsset === request.outputAsset) throw new Error("Input and output assets must differ");
  if (!/^\d+$/.test(request.amount) || BigInt(request.amount) <= 0n)
    throw new Error("Amount must be a positive integer");
  if (!Number.isInteger(request.slippageBps) || request.slippageBps < 0 || request.slippageBps > 300) {
    throw new Error("Slippage must be between 0 and 300 basis points");
  }
  const catalog = options.catalog ?? CANONICAL_SWAP_ASSETS;
  const input = asset(request.inputAsset, catalog);
  const output = asset(request.outputAsset, catalog);
  const now = options.now?.() ?? new Date();
  const providers = options.providers ?? [
    bitflowProvider(globalThis.fetch, catalog),
    velarProvider(() => new VelarSDK({ headless: true }), catalog),
    alexProvider(() => new AlexSDK(), catalog),
  ];
  const allowed = new Set(options.allowedContracts ?? executableContractIds("mainnet"));
  const outcomes = await Promise.allSettled(
    providers.map((provider) => within(provider.quote(request, now), options.timeoutMs ?? 12_000, provider.name)),
  );
  const offers: SwapOffer[] = [];
  const unavailable: SwapProviderFailure[] = [];
  outcomes.forEach((outcome, index) => {
    const provider = providers[index];
    if (provider === undefined) return;
    if (outcome.status === "rejected") {
      unavailable.push({ provider: provider.name, reason: errorMessage(outcome.reason) });
      return;
    }
    if (
      outcome.value.provider !== provider.name ||
      outcome.value.inputAsset !== request.inputAsset ||
      outcome.value.outputAsset !== request.outputAsset ||
      outcome.value.amountIn !== request.amount ||
      BigInt(outcome.value.amountOut) <= 0n ||
      BigInt(outcome.value.minimumAmountOut) <= 0n ||
      BigInt(outcome.value.minimumAmountOut) > BigInt(outcome.value.amountOut)
    ) {
      unavailable.push({
        provider: provider.name,
        reason: "Provider returned a quote that failed request binding checks",
      });
      return;
    }
    const approved = allowed.has(outcome.value.targetContract);
    offers.push({
      ...outcome.value,
      rank: 0,
      status: approved ? "executable" : "quote_only",
      executionReason: approved
        ? "Exact router target is approved by the active CapitalOS registry."
        : `Quote verified, but ${outcome.value.targetContract} is not approved by the active signed registry.`,
    });
  });
  offers.sort((left, right) => {
    const minimum = BigInt(right.minimumAmountOut) - BigInt(left.minimumAmountOut);
    if (minimum !== 0n) return minimum > 0n ? 1 : -1;
    return left.provider.localeCompare(right.provider);
  });
  offers.forEach((offer, index) => {
    offer.rank = index + 1;
  });
  return { assets: [publicSwapAsset(input), publicSwapAsset(output)], offers, unavailable };
}
