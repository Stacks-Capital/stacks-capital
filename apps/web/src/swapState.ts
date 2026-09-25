import { parseAssetId, type PlanWire, type QuoteWire, type StacksNetwork } from "@stacks-capital/sdk";

export const REFRESH_MARGIN_SECONDS = 15;

export type SwapRouteLeg = { contractId: string; functionName: string };

export type SwapViewLike = {
  route: SwapRouteLeg[];
  sending: string;
  expectedReceived: string;
  minimumReceived: string | null;
  impactBps: string | null;
  impactNote: string | null;
  expiresInSeconds: number;
  expired: boolean;
  needsRefresh: boolean;
  warnings: string[];
};

/*
 * Contract principals and asset names below are copied from the signed registry
 * (ASSETS in packages/config/src/deployments.ts). apps/web may not import config,
 * so scripts/checks/web-registry-assets.test.ts pins these values against it.
 * Change the registry first, then this table, or that check fails.
 */
export const CANONICAL_SWAP_ASSETS = {
  sbtc: {
    symbol: "sBTC",
    name: "Stacks Bitcoin",
    decimals: 8,
    native: false,
    mainnetContract: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
    testnetContract: "SN3VMHXEN64ZZF71JQ5VESXDWTR301XTTXGF4J8F1.sbtc-token",
    assetName: "sbtc-token",
    feedKey: "BTC/USD",
  },
  usdcx: {
    symbol: "USDCx",
    name: "Bridged USDC",
    decimals: 6,
    native: false,
    mainnetContract: "SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx",
    testnetContract: "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.usdcx",
    assetName: "usdcx-token",
    feedKey: "USDC/USD",
  },
  stx: {
    symbol: "STX",
    name: "Stacks Token",
    decimals: 6,
    native: true,
    mainnetContract: "native:stacks:stx",
    testnetContract: "native:stacks:stx",
    assetName: "stx",
    feedKey: "STX/USD",
  },
} as const;

export type SwapAssetKey = keyof typeof CANONICAL_SWAP_ASSETS;

/**
 * Converts a human-readable decimal amount (e.g. "0.015") into exact integer base units (e.g. "1500000").
 * Avoids IEEE-754 floating-point inaccuracies by operating on strings.
 */
