import { AlexSDK, type TokenInfo } from "alex-sdk";

export type SwapProvider = "bitflow" | "velar" | "alex";

export type SwapAsset = {
  key: string;
  assetId: string;
  symbol: string;
  name: string;
  decimals: number;
  providers: SwapProvider[];
};

export type ListedSwapAsset = SwapAsset & {
  providerTokens: Partial<Record<SwapProvider, string>>;
};

export type SwapCatalogSourceStatus = {
  status: "ok" | "unavailable";
  count: number;
  reason: string | null;
};

export type SwapMarketCatalog = {
  assets: ListedSwapAsset[];
  sources: Record<SwapProvider, SwapCatalogSourceStatus>;
  observedAt: string;
};

export const NATIVE_STX_ASSET_ID = "stacks:mainnet:native:stx";
export const CANONICAL_SBTC_ASSET_ID =
  "stacks:mainnet:contract:SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token:sbtc-token";
export const CANONICAL_USDCX_ASSET_ID =
  "stacks:mainnet:contract:SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx:usdcx-token";
export const ALEX_ABTC_ASSET_ID =
  "stacks:mainnet:contract:SP2XD7417HGPRTREMKF748VNEQPDRR0RMANB7X1NK.token-abtc:bridged-btc";

const BITFLOW_STX = "SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.token-stx-v-1-2";
const VELAR_STX = "SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.wstx";
const BITFLOW_TOKENS = "https://bff.bitflowapis.finance/api/quotes/v1/tokens";
const VELAR_TOKENS = "https://api.velar.co/tokens?symbol=all";
const MAINNET_CONTRACT = /^S[PM][A-Z0-9]{25,41}\.[A-Za-z0-9\-_]+$/;
const ASSET_NAME = /^[A-Za-z0-9\-_$.]+$/;
const CATALOG_TTL_MS = 5 * 60 * 1000;
const CATALOG_TIMEOUT_MS = 8_000;

export const CANONICAL_SWAP_ASSETS: readonly ListedSwapAsset[] = [
  listed("stx", NATIVE_STX_ASSET_ID, "STX", "Stacks", 6, {
    bitflow: BITFLOW_STX,
    velar: VELAR_STX,
    alex: "token-wstx",
  }),
  listed("sbtc", CANONICAL_SBTC_ASSET_ID, "sBTC", "Canonical sBTC", 8, {
    bitflow: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
    velar: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
  }),
  listed("usdcx", CANONICAL_USDCX_ASSET_ID, "USDCx", "USDCx", 6, {
    bitflow: "SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx",
    velar: "SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx",
  }),
  listed("alex-abtc", ALEX_ABTC_ASSET_ID, "aBTC", "ALEX bridged BTC", 8, {
    alex: "token-abtc",
  }),
];

export const MAINNET_SWAP_ASSETS: readonly SwapAsset[] = CANONICAL_SWAP_ASSETS.map(publicSwapAsset);

type CatalogCache = { at: number; catalog: SwapMarketCatalog };
let catalogCache: CatalogCache | null = null;

export function resetSwapMarketCache(): void {
  catalogCache = null;
}

export function publicSwapAsset(asset: ListedSwapAsset): SwapAsset {
  return {
    key: asset.key,
    assetId: asset.assetId,
    symbol: asset.symbol,
    name: asset.name,
    decimals: asset.decimals,
    providers: [...asset.providers],
  };
}

export function isNativeStx(asset: Pick<SwapAsset, "assetId">): boolean {
  return asset.assetId === NATIVE_STX_ASSET_ID;
}

export function resolveListedAsset(
  assetId: string,
  catalog: readonly ListedSwapAsset[] = CANONICAL_SWAP_ASSETS,
): ListedSwapAsset {
  const found = catalog.find((item) => item.assetId === assetId);
  if (found === undefined) throw new Error(`Unsupported exact asset identity: ${assetId}`);
  return found;
}

export function providerToken(asset: ListedSwapAsset, provider: SwapProvider): string {
  const token = asset.providerTokens[provider];
  if (token === undefined) throw new Error(`Exact asset pair is not listed by ${displayProvider(provider)}`);
  return token;
}

