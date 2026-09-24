import type {
  CapitalClient,
  Result,
  SwapMarketCatalog,
  SwapOffer,
  SwapProvider,
  SwapQuoteComparison,
  SwapWalletCall,
} from "@stacks-capital/client";

export type SwapMarketRow =
  | { kind: "offer"; offer: SwapOffer; recommended: boolean }
  | { kind: "unavailable"; provider: SwapProvider; reason: string };

/** The first ranked offer is the CapitalOS recommendation (highest guaranteed minimum). */
export function recommendedSwapOffer(comparison: SwapQuoteComparison): SwapOffer | null {
  return comparison.offers[0] ?? null;
}

/**
 * Picks the recommended offer, or an optional provider override when that provider still has a quote.
 * A missing override or an unavailable provider falls back to the recommendation.
 */
export function selectSwapOffer(comparison: SwapQuoteComparison, provider?: SwapProvider | null): SwapOffer | null {
  if (provider !== undefined && provider !== null) {
    const chosen = comparison.offers.find((offer) => offer.provider === provider);
    if (chosen !== undefined) return chosen;
  }
  return recommendedSwapOffer(comparison);
}

export function swapOfferExpired(offer: SwapOffer, now: Date): boolean {
  return Date.parse(offer.expiresAt) <= now.getTime();
}

/** Ranked quotes first, then unavailable venues, so a host can render the same preview as Stacks Capital. */
export function swapMarketRows(comparison: SwapQuoteComparison): SwapMarketRow[] {
  return [
    ...comparison.offers.map((offer) => ({
      kind: "offer" as const,
      offer,
      recommended: offer.rank === 1,
    })),
    ...comparison.unavailable.map((item) => ({ kind: "unavailable" as const, ...item })),
  ];
}

/** The wallet must never be asked to sign an offer that has no encoded call. */
export function assertSwapWalletCall(offer: SwapOffer): SwapWalletCall {
  if (offer.walletCall === undefined) {
    throw new Error(`${offer.provider} did not return a signable swap call`);
  }
  return offer.walletCall;
}

export type CompareSwapsInput = {
  client: CapitalClient;
  inputAsset: string;
  outputAsset: string;
  amount: string;
  slippageBps?: number;
  owner?: string;
  provider?: SwapProvider | null;
};

export type ComparedSwaps = {
  catalog: Result<SwapMarketCatalog>;
  comparison: Result<SwapQuoteComparison>;
  recommended: SwapOffer | null;
  selected: SwapOffer | null;
  rows: SwapMarketRow[];
};

/**
 * Same sequence as Stacks Capital: load the live catalog, compare venues, default to the
 * best guaranteed minimum, and keep an optional provider override when that venue still quoted.
 */
export async function compareSwaps(input: CompareSwapsInput): Promise<ComparedSwaps> {
  const catalog = await input.client.swapMarkets();
  const comparison = await input.client.swapQuotes({
    inputAsset: input.inputAsset,
    outputAsset: input.outputAsset,
    amount: input.amount,
    ...(input.slippageBps === undefined ? {} : { slippageBps: input.slippageBps }),
    ...(input.owner === undefined ? {} : { owner: input.owner }),
  });
  return {
    catalog,
    comparison,
    recommended: recommendedSwapOffer(comparison.data),
    selected: selectSwapOffer(comparison.data, input.provider),
    rows: swapMarketRows(comparison.data),
  };
}