export function toBaseUnits(displayAmount: string, decimals: number): string {
  const trimmed = displayAmount.trim();
  if (!trimmed || trimmed === "0" || trimmed === ".") return "0";
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid decimal number format: "${displayAmount}"`);
  }

  const parts = trimmed.split(".");
  const intPart = parts[0] ?? "0";
  const fracPart = parts[1] ?? "";

  const paddedFrac = fracPart.padEnd(decimals, "0").slice(0, decimals);
  const combined = `${intPart}${paddedFrac}`.replace(/^0+/, "");
  return combined === "" ? "0" : combined;
}

/**
 * Converts raw integer base units (e.g. "1500000") into a human-readable decimal string (e.g. "0.015").
 */
export function fromBaseUnits(baseUnits: string, decimals: number): string {
  const trimmed = baseUnits.trim().replace(/^0+/, "");
  if (!trimmed) return "0";

  if (trimmed.length <= decimals) {
    const frac = trimmed.padStart(decimals, "0");
    const strippedFrac = frac.replace(/0+$/, "");
    return strippedFrac === "" ? "0" : `0.${strippedFrac}`;
  }

  const intPart = trimmed.slice(0, trimmed.length - decimals);
  const fracPart = trimmed.slice(trimmed.length - decimals).replace(/0+$/, "");

  return fracPart === "" ? intPart : `${intPart}.${fracPart}`;
}

export type AssetReconciliationResult = {
  reconciled: boolean;
  sentSymbol: string;
  sentDecimals: number;
  receivedSymbol: string;
  receivedDecimals: number;
  reason?: string;
};

type CanonicalSwapAsset = (typeof CANONICAL_SWAP_ASSETS)[SwapAssetKey];

/**
 * Compares one asset identifier from the quote against its canonical definition.
 * A substring match is not enough here: "SP...usdcx" is a substring of "SP...usdcx-token",
 * so the principal, asset name and network are each compared whole.
 * Returns null when they agree, or the reason they do not.
 */
function deploymentMismatch(
  assetId: string,
  info: CanonicalSwapAsset,
  network: StacksNetwork,
  side: "Input" | "Output",
): string | null {
  let parsed: ReturnType<typeof parseAssetId>;
  try {
    parsed = parseAssetId(assetId);
  } catch {
    return `${side} asset "${assetId}" is not a canonical asset identifier.`;
  }

  if (parsed.network !== network) {
    return `${side} asset "${assetId}" is on ${parsed.network}, but this session is on ${network}.`;
  }

  if (info.native) {
    if (parsed.identity.kind !== "native" || parsed.identity.symbol !== info.assetName) {
      return `${side} asset "${assetId}" does not match the canonical native ${info.symbol} asset.`;
    }
    return null;
  }

  if (parsed.identity.kind !== "contract") {
    return `${side} asset "${assetId}" is a native asset, but ${info.symbol} is a contract asset.`;
  }

  const expectedPrincipal = network === "mainnet" ? info.mainnetContract : info.testnetContract;
  if (parsed.identity.principal !== expectedPrincipal) {
    return `${side} asset contract "${parsed.identity.principal}" does not match canonical deployment "${expectedPrincipal}" for ${network}.`;
  }

  if (parsed.identity.assetName !== info.assetName) {
    return `${side} asset name "${parsed.identity.assetName}" does not match canonical asset name "${info.assetName}".`;
  }

  return null;
}

/**
 * Reconciles swap input and output asset identifiers and decimal precision against canonical definitions.
 * Acceptance Evidence 3: Asset identifiers and decimals reconcile exactly.
 */
export function reconcileSwapAssets(
  quote: {
    input: Array<{ asset: string; quantity: string }>;
    expectedOutput: Array<{ asset: string; quantity: string }>;
  },
  network: StacksNetwork,
): AssetReconciliationResult {
  const input = quote.input[0];
  const output = quote.expectedOutput[0];

  if (!input || !output) {
    return {
      reconciled: false,
      sentSymbol: "unknown",
      sentDecimals: 0,
      receivedSymbol: "unknown",
      receivedDecimals: 0,
      reason: "Quote is missing input or expected output asset definitions.",
    };
  }

  const resolveAsset = (assetId: string) => {
    const lower = assetId.toLowerCase();
    if (lower.includes("sbtc")) return CANONICAL_SWAP_ASSETS.sbtc;
    if (lower.includes("usdcx") || lower.includes("usdc")) return CANONICAL_SWAP_ASSETS.usdcx;
    if (lower.includes("stx")) return CANONICAL_SWAP_ASSETS.stx;
    return null;
  };

  const sentInfo = resolveAsset(input.asset);
  const receivedInfo = resolveAsset(output.asset);

  if (!sentInfo || !receivedInfo) {
    return {
      reconciled: false,
      sentSymbol: sentInfo?.symbol ?? "unknown",
      sentDecimals: sentInfo?.decimals ?? 0,
      receivedSymbol: receivedInfo?.symbol ?? "unknown",
      receivedDecimals: receivedInfo?.decimals ?? 0,
      reason: `Unrecognized asset identifier in route: input="${input.asset}", output="${output.asset}"`,
    };
  }

  // Network and deployment verification, by exact identity rather than substring.
  const sentMismatch = deploymentMismatch(input.asset, sentInfo, network, "Input");
  const receivedMismatch = deploymentMismatch(output.asset, receivedInfo, network, "Output");
  const mismatch = sentMismatch ?? receivedMismatch;

  if (mismatch !== null) {
    return {
      reconciled: false,
      sentSymbol: sentInfo.symbol,
      sentDecimals: sentInfo.decimals,
      receivedSymbol: receivedInfo.symbol,
      receivedDecimals: receivedInfo.decimals,
      reason: mismatch,
    };
  }

  return {
    reconciled: true,
    sentSymbol: sentInfo.symbol,
    sentDecimals: sentInfo.decimals,
    receivedSymbol: receivedInfo.symbol,
    receivedDecimals: receivedInfo.decimals,
  };
}

export type MinimumOutputEnforcement = {
  enforced: boolean;
  minOutQuantity: string | null;
  minOutAsset: string | null;
  onchainArgVerified: boolean;
  postConditionVerified: boolean;
  denyModeVerified: boolean;
  reason?: string;
};

/**
 * Validates that minimum output is strictly enforced onchain in the plan contract call and post-conditions.
 * Acceptance Evidence 2: Minimum output is enforced by the plan/contract call.
 */
export function verifyMinimumOutputEnforcement(quote: QuoteWire, plan: PlanWire): MinimumOutputEnforcement {
  if (!quote.minimumOutput || !quote.minimumOutput.quantity || quote.minimumOutput.quantity === "0") {
    return {
      enforced: false,
      minOutQuantity: null,
      minOutAsset: null,
      onchainArgVerified: false,
      postConditionVerified: false,
      denyModeVerified: false,
      reason: "Quote lacks guaranteed minimumOutput floor.",
    };
  }

  const expectedMinQty = quote.minimumOutput.quantity;
  const minOutAsset = quote.minimumOutput.asset;

  // Search for the router swap step
  const swapStep = plan.steps.find(
    (step) =>
      step.payload.kind === "stacks_contract_call" && step.payload.functionName.toLowerCase().startsWith("swap-"),
  );

  if (!swapStep || swapStep.payload.kind !== "stacks_contract_call") {
    return {
      enforced: false,
      minOutQuantity: expectedMinQty,
      minOutAsset,
      onchainArgVerified: false,
      postConditionVerified: false,
      denyModeVerified: false,
      reason: "Plan does not contain an executable swap contract call step.",
    };
  }

  const payload = swapStep.payload;

  // 1. Check onchain function argument (e.g. minOut arg)
  const args = payload.functionArgs ?? [];
  const minOutArg = args.find((arg) => arg.type === "uint" && String(arg.value) === expectedMinQty);
  const onchainArgVerified = minOutArg !== undefined;

  // 2. Check deny-mode post condition protecting min-out received
  const postConditions = payload.postConditions ?? [];
  const minReceivePc = postConditions.find((pc) => pc.mode === "receive_gte" && pc.amount.quantity === expectedMinQty);
  const postConditionVerified = minReceivePc !== undefined;

  // 3. Deny mode verification
  const denyModeVerified = payload.postConditionMode === "deny";

  const enforced = onchainArgVerified && postConditionVerified && denyModeVerified;

  return {
    enforced,
    minOutQuantity: expectedMinQty,
    minOutAsset,
    onchainArgVerified,
    postConditionVerified,
    denyModeVerified,
    ...(enforced
      ? {}
      : {
          reason: `Enforcement check failed: onchainArg=${onchainArgVerified}, postCondition=${postConditionVerified}, denyMode=${denyModeVerified}`,
        }),
  };
}

export type PriceImpactTier = "low" | "medium" | "high" | "unknown";

/**
 * Classifies basis points of price impact into visual risk tiers.
 * < 100 bps (1%): low
 * 100 - 300 bps (1% - 3%): medium
 * > 300 bps (> 3%): high
 */
export function priceImpactCategory(impactBps: string | null): PriceImpactTier {
  if (impactBps === null) return "unknown";
  try {
    const val = BigInt(impactBps);
    if (val < 100n) return "low";
    if (val <= 300n) return "medium";
    return "high";
  } catch {
    return "unknown";
  }
}

/**
 * Strict guard checking whether a quote is legally signable right now.
 * Acceptance Evidence 1: Expired quotes cannot reach signing.
 */
export function isQuoteSignable(
  view: SwapViewLike | null,
  quoted: { quote: { expiresAt: string; executable: boolean; [key: string]: unknown }; [key: string]: unknown } | null,
  now: Date,
): boolean {
  if (!view || !quoted) return false;
  if (!quoted.quote.executable) return false;
  if (view.expired || view.needsRefresh) return false;
  if (!view.minimumReceived) return false;

  const expiryMs = new Date(quoted.quote.expiresAt).getTime();
  const nowMs = now.getTime();
  const remainingSeconds = Math.floor((expiryMs - nowMs) / 1000);

  // Hard stop if expired or within refresh margin (<= 15 seconds)
  if (remainingSeconds <= REFRESH_MARGIN_SECONDS) return false;

  return true;
}

/**
 * Formats a remaining seconds countdown into a human-readable status badge.
 */
export function formatExpiryCountdown(expiresInSeconds: number): {
  text: string;
  status: "valid" | "warning" | "expired";
} {
  if (expiresInSeconds <= 0) {
    return { text: "Quote expired", status: "expired" };
  }
  if (expiresInSeconds <= REFRESH_MARGIN_SECONDS) {
    return { text: `Expires in ${expiresInSeconds}s (Requote required)`, status: "warning" };
  }
  return { text: `Quote valid for ${expiresInSeconds}s`, status: "valid" };
}

/** Leaves 0.01 STX for the Stacks fee when Max is pressed on native STX. */
export const STX_SWAP_FEE_RESERVE = "10000";

export type HiroAccountBalances = {
  stx?: { balance?: string; locked?: string };
  fungible_tokens?: Record<string, { balance?: string }>;
};

/**
 * Maps a CapitalOS swap asset id onto the Hiro account-balances key.
 * Native STX is "stx". SIP-10 tokens use "principal::asset-name".
 */
export function hiroTokenKey(assetId: string): "stx" | string | null {
  if (assetId.includes(":native:stx")) return "stx";
  const marker = ":contract:";
  const at = assetId.indexOf(marker);
  if (at === -1) return null;
  const rest = assetId.slice(at + marker.length);
  const split = rest.lastIndexOf(":");
  if (split <= 0 || split === rest.length - 1) return null;
  return `${rest.slice(0, split)}::${rest.slice(split + 1)}`;
}

export function spendableHiroQuantity(assetId: string, response: HiroAccountBalances): string | null {
  const key = hiroTokenKey(assetId);
  if (key === null) return null;
  try {
    if (key === "stx") {
      const total = BigInt(response.stx?.balance ?? "0");
      const locked = BigInt(response.stx?.locked ?? "0");
      return (total > locked ? total - locked : 0n).toString();
    }
    const row = response.fungible_tokens?.[key];
    return BigInt(row?.balance ?? "0").toString();
  } catch {
    return null;
  }
}

export function maxSwapQuantity(assetId: string, spendable: string): string {
  try {
    const quantity = BigInt(spendable);
    if (quantity <= 0n) return "0";
    if (hiroTokenKey(assetId) === "stx") {
      const reserve = BigInt(STX_SWAP_FEE_RESERVE);
      return quantity > reserve ? (quantity - reserve).toString() : quantity.toString();
    }
    return quantity.toString();
  } catch {
    return "0";
  }
}

export function walletEntryQuantity(
  entries: readonly { category: string; assetId: string; quantity: string | null; isReceipt?: boolean }[],
  assetId: string,
): string | null {
  const row = entries.find(
    (entry) => entry.category === "wallet" && entry.assetId === assetId && entry.isReceipt !== true,
  );
  return row?.quantity ?? null;
}

export const SBTC_MAINNET_ASSET_ID = `stacks:mainnet:contract:${CANONICAL_SWAP_ASSETS.sbtc.mainnetContract}:${CANONICAL_SWAP_ASSETS.sbtc.assetName}`;

/** Floor leftover Leather will accept. Live coin-selection usually needs more. */
export const BTC_BRIDGE_FEE_RESERVE = "200";
/** Leather estimates a change-output transaction. Floor 2 sat/vB even when mempool is 1. */
export const BTC_SEND_FEE_RATE_FLOOR = 2;
const BTC_SEND_OVERHEAD_VSIZE = 11;
const BTC_SEND_INPUT_VSIZE = 68;
const BTC_SEND_P2TR_OUTPUT_VSIZE = 43;
const BTC_SEND_CHANGE_VSIZE = 31;
const BTC_SEND_VSIZE_PAD = 40;

export function bitcoinSendVsize(inputCount: number, withChange = true): number {
  const inputs = inputCount < 1 ? 1 : inputCount;
  return (
    BTC_SEND_OVERHEAD_VSIZE +
    BTC_SEND_INPUT_VSIZE * inputs +
    BTC_SEND_P2TR_OUTPUT_VSIZE +
    (withChange ? BTC_SEND_CHANGE_VSIZE : 0) +
    BTC_SEND_VSIZE_PAD
  );
}

export function parseRecommendedFeeRate(body: unknown): number {
  if (typeof body !== "object" || body === null) return BTC_SEND_FEE_RATE_FLOOR;
  const fastest = (body as { fastestFee?: unknown }).fastestFee;
  const rate = typeof fastest === "number" && Number.isFinite(fastest) ? Math.ceil(fastest) : BTC_SEND_FEE_RATE_FLOOR;
  return rate > BTC_SEND_FEE_RATE_FLOOR ? rate : BTC_SEND_FEE_RATE_FLOOR;
}

/** Leather `sendTransfer` funds amount + a 2-output fee. Underestimating that is InsufficientFunds. */
export function bitcoinMinerFeeReserve(feeRateSatPerVbyte: number, inputCount = 1): string {
  const vsize = bitcoinSendVsize(inputCount, true);
  const estimated = BigInt(vsize * (feeRateSatPerVbyte < 1 ? 1 : Math.ceil(feeRateSatPerVbyte)));
  const floor = BigInt(BTC_BRIDGE_FEE_RESERVE);
  return (estimated > floor ? estimated : floor).toString();
}

export function countConfirmedUtxos(utxos: readonly MempoolAddressUtxo[]): number {
  return utxos.filter((utxo) => utxo.status?.confirmed !== false && BigInt(utxo.value ?? 0) > 0n).length;
}

export type MempoolAddressUtxo = {
  value?: number | string;
  status?: { confirmed?: boolean };
};

export function spendableBtcSats(utxos: readonly MempoolAddressUtxo[]): string | null {
  try {
    let total = 0n;
    for (const utxo of utxos) {
      if (utxo.status?.confirmed === false) continue;
      total += BigInt(utxo.value ?? 0);
    }
    return total.toString();
  } catch {
    return null;
  }
}

export function maxBridgePaySats(
  mode: "deposit" | "withdraw",
  spendable: string,
  maxFeeSats: string,
  minimumSats = "0",
  minerReserveSats = BTC_BRIDGE_FEE_RESERVE,
): string {
  try {
    const quantity = BigInt(spendable);
    const minimum = BigInt(minimumSats === "" ? "0" : minimumSats);
    if (quantity <= 0n) return "0";
    const leftover =
      mode === "deposit"
        ? quantity - BigInt(minerReserveSats === "" ? BTC_BRIDGE_FEE_RESERVE : minerReserveSats)
        : quantity - BigInt(maxFeeSats === "" ? "0" : maxFeeSats);
    if (leftover < minimum) return "0";
    return leftover.toString();
  } catch {
    return "0";
  }
}

/** sendTransfer cannot spend the whole Bitcoin balance — Leather takes amount + miner fee. */
export function bitcoinDepositBalanceError(
  amountSats: string,
  spendableSats: string,
  minerReserveSats = BTC_BRIDGE_FEE_RESERVE,
): string | null {
  try {
    const amount = BigInt(amountSats);
    const spendable = BigInt(spendableSats);
    const reserve = BigInt(minerReserveSats === "" ? BTC_BRIDGE_FEE_RESERVE : minerReserveSats);
    if (amount > spendable) return "Amount is more than your Bitcoin balance";
    if (amount + reserve > spendable) {
      return "Leather needs more leftover bitcoin for the miner fee. Lower the amount or use Max.";
    }
    return null;
  } catch {
    return null;
  }
}

export type TokenUsdQuote = {
  feedKey: string;
  price: string | null;
  scale: number;
  stale?: boolean;
  status?: string;
  source?: string;
};

/** Map a listed token onto an oracle feed. Unknown tokens stay unpriced. */
export function tokenUsdFeedKey(symbol: string, assetId = ""): string | null {
  const haystack = `${symbol} ${assetId}`.toLowerCase();
  if (/\b(sbtc|abtc|xbtc|btc)\b/.test(haystack) || haystack.includes("sbtc-token")) return "BTC/USD";
  if (/\bstx\b/.test(haystack) || haystack.includes(":native:stx")) return "STX/USD";
  if (/\b(usdcx|usdc|usda|susdt|aeusdc)\b/.test(haystack)) return "USDC/USD";
  return null;
}

export function formatUsdCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const dollars = abs / 100n;
  const fraction = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}$${dollars.toLocaleString("en-US")}.${fraction}`;
}

