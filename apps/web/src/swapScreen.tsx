import type { SwapAsset, SwapOffer, SwapProvider, SwapQuoteComparison } from "@stacks-capital/client";
import { useCapital, usePrices } from "@stacks-capital/react";
import { useEffect, useState, type ReactNode } from "react";
import type { WalletId } from "@stacks-capital/wallets";
import {
  askWalletCall,
  EmptyStateView,
  findProvider,
  messageFor,
  Panel,
  StateNote,
  panelState,
  toWalletCallRequest,
  type ConnectedWallet,
} from "@stacks-capital/ui";
import { fromBaseUnits, toBaseUnits } from "./swapState.ts";

const FALLBACK_ASSETS: readonly SwapAsset[] = [
  {
    key: "stx",
    assetId: "stacks:mainnet:native:stx",
    symbol: "STX",
    name: "Stacks",
    decimals: 6,
    providers: ["bitflow", "velar", "alex"],
  },
  {
    key: "sbtc",
    assetId: "stacks:mainnet:contract:SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token:sbtc-token",
    symbol: "sBTC",
    name: "Canonical sBTC",
    decimals: 8,
    providers: ["bitflow", "velar"],
  },
  {
    key: "usdcx",
    assetId: "stacks:mainnet:contract:SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx:usdcx-token",
    symbol: "USDCx",
    name: "USDCx",
    decimals: 6,
    providers: ["bitflow", "velar"],
  },
  {
    key: "alex-abtc",
    assetId: "stacks:mainnet:contract:SP2XD7417HGPRTREMKF748VNEQPDRR0RMANB7X1NK.token-abtc:bridged-btc",
    symbol: "aBTC",
    name: "ALEX bridged BTC",
    decimals: 8,
    providers: ["alex"],
  },
];

function providerName(provider: SwapProvider): string {
  if (provider === "bitflow") return "Bitflow";
  if (provider === "velar") return "Velar";
  return "ALEX";
}

function priceFeedKey(asset: SwapAsset): string | null {
  if (asset.assetId === "stacks:mainnet:native:stx") return "STX/USD";
  if (asset.assetId.endsWith(":usdcx-token") || asset.symbol === "USDCx") return "USDC/USD";
  if (asset.symbol === "sBTC" || asset.symbol === "aBTC") return "BTC/USD";
  return null;
}

function amount(quantity: string, asset: SwapAsset, maximumFractionDigits = 8): string {
  const display = fromBaseUnits(quantity, asset.decimals);
  const numeric = Number(display);
  if (!Number.isFinite(numeric)) return `${display} ${asset.symbol}`;
  return `${numeric.toLocaleString(undefined, { maximumFractionDigits })} ${asset.symbol}`;
}

function observedAge(observedAt: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(observedAt)) / 1000));
  return seconds < 2 ? "just now" : `${seconds}s ago`;
}

function assetById(assets: readonly SwapAsset[], assetId: string, fallback: SwapAsset): SwapAsset {
  return assets.find((item) => item.assetId === assetId) ?? fallback;
}

function optionLabel(asset: SwapAsset, assets: readonly SwapAsset[]): string {
  const clashes = assets.filter((item) => item.symbol === asset.symbol).length;
  if (clashes <= 1) return asset.symbol;
  const contract = asset.assetId.split(":contract:")[1]?.split(":")[0]?.split(".")[1];
  return contract === undefined ? asset.symbol : `${asset.symbol} · ${contract}`;
}

function unavailableReason(reason: string): string {
  if (/asyncIterator|no route/i.test(reason)) return "No route for this pair.";
  if (/not listed|does not list/i.test(reason)) return "This pair is not listed.";
  return reason;
}