export async function listMainnetSwapMarkets(
  options: {
    fetcher?: typeof fetch;
    alexFactory?: () => AlexSDK;
    now?: () => Date;
    timeoutMs?: number;
    cache?: boolean;
  } = {},
): Promise<SwapMarketCatalog> {
  const now = options.now?.() ?? new Date();
  if (options.cache !== false && catalogCache !== null && now.getTime() - catalogCache.at < CATALOG_TTL_MS) {
    return catalogCache.catalog;
  }
  const fetcher = options.fetcher ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? CATALOG_TIMEOUT_MS;
  const [bitflow, velar, alex] = await Promise.all([
    collect(() => bitflowListings(fetcher, timeoutMs)),
    collect(() => velarListings(fetcher, timeoutMs)),
    collect(() => alexListings(options.alexFactory ?? (() => new AlexSDK()), timeoutMs)),
  ]);
  const merged = mergeListings([
    ...CANONICAL_SWAP_ASSETS.map(cloneListed),
    ...bitflow.listings,
    ...velar.listings,
    ...alex.listings,
  ]);
  const catalog: SwapMarketCatalog = {
    assets: sortAssets(merged),
    sources: {
      bitflow: bitflow.source,
      velar: velar.source,
      alex: alex.source,
    },
    observedAt: now.toISOString(),
  };
  if (options.cache !== false) catalogCache = { at: now.getTime(), catalog };
  return catalog;
}

export function mergeListings(listings: readonly ListedSwapAsset[]): ListedSwapAsset[] {
  const byId = new Map<string, ListedSwapAsset>();
  for (const listing of listings) {
    const existing = byId.get(listing.assetId);
    if (existing === undefined) {
      byId.set(listing.assetId, cloneListed(listing));
      continue;
    }
    if (existing.decimals !== listing.decimals) continue;
    for (const provider of listing.providers) {
      if (!existing.providers.includes(provider)) existing.providers.push(provider);
      const token = listing.providerTokens[provider];
      if (token !== undefined) existing.providerTokens[provider] = token;
    }
    if (existing.name === existing.symbol && listing.name !== listing.symbol) existing.name = listing.name;
  }
  for (const asset of byId.values()) {
    asset.providers = (["bitflow", "velar", "alex"] as const).filter((provider) => asset.providers.includes(provider));
  }
  return [...byId.values()];
}

function listed(
  key: string,
  assetId: string,
  symbol: string,
  name: string,
  decimals: number,
  providerTokens: Partial<Record<SwapProvider, string>>,
): ListedSwapAsset {
  return {
    key,
    assetId,
    symbol,
    name,
    decimals,
    providers: (["bitflow", "velar", "alex"] as const).filter((provider) => providerTokens[provider] !== undefined),
    providerTokens: { ...providerTokens },
  };
}

function cloneListed(asset: ListedSwapAsset): ListedSwapAsset {
  return {
    ...asset,
    providers: [...asset.providers],
    providerTokens: { ...asset.providerTokens },
  };
}

function displayProvider(provider: SwapProvider): string {
  if (provider === "bitflow") return "Bitflow";
  if (provider === "velar") return "Velar";
  return "ALEX";
}

function sortAssets(assets: readonly ListedSwapAsset[]): ListedSwapAsset[] {
  const rank = (asset: ListedSwapAsset): number => {
    if (asset.assetId === NATIVE_STX_ASSET_ID) return 0;
    if (asset.assetId === CANONICAL_SBTC_ASSET_ID) return 1;
    if (asset.assetId === CANONICAL_USDCX_ASSET_ID) return 2;
    if (asset.assetId === ALEX_ABTC_ASSET_ID) return 3;
    return 10;
  };
  return [...assets].sort((left, right) => {
    const order = rank(left) - rank(right);
    if (order !== 0) return order;
    const symbol = left.symbol.localeCompare(right.symbol);
    if (symbol !== 0) return symbol;
    return left.assetId.localeCompare(right.assetId);
  });
}

async function collect(
  load: () => Promise<ListedSwapAsset[]>,
): Promise<{ listings: ListedSwapAsset[]; source: SwapCatalogSourceStatus }> {
  try {
    const listings = await load();
    return { listings, source: { status: "ok", count: listings.length, reason: null } };
  } catch (error) {
    const reason = error instanceof Error && error.message.length > 0 ? error.message.slice(0, 240) : "Catalog failed";
    return { listings: [], source: { status: "unavailable", count: 0, reason } };
  }
}

async function bitflowListings(fetcher: typeof fetch, timeoutMs: number): Promise<ListedSwapAsset[]> {
  const body = await json(await timed(fetcher, BITFLOW_TOKENS, timeoutMs), "Bitflow");
  const tokens = body.tokens;
  if (!Array.isArray(tokens)) throw new Error("Bitflow token catalog was missing");
  return tokens.flatMap((item) => {
    const token = record(item, "Bitflow token");
    const contract = nonEmpty(token.contract_address, "Bitflow contract");
    const symbol = nonEmpty(token.symbol, "Bitflow symbol");
    const name = typeof token.name === "string" && token.name.length > 0 ? token.name : symbol;
    const decimals = integer(token.decimals, "Bitflow decimals");
    const assetName = typeof token.asset_name === "string" ? token.asset_name : "";
    const identity = identityFromContract(contract, assetName === "unknown" ? "" : assetName, symbol);
    if (identity === null) return [];
    return [listed(identity.key, identity.assetId, symbol, name, decimals, { bitflow: contract })];
  });
}