/** Dollar equivalent from integer base units and an oracle quote. Never invents a price. */
export function formatUsdFromBase(
  quantity: string,
  decimals: number,
  quote: TokenUsdQuote | null | undefined,
): string | null {
  if (quote === null || quote === undefined || quote.price === null) return null;
  if (quote.status === "unsupported") return null;
  try {
    const units = BigInt(quantity);
    const price = BigInt(quote.price);
    if (units < 0n || price <= 0n || decimals < 0 || quote.scale < 0) return null;
    const denomExp = decimals + quote.scale;
    const cents = (units * price * 100n) / 10n ** BigInt(denomExp);
    const label = formatUsdCents(cents);
    return quote.stale === true || quote.status === "stale" ? `${label} · stale` : label;
  } catch {
    return null;
  }
}

export function formatUsdFromDisplay(
  displayAmount: string,
  decimals: number,
  quote: TokenUsdQuote | null | undefined,
): string | null {
  if (displayAmount.trim() === "") return null;
  try {
    return formatUsdFromBase(toBaseUnits(displayAmount, decimals), decimals, quote);
  } catch {
    return null;
  }
}

export function formatSpotUsd(quote: TokenUsdQuote | null | undefined): string | null {
  if (quote === null || quote === undefined || quote.price === null) return null;
  if (quote.status === "unsupported") return null;
  try {
    const price = BigInt(quote.price);
    if (price <= 0n || quote.scale < 0) return null;
    const cents = (price * 100n) / 10n ** BigInt(quote.scale);
    const label = formatUsdCents(cents);
    return quote.stale === true || quote.status === "stale" ? `${label} · stale` : label;
  } catch {
    return null;
  }
}

export function usdHint(label: string | null, loading = false): string {
  if (label !== null) return `≈ ${label}`;
  return loading ? "USD loading…" : "USD unavailable";
}