export function Swap({ wallet, signedIn }: { wallet: ConnectedWallet | null; signedIn: boolean }) {
  const { client } = useCapital();
  const prices = usePrices({ staleMs: 15_000 });
  const [assets, setAssets] = useState<SwapAsset[]>([...FALLBACK_ASSETS]);
  const [marketsNote, setMarketsNote] = useState<string | null>(null);
  const [inputId, setInputId] = useState(FALLBACK_ASSETS[0]?.assetId ?? "");
  const [outputId, setOutputId] = useState(FALLBACK_ASSETS[1]?.assetId ?? "");
  const [inputQuery, setInputQuery] = useState("");
  const [outputQuery, setOutputQuery] = useState("");
  const [displayAmount, setDisplayAmount] = useState("1");
  const [slippageBps, setSlippageBps] = useState(50);
  const [comparison, setComparison] = useState<SwapQuoteComparison | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<SwapProvider | null>(null);
  const [busy, setBusy] = useState(false);
  const [signing, setSigning] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [signedNote, setSignedNote] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void client
      .swapMarkets()
      .then((response) => {
        if (cancelled || response.data.items.length === 0) return;
        setAssets(response.data.items);
        const failed = (Object.entries(response.data.sources) as [SwapProvider, { status: string }][])
          .filter(([, source]) => source.status === "unavailable")
          .map(([provider]) => providerName(provider));
        setMarketsNote(
          failed.length === 0
            ? `${response.data.items.length} mainnet tokens`
            : `${response.data.items.length} mainnet tokens. ${failed.join(", ")} catalog unavailable.`,
        );
      })
      .catch((error: unknown) => {
        if (!cancelled) setMarketsNote(messageFor(error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const inputAsset = assetById(assets, inputId, FALLBACK_ASSETS[0] as SwapAsset);
  const outputAsset = assetById(assets, outputId, FALLBACK_ASSETS[1] as SwapAsset);
  const best = comparison?.offers[0] ?? null;
  const selected = comparison?.offers.find((offer) => offer.provider === selectedProvider) ?? best;
  const expired = selected !== null && Date.parse(selected.expiresAt) <= clock;
  let baseAmount = "0";
  let amountError: string | null = null;
  try {
    baseAmount = toBaseUnits(displayAmount, inputAsset.decimals);
    if (baseAmount === "0") amountError = "Enter an amount greater than zero.";
  } catch (error) {
    amountError = error instanceof Error ? error.message : "Enter a valid amount.";
  }

  function clearQuotes() {
    setComparison(null);
    setSelectedProvider(null);
    setProblem(null);
    setSignedNote(null);
  }

  function switchAssets() {
    setInputId(outputAsset.assetId);
    setOutputId(inputAsset.assetId);
    setInputQuery("");
    setOutputQuery("");
    clearQuotes();
  }

  async function getQuotes(): Promise<SwapQuoteComparison | null> {
    if (wallet === null || amountError !== null) return null;
    setBusy(true);
    setProblem(null);
    try {
      const response = await client.swapQuotes({
        inputAsset: inputAsset.assetId,
        outputAsset: outputAsset.assetId,
        amount: baseAmount,
        slippageBps,
        owner: wallet.address,
      });
      setComparison(response.data);
      if (response.data.offers.length === 0) {
        setProblem("No provider returned a valid quote for this exact asset pair.");
        return response.data;
      }
      return response.data;
    } catch (error) {
      setProblem(messageFor(error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (wallet === null || amountError !== null) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        setBusy(true);
        setProblem(null);
        try {
          const response = await client.swapQuotes({
            inputAsset: inputAsset.assetId,
            outputAsset: outputAsset.assetId,
            amount: baseAmount,
            slippageBps,
            owner: wallet.address,
          });
          if (cancelled) return;
          setComparison(response.data);
          if (response.data.offers.length === 0) {
            setProblem("No provider returned a valid quote for this exact asset pair.");
          }
        } catch (error) {
          if (!cancelled) setProblem(messageFor(error).message);
        } finally {
          if (!cancelled) setBusy(false);
        }
      })();
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [wallet, client, inputAsset.assetId, outputAsset.assetId, baseAmount, slippageBps, amountError]);

  async function swapNow() {
    if (wallet === null || amountError !== null) return;
    if (comparison === null || expired || selected === null) {
      await getQuotes();
      return;
    }
    const offer = selected;
    if (offer.walletCall === undefined) {
      setProblem(`${providerName(offer.provider)} did not return a signable swap call. Nothing was sent.`);
      return;
    }
    const provider = findProvider(wallet.id as WalletId);
    if (provider === null) {
      setProblem(`${wallet.id} is not available any more`);
      return;
    }
    setSigning(true);
    setProblem(null);
    setSignedNote(null);
    try {
      const answer = await askWalletCall(provider, wallet.id as WalletId, toWalletCallRequest(offer.walletCall));
      if (answer.kind === "rejected") {
        setProblem(answer.message);
        return;
      }
      if (answer.kind === "unknown") {
        setProblem(answer.result.error);
        return;
      }
      setSignedNote("Signed in your wallet. CapitalOS does not broadcast or reconcile this provider route.");
    } catch (error) {
      setProblem(messageFor(error).message);
    } finally {
      setSigning(false);
    }
  }

  if (!signedIn || wallet === null) {
    return (
      <Panel title="Swap">
        <EmptyStateView
          state={{ kind: "empty", instruction: "Connect a wallet and sign in to swap on the best available route." }}
        />
      </Panel>
    );
  }

  if (wallet.network !== "mainnet") {
    return (
      <Panel title="Swap">
        <EmptyStateView
          state={{ kind: "empty", instruction: "Switch your wallet to Stacks mainnet to compare live routes." }}
        />
      </Panel>
    );
  }

  const inputFeed = priceFeedKey(inputAsset);
  const outputFeed = priceFeedKey(outputAsset);
  const inputPrice =
    inputFeed === null ? undefined : prices.data?.data.items.find((item) => item.feedKey === inputFeed);
  const outputPrice =
    outputFeed === null ? undefined : prices.data?.data.items.find((item) => item.feedKey === outputFeed);
  const venueCount = new Set(assets.flatMap((asset) => asset.providers)).size;

  return (
    <Panel title="Swap across Stacks">
      <StateNote state={panelState(prices, prices.data?.context)} onRetry={() => void prices.refresh()} />
      <div className="swap-integrity-note">
        CapitalOS compares Bitflow, Velar and ALEX on mainnet and routes through the quote with the highest guaranteed
        minimum received. A provider failure never removes healthy quotes.
      </div>
      {marketsNote !== null && <p className="swap-catalog-note">{marketsNote}</p>}

      <div className="swap-workspace">
        <section className="swap-market-panel" aria-label="Market snapshot">
          <div className="swap-market-heading">
            <div>
              <span className="eyebrow">Live market snapshot</span>
              <h3>
                {inputAsset.symbol} / {outputAsset.symbol}
              </h3>
            </div>
            <span className="swap-live-badge">Mainnet</span>
          </div>
          <div className="swap-market-stats">
            <div>
              <span>Pay asset</span>
              <strong>{inputAsset.name}</strong>
              <small>{inputPrice?.status ?? "price unavailable"}</small>
            </div>
            <div>
              <span>Receive asset</span>
              <strong>{outputAsset.name}</strong>
              <small>{outputPrice?.status ?? "price unavailable"}</small>
            </div>
            <div>
              <span>Listed tokens</span>
              <strong>{assets.length}</strong>
              <small>
                {venueCount} venue{venueCount === 1 ? "" : "s"} checked
              </small>
            </div>
            <div>
              <span>Ranking basis</span>
              <strong>Min received</strong>
              <small>after slippage floor</small>
            </div>
          </div>
          <div className="swap-market-empty-chart">
            <div className="snapshot-bars" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
            <strong>Current observations only</strong>
            <span>CapitalOS does not synthesize historical price data.</span>
          </div>
          <div className="swap-identity-box">
            <span>Exact receive asset</span>
            <code>{outputAsset.assetId}</code>
          </div>
        </section>

        <section className="swap-composer" aria-label="Swap quote form">
          <div className="swap-tabs">
            <button type="button" className="active">
              Swap
            </button>
            <button type="button" disabled>
              Recurring
            </button>
          </div>
          <AssetField
            id="swap-input-asset"
            label="You pay"
            query={inputQuery}
            onQuery={setInputQuery}
            selected={inputAsset}
            otherId={outputAsset.assetId}
            assets={assets}
            onSelect={(assetId) => {
              setInputId(assetId);
              clearQuotes();
            }}
          >
            <input
              aria-label="Swap amount"
              inputMode="decimal"
              value={displayAmount}
              onChange={(event) => {
                setDisplayAmount(event.target.value);
                setSignedNote(null);
              }}
            />
          </AssetField>
          <small className="swap-amount-hint">{amountError ?? `${baseAmount} base units`}</small>

          <button
            type="button"
            className="swap-round-switch"
            onClick={switchAssets}
            aria-label="Switch pay and receive assets"
          >
            ⇅
          </button>

          <AssetField
            id="swap-output-asset"
            label="You receive"
            query={outputQuery}
            onQuery={setOutputQuery}
            selected={outputAsset}
            otherId={inputAsset.assetId}
            assets={assets}
            onSelect={(assetId) => {
              setOutputId(assetId);
              clearQuotes();
            }}
          >
            <output>{selected === null ? "—" : fromBaseUnits(selected.amountOut, outputAsset.decimals)}</output>
          </AssetField>
          <small className="swap-amount-hint">
            {selected === null
              ? busy
                ? "Finding the best route…"
                : "Enter an amount to preview the best route"
              : `Minimum ${amount(selected.minimumAmountOut, outputAsset)}`}
          </small>

          <div className="swap-slippage-row">
            <span>Max slippage</span>
            {[10, 50, 100].map((value) => (
              <button
                key={value}
                type="button"
                className={slippageBps === value ? "active" : ""}
                onClick={() => {
                  setSlippageBps(value);
                  clearQuotes();
                }}
              >
                {value / 100}%
              </button>
            ))}
          </div>
          <RoutePreview
            comparison={comparison}
            selected={selected}
            inputAsset={inputAsset}
            outputAsset={outputAsset}
            payDisplay={displayAmount}
            slippageBps={slippageBps}
            busy={busy}
            expired={expired}
            now={clock}
            onSelect={setSelectedProvider}
          />
          <button
            type="button"
            className="btn-primary swap-action-button"
            aria-label="Swap tokens"
            disabled={busy || signing || amountError !== null || selected === null || expired}
            onClick={() => void swapNow()}
          >
            {signing ? "Opening your wallet…" : busy ? "Finding the best route…" : "Swap"}
          </button>
          {comparison !== null && (
            <button type="button" className="swap-refresh-button" disabled={busy} onClick={() => void getQuotes()}>
              Refresh quotes
            </button>
          )}
        </section>
      </div>

      {expired && (
        <div className="swap-problem-alert" role="alert">
          This quote expired. Refresh quotes before continuing.
        </div>
      )}

      {signedNote !== null && (
        <div className="swap-signed-note" role="status">
          {signedNote}
        </div>
      )}
      {problem !== null && (
        <div className="swap-problem-alert" role="alert">
          {problem}
        </div>
      )}
    </Panel>
  );
}

function AssetField({
  id,
  label,
  query,
  onQuery,
  selected,
  otherId,
  assets,
  onSelect,
  children,
}: {
  id: string;
  label: string;
  query: string;
  onQuery: (value: string) => void;
  selected: SwapAsset;
  otherId: string;
  assets: readonly SwapAsset[];
  onSelect: (assetId: string) => void;
  children: ReactNode;
}) {
  const filtered = assets.filter((asset) => {
    if (asset.assetId === otherId) return false;
    const haystack = `${asset.symbol} ${asset.name} ${asset.assetId}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });
  const options = filtered.some((asset) => asset.assetId === selected.assetId)
    ? filtered
    : [selected, ...filtered.filter((asset) => asset.assetId !== selected.assetId)];
  return (
    <div className="swap-token-box">
      <label htmlFor={id}>{label}</label>
      <div className="swap-token-line">
        <div className="swap-asset-picker">
          <input
            type="search"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search assets"
            aria-label={`${label} search`}
          />
          <select
            id={id}
            value={selected.assetId}
            onChange={(event) => {
              onSelect(event.target.value);
              onQuery("");
            }}
          >
            {options.map((asset) => (
              <option key={asset.assetId} value={asset.assetId}>
                {optionLabel(asset, assets)}
              </option>
            ))}
          </select>
        </div>
        {children}
      </div>
    </div>
  );
}

function formatRate(offer: SwapOffer, inputAsset: SwapAsset, outputAsset: SwapAsset): string {
  const pay = Number(fromBaseUnits(offer.amountIn, inputAsset.decimals));
  const receive = Number(fromBaseUnits(offer.amountOut, outputAsset.decimals));
  if (!Number.isFinite(pay) || !Number.isFinite(receive) || pay <= 0) return "Rate unavailable";
  return `1 ${inputAsset.symbol} ≈ ${(receive / pay).toLocaleString(undefined, { maximumFractionDigits: 8 })} ${outputAsset.symbol}`;
}

function RoutePreview({
  comparison,
  selected,
  inputAsset,
  outputAsset,
  payDisplay,
  slippageBps,
  busy,
  expired,
  now,
  onSelect,
}: {
  comparison: SwapQuoteComparison | null;
  selected: SwapOffer | null;
  inputAsset: SwapAsset;
  outputAsset: SwapAsset;
  payDisplay: string;
  slippageBps: number;
  busy: boolean;
  expired: boolean;
  now: number;
  onSelect: (provider: SwapProvider) => void;
}) {
  if (busy && comparison === null) {
    return (
      <div className="swap-route-preview" role="status">
        <div className="swap-route-preview-header">
          <span className="eyebrow">Route preview</span>
          <strong>Finding the best route across Bitflow, Velar and ALEX…</strong>
        </div>
      </div>
    );
  }
  if (comparison === null || selected === null) return null;
  const routedByCapital = selected.rank === 1;
  return (
    <section className="swap-route-preview" aria-label="Swap route preview">
      <div className="swap-route-preview-header">
        <span className="eyebrow">Route preview</span>
        <strong>
          {payDisplay} {inputAsset.symbol} → {amount(selected.amountOut, outputAsset)}
        </strong>
        <small>
          Minimum {amount(selected.minimumAmountOut, outputAsset)} · {slippageBps / 100}% max slippage
          {expired ? " · quote expired" : ` · ${observedAge(selected.observedAt, now)}`}
        </small>
        <small>
          {routedByCapital
            ? `CapitalOS routes this swap through ${providerName(selected.provider)}`
            : `You selected ${providerName(selected.provider)}`}{" "}
          · {formatRate(selected, inputAsset, outputAsset)}
        </small>
      </div>
      <div className="swap-preview-markets">
        {comparison.offers.map((offer) => {
          const recommended = offer.rank === 1;
          const active = offer.provider === selected.provider;
          return (
            <button
              key={offer.provider}
              type="button"
              className={`swap-preview-market ${recommended ? "recommended" : ""} ${active ? "selected" : ""}`}
              aria-pressed={active}
              aria-label={`Select ${providerName(offer.provider)} route`}
              onClick={() => onSelect(offer.provider)}
            >
              <span className={`provider-mark provider-${offer.provider}`}>
                {providerName(offer.provider).slice(0, 1)}
              </span>
              <span>
                <strong>
                  {providerName(offer.provider)}
                  {recommended ? <em className="swap-recommended-badge">Recommended</em> : null}
                </strong>
                <small>{formatRate(offer, inputAsset, outputAsset)}</small>
              </span>
              <span>
                <strong>{amount(offer.amountOut, outputAsset)}</strong>
                <small>Min {amount(offer.minimumAmountOut, outputAsset)}</small>
              </span>
            </button>
          );
        })}
        {comparison.unavailable.map((item) => (
          <div key={item.provider} className="swap-preview-market unavailable">
            <span className={`provider-mark provider-${item.provider}`}>{providerName(item.provider).slice(0, 1)}</span>
            <span>
              <strong>{providerName(item.provider)}</strong>
              <small>{unavailableReason(item.reason)}</small>
            </span>
            <span>
              <strong>—</strong>
              <small>No quote</small>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
