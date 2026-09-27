import { useEffect, useState } from "react";
import { toBaseUnits, type TokenUsdQuote } from "./swapState.ts";

const SPOT_SCALE = 8;
const COINBASE_SPOT = "https://api.coinbase.com/v2/prices";
const COINGECKO_SPOT =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,blockstack,usd-coin&vs_currencies=usd";

const COINBASE_PAIRS = {
  "BTC/USD": "BTC-USD",
  "STX/USD": "STX-USD",
  "USDC/USD": "USDC-USD",
  "sBTC/USD": "BTC-USD",
} as const;

const COINGECKO_IDS = {
  bitcoin: ["BTC/USD", "sBTC/USD"],
  blockstack: ["STX/USD"],
  "usd-coin": ["USDC/USD"],
} as const;

export function usableUsdQuote(quote: TokenUsdQuote | null | undefined): quote is TokenUsdQuote {
  return (
    quote !== null &&
    quote !== undefined &&
    quote.price !== null &&
    quote.price !== "0" &&
    quote.status !== "unsupported"
  );
}

export function scaledPriceFromDecimal(display: string, scale = SPOT_SCALE): string | null {
  try {
    const scaled = toBaseUnits(display, scale);
    return BigInt(scaled) > 0n ? scaled : null;
  } catch {
    return null;
  }
}

export function pickUsdQuote(
  feedKey: string | null,
  oracleItems: readonly TokenUsdQuote[] | undefined,
  spotItems: readonly TokenUsdQuote[],
): TokenUsdQuote | undefined {
  if (feedKey === null) return undefined;
  const oracle = oracleItems?.find((item) => item.feedKey === feedKey);
  if (usableUsdQuote(oracle)) return oracle;
  return spotItems.find((item) => item.feedKey === feedKey);
}

function quoteFromDecimal(feedKey: string, display: string, source: string): TokenUsdQuote | null {
  const price = scaledPriceFromDecimal(display);
  if (price === null) return null;
  return { feedKey, price, scale: SPOT_SCALE, source };
}

async function readJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`spot ${response.status}`);
  return response.json();
}

async function fetchCoinbaseQuotes(fetchImpl: typeof fetch): Promise<TokenUsdQuote[]> {
  const uniquePairs = [...new Set(Object.values(COINBASE_PAIRS))];
  const amounts = new Map<string, string>();
  await Promise.all(
    uniquePairs.map(async (pair) => {
      const body = (await readJson(`${COINBASE_SPOT}/${pair}/spot`, fetchImpl)) as {
        data?: { amount?: string };
      };
      const amount = body.data?.amount;
      if (typeof amount === "string") amounts.set(pair, amount);
    }),
  );
  const quotes: TokenUsdQuote[] = [];
  for (const [feedKey, pair] of Object.entries(COINBASE_PAIRS)) {
    const amount = amounts.get(pair);
    if (amount === undefined) continue;
    const quote = quoteFromDecimal(feedKey, amount, "coinbase-spot");
    if (quote !== null) quotes.push(quote);
  }
  return quotes;
}

async function fetchCoingeckoQuotes(fetchImpl: typeof fetch): Promise<TokenUsdQuote[]> {
  const body = (await readJson(COINGECKO_SPOT, fetchImpl)) as Record<string, { usd?: number }>;
  const quotes: TokenUsdQuote[] = [];
  for (const [id, feeds] of Object.entries(COINGECKO_IDS)) {
    const usd = body[id]?.usd;
    if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) continue;
    for (const feedKey of feeds) {
      const quote = quoteFromDecimal(feedKey, usd.toFixed(8), "coingecko-spot");
      if (quote !== null) quotes.push(quote);
    }
  }
  return quotes;
}

/** Live public spots. Used only when the oracle snapshot has no usable price. */
export async function fetchPublicSpotQuotes(fetchImpl: typeof fetch = fetch): Promise<TokenUsdQuote[]> {
  try {
    const coinbase = await fetchCoinbaseQuotes(fetchImpl);
    if (coinbase.length > 0) return coinbase;
  } catch {
    // CoinGecko is the fallback, not an invented price.
  }
  try {
    return await fetchCoingeckoQuotes(fetchImpl);
  } catch {
    return [];
  }
}

const DISPLAY_FEEDS = ["BTC/USD", "STX/USD", "USDC/USD", "sBTC/USD"] as const;

export function usePublicSpotQuotes(oracleItems: readonly TokenUsdQuote[] | undefined): {
  items: TokenUsdQuote[];
  loading: boolean;
} {
  const oracleReady = DISPLAY_FEEDS.every((feed) => usableUsdQuote(oracleItems?.find((item) => item.feedKey === feed)));
  const [items, setItems] = useState<TokenUsdQuote[]>([]);
  const [loading, setLoading] = useState(!oracleReady);

  useEffect(() => {
    if (oracleReady) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetchPublicSpotQuotes()
      .then((quotes) => {
        if (!cancelled) setItems(quotes);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [oracleReady]);

  return { items, loading };
}