async function velarListings(fetcher: typeof fetch, timeoutMs: number): Promise<ListedSwapAsset[]> {
  const response = await timed(fetcher, VELAR_TOKENS, timeoutMs);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Velar returned HTTP ${response.status}`);
  if (!Array.isArray(body)) throw new Error("Velar token catalog was missing");
  return body.flatMap((item) => {
    const token = record(item, "Velar token");
    const contract = nonEmpty(token.contractAddress, "Velar contract");
    const symbol = nonEmpty(token.symbol, "Velar symbol");
    const name = typeof token.name === "string" && token.name.length > 0 ? token.name : symbol;
    const assetName = typeof token.assetName === "string" ? token.assetName : "";
    const decimals = velarDecimals(token);
    if (decimals === null) return [];
    const identity = identityFromContract(contract, assetName, symbol);
    if (identity === null) return [];
    return [listed(identity.key, identity.assetId, symbol, name, decimals, { velar: contract })];
  });
}

async function alexListings(factory: () => AlexSDK, timeoutMs: number): Promise<ListedSwapAsset[]> {
  const tokens = await withTimeout(factory().fetchSwappableCurrency(), timeoutMs, "ALEX");
  return tokens.flatMap((token) => {
    const identity = identityFromAlex(token);
    if (identity === null) return [];
    return [
      listed(identity.key, identity.assetId, token.name, token.name, token.underlyingTokenDecimals, {
        alex: token.id,
      }),
    ];
  });
}

function identityFromAlex(token: TokenInfo): { key: string; assetId: string } | null {
  if (token.id === "token-wstx" || token.underlyingToken === ".stx" || token.name === "STX") {
    return { key: "stx", assetId: NATIVE_STX_ASSET_ID };
  }
  const parsed = parseQualifiedAsset(token.underlyingToken);
  if (parsed === null) return null;
  return { key: assetKey(parsed.assetId), assetId: parsed.assetId };
}

function identityFromContract(
  contract: string,
  assetName: string,
  symbol: string,
): { key: string; assetId: string } | null {
  if (!MAINNET_CONTRACT.test(contract)) return null;
  if (isStxWrapper(contract, symbol)) return { key: "stx", assetId: NATIVE_STX_ASSET_ID };
  const name = assetName.length > 0 ? assetName : (contract.split(".")[1] ?? "");
  if (!ASSET_NAME.test(name)) return null;
  const assetId = `stacks:mainnet:contract:${contract}:${name}`;
  return { key: assetKey(assetId), assetId };
}

function parseQualifiedAsset(value: string): { contract: string; assetName: string; assetId: string } | null {
  const [contract, assetName] = value.split("::");
  if (
    contract === undefined ||
    assetName === undefined ||
    !MAINNET_CONTRACT.test(contract) ||
    !ASSET_NAME.test(assetName)
  ) {
    return null;
  }
  return { contract, assetName, assetId: `stacks:mainnet:contract:${contract}:${assetName}` };
}

function isStxWrapper(contract: string, symbol: string): boolean {
  return (
    contract === BITFLOW_STX ||
    contract === VELAR_STX ||
    (symbol === "STX" &&
      (contract.endsWith(".wstx") || contract.includes("token-stx") || contract.includes("token-wstx")))
  );
}

function assetKey(assetId: string): string {
  if (assetId === NATIVE_STX_ASSET_ID) return "stx";
  if (assetId === CANONICAL_SBTC_ASSET_ID) return "sbtc";
  if (assetId === CANONICAL_USDCX_ASSET_ID) return "usdcx";
  if (assetId === ALEX_ABTC_ASSET_ID) return "alex-abtc";
  return assetId;
}

function velarDecimals(token: Record<string, unknown>): number | null {
  if (typeof token.decimal === "string") {
    const match = /^u(\d+)$/.exec(token.decimal);
    if (match?.[1] !== undefined) return Number(match[1]);
  }
  if (
    typeof token.tokenDecimalNum === "number" &&
    Number.isInteger(token.tokenDecimalNum) &&
    token.tokenDecimalNum > 0
  ) {
    let decimals = 0;
    let scale = token.tokenDecimalNum;
    while (scale > 1 && scale % 10 === 0) {
      decimals += 1;
      scale /= 10;
    }
    if (scale === 1) return decimals;
  }
  return null;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} was malformed`);
  return value as Record<string, unknown>;
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} was missing`);
  return value;
}

function integer(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 18) {
    throw new Error(`${label} was not a usable decimal count`);
  }
  return value;
}

async function json(response: Response, provider: string): Promise<Record<string, unknown>> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${provider} returned HTTP ${response.status}`);
  return record(body, `${provider} catalog`);
}

async function timed(fetcher: typeof fetch, url: string, timeoutMs: number): Promise<Response> {
  return withTimeout(fetcher(url), timeoutMs, new URL(url).host);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} catalog timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
